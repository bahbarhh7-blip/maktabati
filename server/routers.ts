import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { storagePut } from "./storage";
import { ijazahRecordSchema, ijazahSyncSchema } from "./ijazahValidation";

const bookInput = z.object({
  id: z.string().uuid(),
  module: z.enum(["library", "surplus", "borrowed", "wishlist"]),
  payload: z.string().max(5_000_000),
  deleted: z.boolean().optional(),
  updatedAt: z.string().datetime(),
});
const fairInput = z.object({
  id: z.string().uuid(), payload: z.string().max(500_000), deleted: z.boolean().optional(), updatedAt: z.string().datetime(),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => {
      if (!ctx.user) return null;
      return { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, role: ctx.user.role };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  library: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await db.listBooks(ctx.user.id);
      return rows.map(row => ({ id: row.id, module: row.module, data: row.payload, deleted: row.deleted, updatedAt: row.updatedAt.toISOString() }));
    }),
    sync: protectedProcedure.input(z.object({ books: z.array(bookInput).max(2000) })).mutation(async ({ ctx, input }) => {
      for (const item of input.books) {
        await db.saveBook(ctx.user.id, { id: item.id, module: item.module, payload: item.payload, deleted: item.deleted, updatedAt: new Date(item.updatedAt) });
      }
      const rows = await db.listBooks(ctx.user.id);
      return { books: rows.map(row => ({ id: row.id, module: row.module, data: row.payload, deleted: row.deleted, updatedAt: row.updatedAt.toISOString() })), syncedAt: new Date().toISOString() };
    }),
  }),
  fairs: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await db.listFairs(ctx.user.id);
      return rows.map(row => ({ id: row.id, data: row.payload, deleted: row.deleted, updatedAt: row.updatedAt.toISOString() }));
    }),
    sync: protectedProcedure.input(z.object({ fairs: z.array(fairInput).max(1000) })).mutation(async ({ ctx, input }) => {
      for (const item of input.fairs) {
        await db.saveFair(ctx.user.id, { id: item.id, payload: item.payload, deleted: item.deleted, updatedAt: new Date(item.updatedAt) });
      }
      const rows = await db.listFairs(ctx.user.id);
      return { fairs: rows.map(row => ({ id: row.id, data: row.payload, deleted: row.deleted, updatedAt: row.updatedAt.toISOString() })), syncedAt: new Date().toISOString() };
    }),
  }),
  ijazahs: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await db.listIjazahs(ctx.user.id);
      return rows.map(row => ({ id: row.id, bookId: row.bookId, data: row.payload, deleted: row.deleted, updatedAt: row.updatedAt.toISOString() }));
    }),
    sync: protectedProcedure.input(ijazahSyncSchema).mutation(async ({ ctx, input }) => {
      for (const item of input.ijazahs) {
        let record: z.infer<typeof ijazahRecordSchema>;
        try { record = ijazahRecordSchema.parse(JSON.parse(item.payload)); }
        catch { throw new Error("Invalid ijazah record payload"); }
        if (record.id !== item.id || record.bookId !== item.bookId || record.updatedAt !== item.updatedAt || Boolean(record.deleted) !== Boolean(item.deleted)) {
          throw new Error("Ijazah sync metadata does not match its payload");
        }
        await db.saveIjazah(ctx.user.id, { id: item.id, bookId: item.bookId, payload: item.payload, deleted: item.deleted, updatedAt: new Date(item.updatedAt) });
      }
      const rows = await db.listIjazahs(ctx.user.id);
      return { ijazahs: rows.map(row => ({ id: row.id, bookId: row.bookId, data: row.payload, deleted: row.deleted, updatedAt: row.updatedAt.toISOString() })), syncedAt: new Date().toISOString() };
    }),
  }),
  preferences: router({
    get: protectedProcedure.query(({ ctx }) => db.getUserPreferences(ctx.user.id)),
    save: protectedProcedure.input(z.object({ payload: z.string().max(100_000), updatedAt: z.string().datetime() })).mutation(async ({ ctx, input }) => {
      const value = JSON.parse(input.payload) as { language?: string; theme?: string; calendar?: string; digits?: string; currency?: string; font?: string; cardFields?: unknown };
      if (!value || !["ar", "en"].includes(value.language ?? "") || !["dark", "light"].includes(value.theme ?? "") || !["gregory", "islamic"].includes(value.calendar ?? "") || !["latn", "arab"].includes(value.digits ?? "") || typeof value.currency !== "string" || typeof value.font !== "string" || !value.cardFields) throw new Error("Invalid preference payload");
      await db.saveUserPreferences(ctx.user.id, input.payload, new Date(input.updatedAt));
      return { success: true } as const;
    }),
  }),
  media: router({
    upload: protectedProcedure.input(z.object({ bookId: z.string().uuid(), imageId: z.string().uuid(), dataUrl: z.string().max(750_000) })).mutation(async ({ ctx, input }) => {
      const match = input.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!match) throw new Error("Unsupported image format");
      const mime = match[1]!;
      const bytes = Buffer.from(match[2]!, "base64");
      if (!bytes.length || bytes.length > 500 * 1024) throw new Error("Image must be no larger than 500 KB after compression");
      const ext = mime === "image/jpeg" ? "jpg" : mime.slice("image/".length);
      const result = await storagePut(`maktabati/users/${ctx.user.id}/books/${input.bookId}/${input.imageId}.${ext}`, bytes, mime);
      return { src: result.url, key: result.key };
    }),
  }),
});

export type AppRouter = typeof appRouter;
