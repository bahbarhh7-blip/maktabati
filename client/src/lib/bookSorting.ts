import type { Book } from "./models";

export type BookSortMode =
  | "alpha"
  | "reverse"
  | "newest"
  | "oldest"
  | "volumes-desc"
  | "volumes-asc"
  | "cost-desc"
  | "cost-asc"
  | "author-alpha"
  | "death-asc"
  | "priority";

const priorityRank = { high: 0, medium: 1, low: 2 } as const;

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latinDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, digit => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

function deathYear(value: string): number | null {
  const digits = latinDigits(value).match(/\d+/)?.[0];
  if (!digits) return null;
  const year = Number(digits);
  return Number.isFinite(year) ? year : null;
}

function compareOptionalNumber(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b !== null) return 1;
  if (a !== null && b === null) return -1;
  if (a === null && b === null) return 0;
  return direction * (a! - b!);
}

export function sortBooks(books: readonly Book[], mode: string, locale = "ar"): Book[] {
  const compareText = (a: string, b: string) => a.localeCompare(b, locale, { sensitivity: "base", numeric: true });
  const compareTitle = (a: Book, b: Book) => compareText(a.title, b.title);

  return [...books].sort((a, b) => {
    switch (mode as BookSortMode) {
      case "reverse":
        return -compareTitle(a, b);
      case "newest":
        return timestamp(b.createdAt) - timestamp(a.createdAt) || compareTitle(a, b);
      case "oldest":
        return timestamp(a.createdAt) - timestamp(b.createdAt) || compareTitle(a, b);
      case "volumes-desc":
        return b.volumes - a.volumes || compareTitle(a, b);
      case "volumes-asc":
        return a.volumes - b.volumes || compareTitle(a, b);
      case "cost-desc":
        return compareOptionalNumber(a.cost === "" ? null : a.cost, b.cost === "" ? null : b.cost, -1) || compareTitle(a, b);
      case "cost-asc":
        return compareOptionalNumber(a.cost === "" ? null : a.cost, b.cost === "" ? null : b.cost, 1) || compareTitle(a, b);
      case "author-alpha":
        return compareText(a.author, b.author) || compareTitle(a, b);
      case "death-asc":
        return compareOptionalNumber(deathYear(a.deathYear), deathYear(b.deathYear), 1) || compareText(a.author, b.author) || compareTitle(a, b);
      case "priority":
        return priorityRank[a.priority] - priorityRank[b.priority] || compareTitle(a, b);
      case "alpha":
      default:
        return compareTitle(a, b);
    }
  });
}
