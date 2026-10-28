import { describe, expect, it } from "vitest";
import type { Book } from "../client/src/lib/models";
import { getLoanReminders, localCalendarDate } from "../client/src/lib/dueReminders";

function book(id: string, dueAt: string, borrower = "سالم", extra: Partial<Book> = {}): Book {
  return { id, dueAt, borrower, deleted: false, title: `كتاب ${id}`, module: "library", author: "", deathYear: "", subject: "", language: "العربية", publisher: "", editor: "", edition: "", printYear: "", volumes: 1, pages: "", volumeSize: "", paperColor: "", binding: "", location: "", room: "", cabinet: "", shelf: "", number: "", source: "", cost: "", acquiredAt: "", lentAt: "", loanNotes: "", readingStarted: "", readingFinished: "", benefits: "", notes: "", images: [], subBooks: [], priority: "medium", readState: "unread", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...extra };
}

describe("loan reminders", () => {
  it("includes overdue, today, tomorrow, and the next seven days in date order", () => {
    const rows = getLoanReminders([
      book("late", "2026-10-24"), book("tomorrow", "2026-10-27"), book("today", "2026-10-26"),
      book("week", "2026-11-02"), book("later", "2026-11-03"),
    ], "2026-10-26");
    expect(rows.map(row => [row.book.id, row.daysLeft])).toEqual([["late", -2], ["today", 0], ["tomorrow", 1], ["week", 7]]);
  });
  it("ignores deleted books and entries without a borrower or due date", () => {
    const rows = getLoanReminders([
      book("deleted", "2026-10-26", "سالم", { deleted: true }),
      book("no-borrower", "2026-10-26", ""),
      book("no-date", ""),
      book("bad-date", "not-a-date"),
    ], "2026-10-26");
    expect(rows).toEqual([]);
  });
  it("formats dates using the local calendar rather than UTC conversion", () => {
    expect(localCalendarDate(new Date(2026, 9, 26, 0, 10))).toBe("2026-10-26");
  });
});
