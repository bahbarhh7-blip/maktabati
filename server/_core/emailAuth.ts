import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Express, Request, Response } from "express";
import nodemailer from "nodemailer";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

const scrypt = promisify(scryptCallback);
const normalizeEmail = (v: unknown) => typeof v === "string" ? v.trim().toLowerCase() : "";
const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;
const resetTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const genericResetMessage = "إذا كان البريد مرتبطاً بحساب، فسيصلك رابط إعادة التعيين خلال دقائق.";
const resetRequests = new Map<string, { count: number; expiresAt: number }>();
function allowResetRequest(ip: string) {
  const now = Date.now();
  if (resetRequests.size > 2_000) {
    for (const [entryKey, entry] of resetRequests) if (entry.expiresAt <= now) resetRequests.delete(entryKey);
  }
  const key = createHash("sha256").update(ip || "unknown").digest("hex");
  const current = resetRequests.get(key);
  if (!current || current.expiresAt <= now) { resetRequests.set(key, { count: 1, expiresAt: now + 60 * 60 * 1000 }); return true; }
  if (current.count >= 5) return false;
  current.count += 1;
  return true;
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${digest.toString("hex")}`;
}
async function verifyPassword(password: string, encoded: string) {
  const [kind, salt, hash] = encoded.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function setSession(user: NonNullable<Awaited<ReturnType<typeof db.getUserByOpenId>>>, req: Request, res: Response, remember: boolean) {
  return sdk.createSessionToken(user.openId, { name: user.name ?? "", expiresInMs: remember ? ONE_YEAR_MS : 1000 * 60 * 60 * 24 }).then(token => {
    res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(req), maxAge: remember ? ONE_YEAR_MS : 1000 * 60 * 60 * 24 });
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  });
}

function getMailConfiguration() {
  const host = process.env.MAKTABATI_SMTP_HOST?.trim();
  const port = Number(process.env.MAKTABATI_SMTP_PORT);
  const user = process.env.MAKTABATI_SMTP_USER;
  const pass = process.env.MAKTABATI_SMTP_PASS;
  const from = process.env.MAKTABATI_SMTP_FROM?.trim();
  const publicUrl = process.env.MAKTABATI_PUBLIC_URL?.trim();
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !pass || !from || !publicUrl) return null;
  let base: URL;
  try { base = new URL(publicUrl); } catch { return null; }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) return null;
  return { host, port, user, pass, from, baseUrl: base.origin };
}

async function sendResetEmail(email: string, name: string | null, token: string, config: NonNullable<ReturnType<typeof getMailConfiguration>>) {
  const resetUrl = new URL("/", config.baseUrl);
  resetUrl.searchParams.set("reset", token);
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    await transporter.sendMail({
      from: config.from,
      to: email,
      subject: "إعادة تعيين كلمة مرور مكتبتي | Maktabati",
      text: `مرحباً${name ? ` ${name}` : ""}،\n\nوصلنا طلب لإنشاء كلمة مرور جديدة لحسابك في مكتبتي. استخدم الرابط التالي خلال 30 دقيقة لإكمال العملية:\n${resetUrl.toString()}\n\nإذا لم تطلب ذلك، فتجاهل هذه الرسالة؛ لن تتغير كلمة مرورك.`,
    });
  } finally { transporter.close(); }
}

export function registerEmailAuthRoutes(app: Express) {
  app.post("/api/auth/register", async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = req.body?.password;
      const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 100) : "";
      if (!validEmail(email) || typeof password !== "string" || password.length < 10 || password.length > 256 || !name) {
        res.status(400).json({ error: "أدخل اسماً وبريداً صحيحاً وكلمة مرور لا تقل عن 10 أحرف." }); return;
      }
      if (await db.getUserByEmail(email)) { res.status(409).json({ error: "يوجد حساب بهذا البريد بالفعل." }); return; }
      const openId = `email_${createHash("sha256").update(email).digest("hex").slice(0, 48)}`;
      const user = await db.createEmailUser({ openId, email, name, passwordHash: await hashPassword(password) });
      if (!user) throw new Error("Account creation failed");
      const safeUser = await setSession(user, req, res, req.body?.remember !== false);
      res.status(201).json({ user: safeUser });
    } catch (error) {
      console.error("[Auth] Registration failed", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "تعذر إنشاء الحساب الآن. حاول مرة أخرى." });
    }
  });
  app.post("/api/auth/login", async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = req.body?.password;
      const user = validEmail(email) ? await db.getUserByEmail(email) : undefined;
      if (!user?.passwordHash || typeof password !== "string" || !(await verifyPassword(password, user.passwordHash))) {
        res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة." }); return;
      }
      await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
      const updated = await db.getUserByOpenId(user.openId);
      if (!updated) throw new Error("Account unavailable");
      res.json({ user: await setSession(updated, req, res, req.body?.remember !== false) });
    } catch (error) {
      console.error("[Auth] Login failed", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "تعذر تسجيل الدخول الآن." });
    }
  });
  app.post("/api/auth/forgot", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!allowResetRequest(req.ip ?? req.socket.remoteAddress ?? "")) { res.status(429).json({ error: "تجاوزت عدد طلبات الاستعادة المسموح. انتظر قليلاً ثم أعد المحاولة." }); return; }
    const config = getMailConfiguration();
    if (!config) { res.status(503).json({ error: "خدمة البريد لم تكتمل إعداداتها بعد. أضف إعدادات SMTP ورابط التطبيق الآمن ثم أعد المحاولة." }); return; }
    const email = normalizeEmail(req.body?.email);
    if (!validEmail(email)) { res.json({ success: true, message: genericResetMessage }); return; }
    let tokenHash: string | undefined;
    try {
      const user = await db.getUserByEmail(email);
      if (user?.passwordHash) {
        const token = randomBytes(32).toString("base64url");
        tokenHash = resetTokenHash(token);
        await db.replacePasswordResetToken(user.id, tokenHash, new Date(Date.now() + 30 * 60 * 1000));
        try {
          await sendResetEmail(email, user.name, token, config);
        } catch (error) {
          await db.deletePasswordResetToken(tokenHash);
          console.error("[Auth] Password reset email provider rejected a message");
          res.json({ success: true, message: genericResetMessage }); return;
        }
      }
      res.json({ success: true, message: genericResetMessage });
    } catch (error) {
      if (tokenHash) await db.deletePasswordResetToken(tokenHash).catch(() => undefined);
      console.error("[Auth] Password reset request failed", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "تعذر إتمام طلب الاستعادة الآن." });
    }
  });
  app.post("/api/auth/reset", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const token = req.body?.token;
      const password = req.body?.password;
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token) || typeof password !== "string" || password.length < 10 || password.length > 256) {
        res.status(400).json({ error: "رابط الاستعادة غير صالح أو انتهت صلاحيته، أو كلمة المرور لا تستوفي الشروط." }); return;
      }
      const rotatedOpenId = `email_reset_${randomBytes(24).toString("hex")}`;
      const used = await db.consumePasswordResetToken(resetTokenHash(token), await hashPassword(password), rotatedOpenId);
      if (!used) { res.status(400).json({ error: "رابط الاستعادة غير صالح أو منتهي الصلاحية أو سبق استخدامه." }); return; }
      res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(req), maxAge: -1 });
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Password reset completion failed", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "تعذر تغيير كلمة المرور الآن." });
    }
  });
  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(_req), maxAge: -1 });
    res.json({ success: true });
  });
}
