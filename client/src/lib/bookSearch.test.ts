import { describe, expect, it } from "vitest";
import { emptyBook } from "./models";
import { normalizeBookSearch, rankBookMatches, scoreBookSearch } from "./bookSearch";

function book(title: string, values: { author?: string; publisher?: string; subject?: string } = {}) {
  return { ...emptyBook("library"), title, ...values };
}

describe("local flexible book search", () => {
  it("normalizes Arabic hamza, diacritics, and common letter variants", () => {
    expect(normalizeBookSearch("إِعْلامُ المُوقِعِين"))
      .toBe(normalizeBookSearch("اعلام الموقعين"));
  });

  it("finds a book despite a small Arabic spelling error", () => {
    const match = scoreBookSearch(book("شرح صحيح البخاري"), "شرح صخيح البخاري");
    expect(match).not.toBeNull();
    expect(match?.field).toBe("اسم الكتاب");
  });

  it("matches a title fragment and ranks the title ahead of a publisher match", () => {
    const titleHit = book("الجامع الصحيح", { publisher: "دار المعرفة" });
    const publisherHit = book("كتاب آخر", { publisher: "الجامع الصحيح للطباعة" });
    const ranked = rankBookMatches([publisherHit, titleHit], "الجامع");
    expect(ranked.map(item => item.book.title)).toEqual(["الجامع الصحيح", "كتاب آخر"]);
  });

  it("searches authors, publishers, and subject names", () => {
    expect(scoreBookSearch(book("كتاب", { author: "ابن حجر العسقلاني" }), "العسقلاني")?.field).toBe("المؤلف");
    expect(scoreBookSearch(book("كتاب", { publisher: "دار المنهاج" }), "المنهاج")?.field).toBe("دار النشر");
    expect(scoreBookSearch(book("كتاب", { subject: "أصول الفقه" }), "اصول الفقه")?.field).toBe("العلم");
  });

  it("does not suggest unrelated books and ignores deleted records", () => {
    const deleted = { ...book("صحيح مسلم"), deleted: true };
    expect(rankBookMatches([book("شرح النووي على مسلم"), deleted], "تاريخ الطبري")).toEqual([]);
  });
});
