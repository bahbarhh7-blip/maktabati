import { useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, CalendarDays, FileImage, ImagePlus, LoaderCircle, Plus, Search, ShieldCheck, Trash2, Upload, UserRound, X, ZoomIn } from "lucide-react";
import type { Book, BookModule, IjazahImage, IjazahRecord } from "@/lib/models";
import { moduleInfo } from "@/lib/models";
import { translate, type AppLanguage } from "@/lib/i18n";

type Props = {
  books: Book[];
  ijazahs: IjazahRecord[];
  language: AppLanguage;
  fixedBook?: Book;
  canAdd?: boolean;
  previewOnly?: boolean;
  compact?: boolean;
  onSave: (record: IjazahRecord) => void | Promise<void>;
  onDelete: (record: IjazahRecord) => void | Promise<void>;
  onBack?: () => void;
  onOpenBook?: (book: Book) => void;
};

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 250 * 1024;
const docImageSrc = (image: IjazahImage) => image.data;

async function compressDocumentImage(file: File): Promise<IjazahImage> {
  const bitmap = await createImageBitmap(file);
  let width = Math.min(bitmap.width, 1800);
  let height = Math.max(1, Math.round(bitmap.height * width / bitmap.width));
  if (height > 2400) {
    width = Math.max(1, Math.round(width * 2400 / height));
    height = 2400;
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("تعذرت معالجة الصورة.");
  }
  let blob: Blob | null = null;
  for (let pass = 0; pass < 8; pass++) {
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.7, 0.6, 0.5, 0.42]) {
      blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", quality));
      if (blob && blob.size <= MAX_IMAGE_BYTES) break;
    }
    if (blob && blob.size <= MAX_IMAGE_BYTES) break;
    width *= 0.84;
    height *= 0.84;
  }
  bitmap.close();
  if (!blob || blob.size > MAX_IMAGE_BYTES) throw new Error("تعذر ضغط الصورة إلى الحجم المسموح؛ جرّب صورة أوضح أو أصغر.");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("تعذرت قراءة الصورة."));
    reader.readAsDataURL(blob!);
  });
  return { id: crypto.randomUUID(), name: (file.name || "وثيقة إجازة").slice(0, 300), data };
}

function emptyRecord(bookId: string | null, bookTitle = ""): IjazahRecord {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), bookId, bookTitle, title: "", grantor: "", grantee: "", issuedAt: "", matn: "", notes: "", images: [], createdAt: now, updatedAt: now };
}

