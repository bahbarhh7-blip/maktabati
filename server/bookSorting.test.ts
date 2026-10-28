import { describe, expect, it } from "vitest";
import { sortBooks } from "../client/src/lib/bookSorting";
import type { Book } from "../client/src/lib/models";

function makeBook(id: string, overrides: Partial<Book> = {}): Book {
  return {
    id, module: "library", title: id, author: "", deathYear: "", subject: "", language: "العربية",
    publisher: "", editor: "", edition: "", printYear: "", volumes: 1, pages: "", volumeSize: "",
    paperColor: "", binding: "", location: "", room: "", cabinet: "", shelf: "", number: "", source: "",
    cost: "", acquiredAt: "", borrower: "", lentAt: "", dueAt: "", loanNotes: "", readingStarted: "",
    readingFinished: "", benefits: "", notes: "", images: [], subBooks: [], priority: "medium", readState: "unread",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...overrides,
  };
}

const ids = (books: Book[]) => books.map(book => book.id);

describe("book sorting", () => {
  it("orders additions newest-first and oldest-first using creation dates", () => {
    const older = makeBook("older", { createdAt: "2024-01-01T00:00:00.000Z" });
    const newer = makeBook("newer", { createdAt: "2025-01-01T00:00:00.000Z" });
    expect(ids(sortBooks([older, newer], "newest"))).toEqual(["newer", "older"]);
    expect(ids(sortBooks([older, newer], "oldest"))).toEqual(["older", "newer"]);
  });

  it("orders volume counts and keeps missing costs after priced books", () => {
    const few = makeBook("few", { volumes: 1, cost: 20 });
    const many = makeBook("many", { volumes: 8, cost: 50 });
    const unknown = makeBook("unknown", { volumes: 3, cost: "" });
    expect(ids(sortBooks([few, many], "volumes-desc"))).toEqual(["many", "few"]);
    expect(ids(sortBooks([few, many], "volumes-asc"))).toEqual(["few", "many"]);
    expect(ids(sortBooks([unknown, few, many], "cost-desc"))).toEqual(["many", "few", "unknown"]);
    expect(ids(sortBooks([unknown, many, few], "cost-asc"))).toEqual(["few", "many", "unknown"]);
  });

  it("sorts author names and Arabic or Western death-year digits", () => {
    const later = makeBook("later", { author: "زيد", deathYear: "١٤٢٠ هـ" });
    const earlier = makeBook("earlier", { author: "أحمد", deathYear: "740 هـ" });
    expect(ids(sortBooks([later, earlier], "author-alpha"))).toEqual(["earlier", "later"]);
    expect(ids(sortBooks([later, earlier], "death-asc"))).toEqual(["earlier", "later"]);
  });
});
