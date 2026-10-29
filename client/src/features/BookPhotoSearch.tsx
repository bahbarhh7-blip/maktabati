import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, Check, Image as ImageIcon, LoaderCircle, Search, X } from "lucide-react";
import type { Book } from "@/lib/models";
import { moduleInfo } from "@/lib/models";
import { translate, type AppLanguage } from "@/lib/i18n";

export type ExternalBookCandidate = {
  title: string;
  author: string;
  publisher: string;
  printYear: string;
  description: string;
  thumbnail: string;
  isbn: string;
  pages: number | "";
};

type LocalMatch = { book: Book; distance: number; cover: string };
type HashedCover = { book: Book; distance: number; cover: string };
type Props = {
  books: Book[];
  language: AppLanguage;
  onOpenBook: (book: Book) => void;
  onUseCandidate: (candidate: ExternalBookCandidate) => void;
};

const normalizeText = (value: string) => value.toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").trim();

const hashCache = new Map<string, string>();

export function hammingDistance(left: string, right: string): number {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) distance += 1;
  return distance;
}

export function rankVisualCoverMatches(queryHash: string, covers: HashedCover[], limit = 8): LocalMatch[] {
  const bestByBook = new Map<string, LocalMatch>();
  for (const cover of covers) {
    const distance = hammingDistance(queryHash, cover.cover);
    if (distance > 19) continue;
    const previous = bestByBook.get(cover.book.id);
    if (!previous || distance < previous.distance) bestByBook.set(cover.book.id, { ...cover, distance });
  }
  return [...bestByBook.values()].sort((left, right) => left.distance - right.distance || left.book.title.localeCompare(right.book.title, "ar")).slice(0, limit);
}

async function imageHash(source: string): Promise<string> {
  const cached = hashCache.get(source);
  if (cached) return cached;
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 9;
  canvas.height = 8;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("تعذر تجهيز الصورة للمقارنة.");
  context.drawImage(image, 0, 0, 9, 8);
  const pixels = context.getImageData(0, 0, 9, 8).data;
  const grayAt = (x: number, y: number) => {
    const offset = (y * 9 + x) * 4;
    return (pixels[offset]! * 299 + pixels[offset + 1]! * 587 + pixels[offset + 2]! * 114) / 1000;
  };
  let hash = "";
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) hash += grayAt(x, y) > grayAt(x + 1, y) ? "1" : "0";
  if (hashCache.size > 700) hashCache.clear();
  hashCache.set(source, hash);
  return hash;
}

async function makeSmallDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1500 / bitmap.width, 1900 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("تعذر قراءة الصورة في هذا الجهاز.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("تعذر تجهيز الصورة.")), "image/jpeg", 0.86));
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("تعذر قراءة الصورة."));
    reader.onerror = () => reject(new Error("تعذر قراءة الصورة."));
    reader.readAsDataURL(blob);
  });
}

function localCoverSources(book: Book): string[] {
  return book.images.map(image => image.backupData || image.src).filter(source => source.startsWith("data:image/"));
}

