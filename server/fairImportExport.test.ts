import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fairsFromJson, fairsFromRows, fairsToRows } from "../client/src/lib/fairImportExport";
import type { Fair } from "../client/src/lib/models";

let nextId = 0;
beforeEach(() => {
  nextId = 0;
  vi.stubGlobal("crypto", { randomUUID: () => `fair-${++nextId}` });
});
afterEach(() => vi.unstubAllGlobals());

describe("fair import and export helpers", () => {
  it("normalizes Arabic spreadsheet columns into fair records", () => {
    const imported = fairsFromRows([{
      "اسم المعرض": "معرض القراءة",
      "تاريخ الزيارة": "2026-11-01",
      "الميزانية المرصودة": "1,250",
      "تاريخ البداية": "2026-10-30",
      "تاريخ النهاية": "2026-11-03",
      "المكان": "الرياض",
      "ملاحظات": "الجناح الشرقي",
    }]);

    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ name: "معرض القراءة", visitDate: "2026-11-01", budget: 1250, place: "الرياض", notes: "الجناح الشرقي" });
  });

  it("accepts English field names and exports only active fairs", () => {
    const imported = fairsFromRows([{ name: "Book Fair", "visit date": "2026-12-01", budget: 300 }]);
    const active = imported[0]!;
    const removed = { ...active, id: "deleted", name: "Old Fair", deleted: true } as Fair;

    expect(active).toMatchObject({ name: "Book Fair", visitDate: "2026-12-01", budget: 300 });
    expect(fairsToRows([active, removed])).toEqual([expect.objectContaining({ "اسم المعرض": "Book Fair" })]);
  });

  it("reads the fair backup envelope without accepting a book backup", () => {
    expect(fairsFromJson({ version: 1, module: "fair", fairs: [{ name: "Archive Fair" }] })?.[0]?.name).toBe("Archive Fair");
    expect(fairsFromJson({ version: 1, module: "library", books: [{ title: "A book" }] })).toBeNull();
  });
});
