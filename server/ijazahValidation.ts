import { z } from "zod";

export const ijazahRecordSchema = z.object({
  id: z.string().uuid(),
  bookId: z.string().uuid().nullable(),
  bookTitle: z.string().max(500).default(""),
  title: z.string().max(500),
  grantor: z.string().max(500),
  grantee: z.string().max(500),
  issuedAt: z.string().max(32),
  matn: z.string().max(1000),
  notes: z.string().max(20_000),
  images: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().max(300),
    data: z.string().max(350_000).regex(/^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/),
  })).max(8),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deleted: z.boolean().optional(),
}).superRefine((record, context) => {
  if (record.bookId === null && !record.bookTitle.trim()) {
    context.addIssue({ code: "custom", path: ["bookTitle"], message: "A standalone ijazah must name its book or text" });
  }
});

export const ijazahSyncSchema = z.object({
  ijazahs: z.array(z.object({
    id: z.string().uuid(),
    bookId: z.string().uuid().nullable(),
    payload: z.string().max(3_500_000),
    deleted: z.boolean().optional(),
    updatedAt: z.string().datetime(),
  })).max(2000),
});
