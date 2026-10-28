import type { Book } from "./models";

export type BookMatchField = "اسم الكتاب" | "المؤلف" | "دار النشر" | "المحقق" | "العلم";
export type BookSearchMatch = { book: Book; score: number; field: BookMatchField };

export function normalizeBookSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/[ئىي]/g, "ي")
    .replace(/ة/g, "ه")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshteinWithin(left: string, right: string, limit: number): number {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const current = new Array<number>(right.length + 1);
    current[0] = i;
    let rowMinimum = current[0]!;
    for (let j = 1; j <= right.length; j++) {
      const substitution = previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
      rowMinimum = Math.min(rowMinimum, current[j]!);
    }
    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length]!;
}

function tokenScore(query: string, text: string): number | null {
  if (!query || !text) return null;
  if (text.includes(query)) return text === query ? 0 : text.startsWith(query) ? 1 : 2;
  const words = text.split(" ");
  for (const word of words) {
    if (word.startsWith(query)) return 3;
    if (word.includes(query)) return 4;
  }
  if (query.length < 3) return null;
  const maxDistance = query.length <= 4 ? 1 : 2;
  let best: number | null = null;
  for (const word of words) {
    const distance = levenshteinWithin(query, word, maxDistance);
    if (distance <= maxDistance) best = best === null ? distance : Math.min(best, distance);
  }
  return best === null ? null : 8 + best;
}

const SEARCH_FIELDS: { key: keyof Book; label: BookMatchField; weight: number }[] = [
  { key: "title", label: "اسم الكتاب", weight: 0 },
  { key: "author", label: "المؤلف", weight: 6 },
  { key: "publisher", label: "دار النشر", weight: 12 },
  { key: "editor", label: "المحقق", weight: 14 },
  { key: "subject", label: "العلم", weight: 16 },
];

export function scoreBookSearch(book: Book, rawQuery: string): { score: number; field: BookMatchField } | null {
  const query = normalizeBookSearch(rawQuery);
  if (!query) return null;
  const values = SEARCH_FIELDS.map(field => ({ ...field, value: normalizeBookSearch(String(book[field.key] ?? "")) }));
  const phraseMatches = values
    .map(field => ({ score: tokenScore(query, field.value), field }))
    .filter((match): match is { score: number; field: typeof values[number] } => match.score !== null)
    .sort((a, b) => a.score + a.field.weight - (b.score + b.field.weight));
  if (phraseMatches.length) return { score: phraseMatches[0]!.score + phraseMatches[0]!.field.weight, field: phraseMatches[0]!.field.label };

  const queryTokens = query.split(" ").filter(Boolean);
  const tokenMatches = queryTokens.map(token => {
    const matches = values
      .map(field => ({ score: tokenScore(token, field.value), field }))
      .filter((match): match is { score: number; field: typeof values[number] } => match.score !== null)
      .sort((a, b) => a.score + a.field.weight - (b.score + b.field.weight));
    return matches[0] ?? null;
  });
  if (!tokenMatches.length || tokenMatches.some(match => !match)) return null;
  const best = tokenMatches[0]!;
  return {
    score: 30 + tokenMatches.reduce((sum, match) => sum + (match?.score ?? 100) + (match?.field.weight ?? 100), 0),
    field: best.field.label,
  };
}

export function rankBookMatches(books: Book[], query: string): BookSearchMatch[] {
  if (!normalizeBookSearch(query)) return [];
  return books
    .filter(book => !book.deleted)
    .map(book => ({ book, match: scoreBookSearch(book, query) }))
    .filter((item): item is { book: Book; match: NonNullable<ReturnType<typeof scoreBookSearch>> } => item.match !== null)
    .map(({ book, match }) => ({ book, score: match.score, field: match.field }))
    .sort((a, b) => a.score - b.score || a.book.title.localeCompare(b.book.title, "ar"));
}