export default function BookPhotoSearch({ books, language, onOpenBook, onUseCandidate }: Props) {
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState("");
  const [matches, setMatches] = useState<LocalMatch[]>([]);
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchProgress, setMatchProgress] = useState(0);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrText, setOcrText] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [results, setResults] = useState<ExternalBookCandidate[]>([]);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const matchPhotoLocally = async (dataUrl: string) => {
    setMatchBusy(true);
    setMatchProgress(0);
    setMatches([]);
    setNotice("");
    try {
      const queryHash = await imageHash(dataUrl);
      const candidates = books.filter(book => !book.deleted).flatMap(book => localCoverSources(book).map(cover => ({ book, cover })));
      const hashed: HashedCover[] = [];
      for (let offset = 0; offset < candidates.length; offset += 6) {
        const batch = candidates.slice(offset, offset + 6);
        const values = await Promise.all(batch.map(async item => {
          try { return { ...item, distance: hammingDistance(queryHash, await imageHash(item.cover)) }; }
          catch { return null; }
        }));
        for (const value of values) if (value) hashed.push({ book: value.book, cover: value.cover, distance: value.distance });
        setMatchProgress(Math.min(100, Math.round(((offset + batch.length) / Math.max(1, candidates.length)) * 100)));
      }
      setMatches(rankVisualCoverMatches(queryHash, hashed));
      if (!candidates.length) setNotice(translate("لا توجد أغلفة محلية للمقارنة بعد. أضف صور أغلفة إلى كتبك أولاً.", language));
    } catch {
      setNotice(translate("تعذرت قراءة الصورة؛ اختر صورة غلاف واضحة وحاول ثانية.", language));
    } finally {
      setMatchBusy(false);
    }
  };

  const chooseImage = async (file?: File) => {
    if (!file) return;
    setNotice("");
    setOcrText("");
    setResults([]);
    try {
      const dataUrl = await makeSmallDataUrl(file);
      setPhoto(dataUrl);
      await matchPhotoLocally(dataUrl);
    } catch {
      setNotice(translate("تعذرت معالجة الصورة؛ جرّب صورة بصيغة JPG أو PNG.", language));
    }
  };

  const recognizeText = async (useLocalFiles: boolean) => {
    const { createWorker } = await import("tesseract.js");
    const logger = (message: { progress?: number }) => {
      if (typeof message.progress === "number") setOcrProgress(Math.round(message.progress * 100));
    };
    const worker = useLocalFiles
      ? await createWorker(["ara", "eng"], 1, { workerPath: "/ocr/worker.min.js", corePath: "/ocr", langPath: "/ocr/tessdata", gzip: true, cacheMethod: "write", logger })
      : await createWorker(["ara", "eng"], 1, { logger });
    try {
      const recognized = await worker.recognize(photo);
      return recognized.data.text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 1).slice(0, 16).join("\n").slice(0, 1200);
    } finally {
      await worker.terminate();
    }
  };

  const runOcr = async () => {
    if (!photo) return;
    setOcrBusy(true);
    setOcrProgress(0);
    setNotice("");
    try {
      let cleanText = "";
      try {
        cleanText = await recognizeText(true);
      } catch (localError) {
        console.warn("Local OCR failed, trying online files", localError);
        setOcrProgress(0);
        cleanText = await recognizeText(false);
      }
      setOcrText(cleanText);
      if (!cleanText) setNotice(translate("لم أستطع قراءة عنوان واضح. جرّب تصوير الغلاف بإضاءة جيدة ومن الأمام.", language));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setNotice(`${translate("تعذرت تهيئة قراءة الصورة. اتصل بالإنترنت مرة لتنزيل ملفات OCR ثم أعد المحاولة دون اتصال.", language)} (${detail.slice(0, 140)})`);
    } finally {
      setOcrBusy(false);
    }
  };

  const lookupMetadata = async () => {
    if (!ocrText.trim()) return;
    setLookupBusy(true);
    setResults([]);
    setNotice("");
    try {
      const params = new URLSearchParams({ q: ocrText.trim().slice(0, 250), maxResults: "8", printType: "books" });
      const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${params.toString()}`, { signal: AbortSignal.timeout(18000) });
      if (!response.ok) throw new Error("lookup failed");
      const payload = await response.json() as { items?: { volumeInfo?: { title?: string; authors?: string[]; publisher?: string; publishedDate?: string; description?: string; pageCount?: number; imageLinks?: { thumbnail?: string }; industryIdentifiers?: { identifier?: string; type?: string }[] } }[] };
      const found = (payload.items ?? []).map(item => {
        const info = item.volumeInfo ?? {};
        return {
          title: info.title ?? "",
          author: info.authors?.join("، ") ?? "",
          publisher: info.publisher ?? "",
          printYear: info.publishedDate?.slice(0, 4) ?? "",
          description: info.description ?? "",
          thumbnail: (info.imageLinks?.thumbnail ?? "").replace(/^http:/, "https:"),
          isbn: info.industryIdentifiers?.find(identifier => identifier.type === "ISBN_13")?.identifier ?? info.industryIdentifiers?.[0]?.identifier ?? "",
          pages: info.pageCount ?? "",
        };
      }).filter(item => item.title).slice(0, 8);
      setResults(found);
      if (!found.length) setNotice(translate("لم تظهر نتائج مطابقة. عدّل النص المستخرج أو جرّب صورة أوضح.", language));
    } catch {
      setNotice(translate("تعذر البحث عن البيانات. تحقق من اتصال الإنترنت ثم حاول ثانية.", language));
    } finally {
      setLookupBusy(false);
    }
  };

  const queryTokens = normalizeText(query).split(/\s+/).filter(Boolean);
  const textMatches = queryTokens.length ? books.filter(book => {
    if (book.deleted) return false;
    const haystack = normalizeText([book.title, book.author, book.subject, book.publisher, book.editor, book.notes, book.number, book.location, book.room, book.cabinet, book.shelf].join(" "));
    return queryTokens.every(token => haystack.includes(token));
  }).slice(0, 30) : [];

  return <>
    <button type="button" className="icon-button photo-search-trigger" onClick={() => setOpen(true)} title={translate("بحث", language)} aria-label={translate("بحث", language)}><Search size={18} /><span>{translate("بحث", language)}</span></button>
    {open && createPortal(<div className="modal-backdrop photo-search-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="modal photo-search-modal" role="dialog" aria-modal="true" aria-labelledby="photo-search-title">
        <header className="modal-heading"><div className="photo-search-heading-icon"><ImageIcon size={20} /></div><div><h2 id="photo-search-title">{translate("البحث", language)}</h2><p>{translate("ابحث في كتبك بالكتابة، أو بصورة الغلاف.", language)}</p></div><button className="icon-button" onClick={() => setOpen(false)} aria-label={translate("إغلاق", language)}><X size={18} /></button></header>
        <div className="photo-search-body">
          <div className="global-search-field"><Search size={18} /><input autoFocus type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={translate("ابحث بالعنوان أو المؤلف أو العلم...", language)} /></div>
          {queryTokens.length > 0 && <div className="global-search-results">{textMatches.length ? textMatches.map(book => <button type="button" key={book.id} onClick={() => { setOpen(false); onOpenBook(book); }}><b>{book.title}</b><small>{[book.author, book.subject].filter(Boolean).join(" · ")}</small></button>) : <small>{translate("لا توجد نتائج مطابقة.", language)}</small>}</div>}
          <div className="global-search-divider">{translate("أو ابحث بصورة الغلاف", language)}</div>
          <div className="photo-search-inputs"><input ref={fileInput} hidden type="file" accept="image/*" onChange={event => { void chooseImage(event.target.files?.[0]); event.target.value = ""; }} /><input ref={cameraInput} hidden type="file" accept="image/*" capture="environment" onChange={event => { void chooseImage(event.target.files?.[0]); event.target.value = ""; }} />
            <button type="button" className="outline-button" onClick={() => fileInput.current?.click()}><ImageIcon size={16} />{translate("اختر صورة من الجهاز", language)}</button><button type="button" className="outline-button" onClick={() => cameraInput.current?.click()}><Camera size={16} />{translate("صوّر الغلاف", language)}</button>
          </div>
          {photo && <div className="photo-search-preview"><img src={photo} alt={translate("صورة الغلاف المختارة", language)} /><div><b>{translate("الصورة تبقى على جهازك", language)}</b><small>{translate("المطابقة البصرية وقراءة النص تتمان محلياً.", language)}</small><button type="button" className="text-button" onClick={() => { setPhoto(""); setMatches([]); setOcrText(""); setResults([]); }}>{translate("تغيير الصورة", language)}</button></div></div>}
          {photo && <section className="photo-search-section"><header><h3>{translate("مطابقة مع أغلفة مكتبتي", language)}</h3><button type="button" className="outline-button compact" onClick={() => void matchPhotoLocally(photo)} disabled={matchBusy}>{matchBusy ? <LoaderCircle size={14} className="spin" /> : <Search size={14} />}{translate("إعادة المطابقة", language)}</button></header>
            {matchBusy && <p className="photo-search-progress"><LoaderCircle size={14} className="spin" />{translate("تتم مقارنة الصور محلياً", language)} {matchProgress}%</p>}
            {!matchBusy && matches.length > 0 && <div className="photo-match-list">{matches.map(match => <button type="button" className="photo-match-item" key={match.book.id} onClick={() => { setOpen(false); onOpenBook(match.book); }}><img src={match.cover} alt="" /><span><b>{match.book.title}</b><small>{match.book.author || translate("المؤلف غير محدد", language)} · {translate(moduleInfo[match.book.module].title, language)}</small><small>{translate("درجة تقارب الغلاف", language)}: {Math.round((64 - match.distance) / 64 * 100)}%</small></span><Search size={15} /></button>)}</div>}
            {!matchBusy && photo && matches.length === 0 && !notice && <p className="photo-search-empty">{translate("لم أجد غلافاً قريباً في الصور المحلية. يمكنك استخدام قراءة النص للبحث عن معلومات الكتاب.", language)}</p>}
          </section>}
          {photo && <section className="photo-search-section"><header><h3>{translate("التعرّف على عنوان وبيانات الكتاب", language)}</h3><button type="button" className="primary-button compact" onClick={() => void runOcr()} disabled={ocrBusy}>{ocrBusy ? <LoaderCircle size={14} className="spin" /> : <Search size={14} />}{translate(ocrBusy ? "جارٍ قراءة الصورة..." : "قراءة الغلاف محلياً", language)}</button></header>
            {ocrBusy && <p className="photo-search-progress"><LoaderCircle size={14} className="spin" />{translate("جارٍ تحليل النص على جهازك", language)} {ocrProgress}%</p>}
            {ocrText && <><label className="photo-ocr-label">{translate("النص المقروء — راجعه وعدّله قبل البحث", language)}<textarea value={ocrText} onChange={event => setOcrText(event.target.value)} rows={4} /></label><div className="photo-lookup-consent"><p>{translate("سيُرسل النص الذي تراجعه فقط إلى Google Books عند الضغط على البحث. لن تُرسل الصورة.", language)}</p><button type="button" className="outline-button" onClick={() => void lookupMetadata()} disabled={lookupBusy || !navigator.onLine}>{lookupBusy ? <LoaderCircle size={14} className="spin" /> : <Search size={14} />}{translate("ابحث في بيانات الكتب", language)}</button></div></>}
            {results.length > 0 && <div className="photo-book-results">{results.map((result, index) => <article className="photo-book-result" key={`${result.title}-${index}`}>{result.thumbnail && <img src={result.thumbnail} alt="" loading="lazy" />}<div><b>{result.title}</b>{result.author && <small>{result.author}</small>}{result.publisher && <small>{result.publisher}{result.printYear ? ` · ${result.printYear}` : ""}</small>}{result.isbn && <small>ISBN: {result.isbn}</small>}{result.description && <p>{result.description}</p>}</div><button type="button" className="primary-button compact" onClick={() => { setOpen(false); onUseCandidate(result); }}><Check size={14} />{translate("استخدم البيانات", language)}</button></article>)}</div>}
          </section>}
          {notice && <p className="photo-search-notice" role="status">{notice}</p>}
          <p className="photo-search-footnote">{translate("يمكن استخدام مطابقة صورك دون اتصال. البحث الخارجي في Google Books يحتاج اتصالاً بالإنترنت.", language)}</p>
        </div>
      </section>
    </div>, document.body)}
  </>;
}
