import type { Fair } from "./models";

const aliases = {
  name: ["name", "fair", "fair name", "title", "اسم المعرض", "المعرض"],
  visitDate: ["visitdate", "visit date", "date", "تاريخ الزيارة"],
  budget: ["budget", "planned budget", "الميزانية", "الميزانية المرصودة"],
  startsAt: ["startsat", "starts at", "start date", "تاريخ البداية", "تاريخ البدء"],
  endsAt: ["endsat", "ends at", "end date", "تاريخ النهاية"],
  place: ["place", "location", "المكان", "الموقع"],
  notes: ["notes", "ملاحظات", "ملاحظات الزيارة"],
} as const;

const keyForm = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[\s_-]+/g, "").trim();

function readValue(row: Record<string, unknown>, names: readonly string[]): unknown {
  const accepted = new Set(names.map(keyForm));
  const entry = Object.entries(row).find(([key]) => accepted.has(keyForm(key)));
  return entry?.[1];
}

function asText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function asDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value >= 20_000 && value <= 100_000) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86_400_000).toISOString().slice(0, 10);
  }
  return asText(value);
}

function asBudget(value: unknown): number | "" {
  if (value == null || value === "") return "";
  const number = typeof value === "number" ? value : Number(String(value).replaceAll(",", "").trim());
  return Number.isFinite(number) ? number : "";
}

export function fairsToRows(fairs: Fair[]): Record<string, string | number>[] {
  return fairs.filter(fair => !fair.deleted).map(fair => ({
    "اسم المعرض": fair.name,
    "تاريخ الزيارة": fair.visitDate,
    "الميزانية المرصودة": fair.budget,
    "تاريخ البداية": fair.startsAt,
    "تاريخ النهاية": fair.endsAt,
    "المكان": fair.place,
    "ملاحظات": fair.notes,
  }));
}

export function fairsFromRows(rows: Record<string, unknown>[]): Fair[] {
  const now = new Date().toISOString();
  return rows.flatMap(row => {
    const name = asText(readValue(row, aliases.name));
    if (!name) return [];
    return [{
      id: crypto.randomUUID(),
      name,
      visitDate: asDate(readValue(row, aliases.visitDate)),
      budget: asBudget(readValue(row, aliases.budget)),
      startsAt: asDate(readValue(row, aliases.startsAt)),
      endsAt: asDate(readValue(row, aliases.endsAt)),
      place: asText(readValue(row, aliases.place)),
      notes: asText(readValue(row, aliases.notes)),
      createdAt: now,
      updatedAt: now,
    }];
  });
}

export function fairsFromJson(value: unknown): Fair[] | null {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { fairs?: unknown }).fairs)
      ? (value as { fairs: unknown[] }).fairs
      : null;
  if (!rows) return null;
  return fairsFromRows(rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object"));
}
