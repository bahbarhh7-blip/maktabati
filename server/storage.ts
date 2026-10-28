// تخزين الصور على Cloudflare R2 (متوافق مع S3).
// المتغيرات المطلوبة: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sql } from "drizzle-orm";
import { ENV } from "./_core/env";
import { getDb } from "./db";

let cachedClient: S3Client | null = null;

function getConfig() {
  const { r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2Bucket } = ENV;
  if (!r2AccountId || !r2AccessKeyId || !r2SecretAccessKey || !r2Bucket) {
    throw new Error(
      "Storage config missing: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET",
    );
  }
  return { r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2Bucket };
}

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  const c = getConfig();
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${c.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: c.r2AccessKeyId, secretAccessKey: c.r2SecretAccessKey },
  });
  return cachedClient;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

// إذا لم تُضبط مفاتيح R2 تُحفظ الصور داخل قاعدة البيانات (بدون أي خدمة إضافية).
function useR2(): boolean {
  return Boolean(ENV.r2AccountId && ENV.r2AccessKeyId && ENV.r2SecretAccessKey && ENV.r2Bucket);
}

let tableReady = false;
async function ensureImageTable() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  if (!tableReady) {
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS stored_images (
        storage_key VARCHAR(400) NOT NULL PRIMARY KEY,
        content_type VARCHAR(64) NOT NULL,
        data LONGBLOB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    tableReady = true;
  }
  return db;
}

export async function storageReadBytes(
  relKey: string,
): Promise<{ contentType: string; data: Buffer } | null> {
  const db = await ensureImageTable();
  const key = normalizeKey(relKey);
  const result: any = await db.execute(
    sql`SELECT content_type, data FROM stored_images WHERE storage_key = ${key} LIMIT 1`,
  );
  const rows = Array.isArray(result) ? result[0] : result?.rows;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row) return null;
  return { contentType: String(row.content_type), data: Buffer.from(row.data) };
}

export function storageUsesR2(): boolean {
  return useR2();
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const body = typeof data === "string" ? Buffer.from(data) : data;
  if (!useR2()) {
    const db = await ensureImageTable();
    await db.execute(
      sql`INSERT INTO stored_images (storage_key, content_type, data) VALUES (${key}, ${contentType}, ${Buffer.from(body)})
          ON DUPLICATE KEY UPDATE content_type = VALUES(content_type), data = VALUES(data)`,
    );
    return { key, url: `/manus-storage/${key}` };
  }
  const { r2Bucket } = getConfig();
  await getClient().send(
    new PutObjectCommand({ Bucket: r2Bucket, Key: key, Body: body, ContentType: contentType }),
  );
  // نبقي نفس المسار القديم حتى تبقى الروابط المحفوظة تعمل.
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const { r2Bucket } = getConfig();
  const key = normalizeKey(relKey);
  return await getSignedUrl(getClient(), new GetObjectCommand({ Bucket: r2Bucket, Key: key }), {
    expiresIn: 3600,
  });
}
