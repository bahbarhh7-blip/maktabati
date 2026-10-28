import type { Book } from "./models";

export type LoanReminder = { book: Book; daysLeft: number };

export function localCalendarDate(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateNumber(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 12).getTime();
}

export function getLoanReminders(books: Book[], today = localCalendarDate()): LoanReminder[] {
  return books
    .filter(book => !book.deleted && Boolean(book.dueAt && book.borrower.trim()))
    .map(book => ({ book, daysLeft: Math.round((dateNumber(book.dueAt) - dateNumber(today)) / 86_400_000) }))
    .filter(item => Number.isFinite(item.daysLeft) && item.daysLeft <= 7)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}