export default function IjazahManager({ books, ijazahs, language, fixedBook, canAdd = true, previewOnly = false, compact = false, onSave, onDelete, onBack, onOpenBook }: Props) {
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState<"all" | BookModule>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [editing, setEditing] = useState<IjazahRecord | null>(null);
  const [viewer, setViewer] = useState<{ record: IjazahRecord; index: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const bookMap = useMemo(() => new Map(books.map(book => [book.id, book])), [books]);
  const records = useMemo(() => {
    const term = search.trim().toLocaleLowerCase(language === "en" ? "en" : "ar");
    return ijazahs.filter(record => {
      if (record.deleted || fixedBook && record.bookId !== fixedBook.id) return false;
      const book = record.bookId ? bookMap.get(record.bookId) : undefined;
      if (record.bookId && (!book || book.deleted)) return false;
      if (moduleFilter !== "all" && (!book || book.module !== moduleFilter)) return false;
      if (fromDate && (!record.issuedAt || record.issuedAt < fromDate)) return false;
      if (toDate && (!record.issuedAt || record.issuedAt > toDate)) return false;
      if (!term) return true;
      return [record.title, record.grantor, record.grantee, record.issuedAt, record.matn, record.notes, record.bookTitle, book?.title, book?.author]
        .some(value => String(value ?? "").toLocaleLowerCase(language === "en" ? "en" : "ar").includes(term));
    }).sort((a, b) => (b.issuedAt || b.createdAt).localeCompare(a.issuedAt || a.createdAt));
  }, [ijazahs, fixedBook?.id, bookMap, moduleFilter, search, language, fromDate, toDate]);
  const hasFilters = Boolean(search || fromDate || toDate || moduleFilter !== "all");
  const canAddHere = !previewOnly && canAdd && (!fixedBook || books.some(book => book.id === fixedBook.id && !book.deleted));

  const startNew = () => {
    if (!canAddHere) return;
    setNotice("");
    setEditing(emptyRecord(fixedBook?.id ?? null, fixedBook?.title ?? ""));
  };
  const addImages = async (files: FileList | File[]) => {
    if (!editing) return;
    const remaining = MAX_IMAGES - editing.images.length;
    if (remaining <= 0) { setNotice(translate("يمكن إضافة 8 صور كحد أقصى لكل إجازة.", language)); return; }
    setBusy(true);
    setNotice("");
    try {
      const accepted = Array.from(files).filter(file => file.type.startsWith("image/")).slice(0, remaining);
      const next: IjazahImage[] = [];
      for (const file of accepted) next.push(await compressDocumentImage(file));
      if (!next.length) throw new Error("اختر ملف صورة صالحاً.");
      setEditing(current => current ? { ...current, images: [...current.images, ...next], updatedAt: new Date().toISOString() } : current);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذرت معالجة الصورة.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const updateDraft = <K extends keyof IjazahRecord>(key: K, value: IjazahRecord[K]) => setEditing(current => current ? { ...current, [key]: value } : current);
  const saveDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const linkedBook = editing.bookId ? bookMap.get(editing.bookId) : undefined;
    if (editing.bookId && (!linkedBook || linkedBook.deleted)) {
      setNotice(translate("اختر كتاباً صالحاً من مكتبتك، أو أزل الربط لتسجيل الإجازة مستقلة.", language));
      return;
    }
    if (!editing.bookId && !editing.bookTitle.trim()) {
      setNotice(translate("اكتب اسم الكتيب أو المتن، أو اختر كتاباً من مكتبتك.", language));
      return;
    }
    if (!editing.grantor.trim() && !editing.grantee.trim() && !editing.title.trim() && !editing.bookTitle.trim() && !editing.matn.trim() && !editing.notes.trim() && !editing.images.length) {
      setNotice(translate("أضف بيانات أو صورة واحدة على الأقل للإجازة.", language));
      return;
    }
    await onSave({ ...editing, bookTitle: linkedBook?.title ?? editing.bookTitle.trim(), title: editing.title.trim(), grantor: editing.grantor.trim(), grantee: editing.grantee.trim(), matn: editing.matn.trim(), notes: editing.notes.trim(), updatedAt: new Date().toISOString() });
    setEditing(null);
  };
  const deleteRecord = async (record: IjazahRecord) => {
    if (!window.confirm(translate("هل تريد حذف هذه الإجازة من فهرسك الخاص؟", language))) return;
    await onDelete({ ...record, deleted: true, updatedAt: new Date().toISOString() });
  };

  return <section className={`ijazah-manager ${compact ? "compact" : ""}`}>
    {!compact && <header className="ijazah-page-heading">
      {onBack && <button className="back-button" onClick={onBack}><ArrowLeft size={17} />{translate("الرئيسية", language)}</button>}
      <div className="ijazah-heading-copy"><span className="ijazah-heading-icon"><BookOpen size={20} /></span><div><h1>{translate("الإجازات العلمية", language)}</h1><p>{translate(previewOnly ? "معاينة قسم الإجازات فارغة؛ لا توجد سجلات أو بيانات مستخدمين هنا." : "إجازاتك وسنداتك الخاصة؛ اربطها بكتاب أو سجلها مستقلة باسم كتيب أو متن.", language)}</p></div></div>
      <span className="ijazah-private"><ShieldCheck size={15} />{translate("خاصة بحسابك", language)}</span>
    </header>}
    <div className="ijazah-tools">
      <label className="search-field"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={translate("ابحث بالكتاب أو المجيز أو المجاز له...", language)} /><button type="button" className="clear-search" onClick={() => setSearch("")} hidden={!search}><X size={14} /></button></label>
      {!fixedBook && <select className="ijazah-module-filter" value={moduleFilter} onChange={event => setModuleFilter(event.target.value as "all" | BookModule)} aria-label={translate("تصفية حسب القسم", language)}><option value="all">{translate("جميع الأقسام", language)}</option>{(["library", "surplus", "borrowed", "wishlist"] as BookModule[]).map(id => <option key={id} value={id}>{translate(moduleInfo[id].title, language)}</option>)}</select>}
      {!fixedBook && <><label className="ijazah-date-filter"><span>{translate("تاريخ صدور الإجازة من", language)}</span><input type="date" aria-label={translate("تاريخ صدور الإجازة من", language)} value={fromDate} max={toDate || undefined} onChange={event => setFromDate(event.target.value)} /></label><label className="ijazah-date-filter"><span>{translate("تاريخ صدور الإجازة إلى", language)}</span><input type="date" aria-label={translate("تاريخ صدور الإجازة إلى", language)} value={toDate} min={fromDate || undefined} onChange={event => setToDate(event.target.value)} /></label></>}
      {canAddHere && <button className="primary-button ijazah-add" onClick={startNew}><Plus size={17} />{translate("إضافة إجازة", language)}</button>}
      {!fixedBook && <p className="ijazah-filter-hint">{translate("حقلا التاريخ لتصفية القائمة حسب تاريخ صدور الإجازة، وليسا تاريخين جديدين للسجل.", language)}</p>}
    </div>
    {!canAdd && fixedBook && <div className="ijazah-hint">{translate("احفظ الكتاب أولاً، ثم أضف إجازته من هذا التبويب.", language)}</div>}
    {records.length ? <div className="ijazah-list">{records.map(record => {
      const book = record.bookId ? bookMap.get(record.bookId) : undefined;
      const cover = record.images[0];
      return <article className="ijazah-card" key={record.id}>
        <div className="ijazah-card-images">{cover ? <button className="ijazah-cover-thumb" onClick={() => setViewer({ record, index: 0 })} aria-label={translate("عرض صورة وثيقة الإجازة", language)}><img src={docImageSrc(cover)} alt={cover.name} /><span><ZoomIn size={13} />{record.images.length}</span></button> : <span className="ijazah-cover-empty"><BookOpen size={23} /></span>}</div>
        <div className="ijazah-card-main"><div className="ijazah-card-title"><h3>{record.title || translate("إجازة علمية", language)}</h3>{record.issuedAt && <span><CalendarDays size={13} />{record.issuedAt}</span>}</div>
          {book ? fixedBook ? <span className="ijazah-book-link static"><BookOpen size={14} />{book.title}</span> : <button className="ijazah-book-link" onClick={() => onOpenBook?.(book)}><BookOpen size={14} />{book.title}<small>{translate(moduleInfo[book.module].title, language)}</small></button> : <span className="ijazah-book-link standalone"><BookOpen size={14} />{record.bookTitle || translate("كتيب أو متن", language)}<small>{translate("إجازة مستقلة", language)}</small></span>}
          <div className="ijazah-people">{record.grantor && <span><UserRound size={13} />{translate("المجيز", language)}: {record.grantor}</span>}{record.grantee && <span><UserRound size={13} />{translate("المجاز له", language)}: {record.grantee}</span>}</div>
          {record.matn && <p className="ijazah-matn">{translate("المتن", language)}: {record.matn}</p>}
          {record.notes && <p className="ijazah-notes">{record.notes}</p>}
          {record.images.length > 1 && <div className="ijazah-thumbnails">{record.images.slice(1, 4).map((image, index) => <button key={image.id} onClick={() => setViewer({ record, index: index + 1 })}><img src={docImageSrc(image)} alt={image.name} /></button>)}{record.images.length > 4 && <span>+{record.images.length - 4}</span>}</div>}
        </div>
        {!previewOnly && <div className="ijazah-card-actions"><button className="outline-button" onClick={() => { setNotice(""); setEditing({ ...record, images: [...record.images] }); }}>{translate("تعديل", language)}</button><button className="icon-button danger-icon" onClick={() => void deleteRecord(record)} aria-label={translate("حذف الإجازة", language)}><Trash2 size={16} /></button></div>}
      </article>;
    })}</div> : <div className="ijazah-empty"><div><FileImage size={27} /></div><h2>{hasFilters ? translate("لا توجد نتائج مطابقة", language) : translate("لا توجد إجازات مسجلة", language)}</h2><p>{hasFilters ? translate("جرّب البحث باسم الكتاب أو أحد أطراف الإجازة.", language) : translate(previewOnly ? "تظهر هذه الواجهة فارغة في وضع الضيف، ولا تعرض إجازات أي مستخدم." : "أضف سند الإجازة وصور وثيقتها لتبقى محفوظة مع الكتاب.", language)}</p>{canAddHere && <button className="outline-button" onClick={startNew}><Plus size={16} />{translate("إضافة أول إجازة", language)}</button>}</div>}

    {!previewOnly && editing && <div className="modal-backdrop ijazah-editor-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(null); }}><form className="modal ijazah-editor-modal" role="dialog" aria-modal="true" aria-labelledby="ijazah-editor-title" onSubmit={event => void saveDraft(event)}>
      <header className="modal-heading"><span className="ijazah-heading-icon"><BookOpen size={19} /></span><div><h2 id="ijazah-editor-title">{translate("بيانات الإجازة", language)}</h2><p>{translate("يمكن ربطها بكتابك أو تسجيلها مستقلة باسم كتيب، وستبقى خاصة بحسابك.", language)}</p></div><button type="button" className="icon-button" onClick={() => setEditing(null)} aria-label={translate("إغلاق", language)}><X size={18} /></button></header>
      <div className="modal-form-scroll ijazah-form-scroll">
        {!fixedBook && <><label className="field field-wide"><span>{translate("الربط بكتاب من مكتبتي (اختياري)", language)}</span><select value={editing.bookId ?? ""} onChange={event => updateDraft("bookId", event.target.value || null)}><option value="">{translate("دون ربط بكتاب من مكتبتي", language)}</option>{books.filter(book => !book.deleted).map(book => <option value={book.id} key={book.id}>{book.title} — {translate(moduleInfo[book.module].title, language)}</option>)}</select><small>{translate("يمكنك إضافة الإجازة مستقلة بكتابة اسم الكتيب أو المتن، دون إضافته إلى مكتبتي.", language)}</small></label>{!editing.bookId && <label className="field field-wide"><span>{translate("اسم الكتيب أو الكتاب أو المتن", language)} *</span><input value={editing.bookTitle ?? ""} onChange={event => updateDraft("bookTitle", event.target.value)} placeholder={translate("مثال: كتيب صغير في التجويد أو متن علمي", language)} maxLength={500} required /></label>}</>}
        {fixedBook && <div className="ijazah-linked-book"><BookOpen size={15} />{fixedBook.title}</div>}
        <div className="form-grid"><label className="field field-wide"><span>{translate("عنوان الإجازة", language)}</span><input value={editing.title} onChange={event => updateDraft("title", event.target.value)} placeholder={translate("مثال: إجازة في متن...", language)} maxLength={500} /></label>
          <label className="field"><span>{translate("المجيز", language)}</span><input value={editing.grantor} onChange={event => updateDraft("grantor", event.target.value)} placeholder={translate("اسم الشيخ أو المجيز", language)} maxLength={500} /></label>
          <label className="field"><span>{translate("المجاز له", language)}</span><input value={editing.grantee} onChange={event => updateDraft("grantee", event.target.value)} placeholder={translate("اسم المجاز له", language)} maxLength={500} /></label>
          <label className="field"><span>{translate("تاريخ الإجازة", language)}</span><input type="date" value={editing.issuedAt} onChange={event => updateDraft("issuedAt", event.target.value)} /></label>
          <label className="field"><span>{translate("المتن أو الفن", language)}</span><input value={editing.matn} onChange={event => updateDraft("matn", event.target.value)} placeholder={translate("اسم المتن أو الفن", language)} maxLength={1000} /></label>
          <label className="field field-wide"><span>{translate("نص السند أو ملاحظات", language)}</span><textarea rows={3} value={editing.notes} onChange={event => updateDraft("notes", event.target.value)} placeholder={translate("دوّن نص السند أو أي بيانات ترغب بحفظها.", language)} maxLength={20000} /></label>
        </div>
        <section className="ijazah-upload-section"><div className="ijazah-upload-heading"><div><h3>{translate("صور وثيقة الإجازة", language)}</h3><p>{translate("صور خاصة محفوظة مع سجل الإجازة، حتى 8 صفحات.", language)}</p></div><span>{editing.images.length} / {MAX_IMAGES}</span></div>
          <div className="ijazah-upload-control"><input ref={fileRef} type="file" accept="image/*" multiple capture="environment" hidden onChange={event => event.target.files && void addImages(event.target.files)} /><button type="button" className="ijazah-upload-zone" onClick={() => fileRef.current?.click()} disabled={busy || editing.images.length >= MAX_IMAGES}>{busy ? <LoaderCircle size={22} className="spin" /> : <Upload size={22} />}<b>{translate("ارفع صوراً أو التقط صفحات الوثيقة", language)}</b><small>{translate("تُضغط الصور محلياً حتى 250 كيلوبايت للصورة وتبقى خاصة.", language)}</small></button></div>
          {notice && <div className="inline-alert">{translate(notice, language)}</div>}
          {!!editing.images.length && <div className="ijazah-image-grid">{editing.images.map((image, index) => <div className="ijazah-image-thumb" key={image.id}><button type="button" className="ijazah-image-open" onClick={() => setViewer({ record: editing, index })}><img src={docImageSrc(image)} alt={image.name} /><span>{index + 1}</span></button><button type="button" className="ijazah-image-remove" onClick={() => updateDraft("images", editing.images.filter(item => item.id !== image.id))} aria-label={translate("حذف الصورة", language)}><X size={14} /></button></div>)}</div>}
          {!editing.images.length && <p className="muted-note">{translate("لم تُرفع صور بعد. يمكنك حفظ البيانات وإضافة الصور لاحقاً.", language)}</p>}
        </section>
      </div>
      <footer className="modal-footer"><button className="primary-button" disabled={busy}><Plus size={16} />{translate("حفظ الإجازة", language)}</button><button type="button" className="outline-button" onClick={() => setEditing(null)}>{translate("إلغاء", language)}</button></footer>
    </form></div>}
    {viewer && <div className="ijazah-viewer" role="dialog" aria-modal="true" onMouseDown={event => { if (event.target === event.currentTarget) setViewer(null); }}><button className="ijazah-viewer-close" onClick={() => setViewer(null)} aria-label={translate("إغلاق", language)}><X /></button><div className="ijazah-viewer-image"><img src={docImageSrc(viewer.record.images[viewer.index])} alt={viewer.record.images[viewer.index]?.name} /></div><div className="ijazah-viewer-caption"><span>{viewer.record.images[viewer.index]?.name}</span><span>{viewer.index + 1} / {viewer.record.images.length}</span><div><button disabled={viewer.index <= 0} onClick={() => setViewer(value => value ? { ...value, index: value.index - 1 } : value)}>{translate("السابق", language)}</button><button disabled={viewer.index >= viewer.record.images.length - 1} onClick={() => setViewer(value => value ? { ...value, index: value.index + 1 } : value)}>{translate("التالي", language)}</button></div></div></div>}
  </section>;
}
