import { describe, expect, it } from "vitest";
import { ijazahRecordSchema, ijazahSyncSchema } from "./ijazahValidation";

const base = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  bookId: "123e4567-e89b-12d3-a456-426614174001",
  title: "إجازة في متن",
  grantor: "المجيز",
  grantee: "المجاز له",
  issuedAt: "2026-10-26",
  matn: "متن علمي",
  notes: "",
  images: [{ id: "123e4567-e89b-12d3-a456-426614174002", name: "scan.webp", data: "data:image/webp;base64,QUJD" }],
  createdAt: "2026-10-26T10:00:00.000Z",
  updatedAt: "2026-10-26T10:00:00.000Z",
};

describe("private ijazah payload validation", () => {
  it("accepts compressed inline document images", () => {
    expect(ijazahRecordSchema.parse(base).images).toHaveLength(1);
  });
  it("accepts an independent ijazah for a booklet without a library-book record", () => {
    const standalone = ijazahRecordSchema.parse({ ...base, bookId: null, bookTitle: "كتيب صغير في التجويد" });
    expect(standalone.bookId).toBeNull();
    expect(standalone.bookTitle).toBe("كتيب صغير في التجويد");
    expect(ijazahSyncSchema.parse({ ijazahs: [{ id: base.id, bookId: null, payload: JSON.stringify(standalone), updatedAt: base.updatedAt }] }).ijazahs).toHaveLength(1);
  });
  it("requires a title when an ijazah is not linked to a library book", () => {
    expect(() => ijazahRecordSchema.parse({ ...base, bookId: null, bookTitle: "  " })).toThrow();
  });
  it("rejects public or remote image URLs", () => {
    expect(() => ijazahRecordSchema.parse({ ...base, images: [{ ...base.images[0], data: "https://example.com/scan.jpg" }] })).toThrow();
  });
  it("limits a record to eight images and bounded inline payloads", () => {
    expect(() => ijazahRecordSchema.parse({ ...base, images: Array.from({ length: 9 }, (_, n) => ({ ...base.images[0], id: `123e4567-e89b-12d3-a456-42661417400${n}` })) })).toThrow();
    expect(() => ijazahRecordSchema.parse({ ...base, images: [{ ...base.images[0], data: `data:image/webp;base64,${"A".repeat(350_001)}` }] })).toThrow();
    expect(() => ijazahSyncSchema.parse({ ijazahs: [{ id: base.id, bookId: base.bookId, payload: "x".repeat(3_500_001), updatedAt: base.updatedAt }] })).toThrow();
  });
});
