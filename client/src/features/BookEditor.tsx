import { useRef, useState } from "react";
import { BookOpen, Camera, Check, ChevronLeft, ChevronRight, FileImage, ImagePlus, Link2, LoaderCircle, Plus, Search, Star, Trash2, Upload, X, ZoomIn } from "lucide-react";
import type { Book, BookImage, BookModule, IjazahRecord } from "@/lib/models";
import IjazahManager from "@/features/IjazahManager";
import { moduleInfo } from "@/lib/models";
import { translate, type AppLanguage } from "@/lib/i18n";

type Props = { language: AppLanguage; book: Book; module: BookModule; books: Book[]; ijazahs: IjazahRecord[]; canManageIjazahs: boolean; onSaveIjazah: (record: IjazahRecord) => void | Promise<void>; onDeleteIjazah: (record: IjazahRecord) => void | Promise<void>; onSave: (book: Book) => void | Promise<void>; onClose: () => void };
type FieldProps = { language: AppLanguage; label: string; value?: string | number; onChange: (value: string) => void; placeholder?: string; type?: string; wide?: boolean; required?: boolean; as?: "textarea" | "select"; options?: string[] };
function Field({ language, label, value = "", onChange, placeholder, type = "text", wide, required, as, options }: FieldProps) {
  return <label className={`field ${wide ? "field-wide" : ""}`}><span>{label}{required && <b className="required"> *</b>}</span>{as === "textarea" ? <textarea value={String(value)} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} /> : as === "select" ? <select value={String(value)} onChange={e => onChange(e.target.value)}>{(options ?? []).map(v => <option key={v} value={v}>{translate(v, language)}</option>)}</select> : <input type={type} value={String(value)} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required} />}</label>;
}
function RichField({ language, label, value, onChange, placeholder }: { language: AppLanguage; label: string; value: string; onChange: (s: string) => void; placeholder: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrap = (before: string, after = before) => {
    const el = ref.current; if (!el) return;
    const start = el.selectionStart, end = el.selectionEnd;
    const next = value.slice(0, start) + before + (value.slice(start, end) || "نص") + after + value.slice(end);
    onChange(next); requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + before.length, end + before.length); });
  };
  return <div className="field rich-field field-wide"><span>{label}</span><div className="rich-toolbar"><button type="button" onClick={() => wrap("**")} title={translate("عريض", language)}><b>B</b></button><button type="button" onClick={() => wrap("_")} title={translate("مائل", language)}><i>I</i></button><button type="button" onClick={() => wrap("__")} title={translate("تحته خط", language)}><u>U</u></button><button type="button" onClick={() => wrap("\n- ", "")} title={translate("قائمة", language)}>☷</button><button type="button" onClick={() => { if (ref.current) ref.current.style.textAlign = "right"; }}>≡</button><button type="button" onClick={() => { if (ref.current) ref.current.style.textAlign = "center"; }}>☰</button></div><textarea ref={ref} rows={4} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></div>;
}
async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  let width = Math.min(bitmap.width, 800);
  let height = Math.max(1, Math.round(bitmap.height * width / bitmap.width));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d"); if (!ctx) { bitmap.close(); throw new Error("تعذر معالجة الصورة"); }
  let blob: Blob | null = null;
  for (let pass = 0; pass < 6; pass++) {
    canvas.width = Math.max(1, Math.round(width)); canvas.height = Math.max(1, Math.round(height));
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.7, 0.6, 0.5]) {
      blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", quality));
      if (blob && blob.size <= 150 * 1024) break;
    }
    if (blob && blob.size <= 150 * 1024) break;
    width *= 0.82; height *= 0.82;
  }
  bitmap.close();
  if (!blob) throw new Error("تعذر ضغط الصورة");
  if (blob.size > 500 * 1024) throw new Error("تعذر ضغط هذه الصورة إلى أقل من 500 كيلوبايت؛ جرّب صورة أخرى.");
  return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
}
export default function BookEditor({ language, book: initial, module, books, ijazahs, canManageIjazahs, onSaveIjazah, onDeleteIjazah, onSave, onClose }: Props) {
  const [book, setBook] = useState<Book>({ ...initial, module });
  const [tab, setTab] = useState<"details" | "children" | "ijazahs">("details");
  const [imageTab, setImageTab] = useState<"upload" | "url">("upload");
  const [imageUrl, setImageUrl] = useState("");
  const [childTitle, setChildTitle] = useState("");
  const [childSearch, setChildSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const accent = moduleInfo[module].accent;
  const displaySrc = (image: BookImage) => image.backupData || image.src;
  const update = <K extends keyof Book>(key: K, value: Book[K]) => setBook(prev => ({ ...prev, [key]: value, updatedAt: new Date().toISOString() }));
  const addFiles = async (files: FileList | File[]) => {
    setNotice(""); setBusy(true);
    try {
      const additions: BookImage[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const src = await compressImage(file);
        additions.push({ id: crypto.randomUUID(), src, name: file.name, kind: "upload", isCover: book.images.length === 0 && additions.length === 0 });
      }
      if (additions.length) update("images", [...book.images, ...additions]);
      else setNotice("لم يتم اختيار صورة صالحة.");
    } catch (e) { setNotice(e instanceof Error ? e.message : "تعذرت معالجة الصورة."); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; if (cameraRef.current) cameraRef.current.value = ""; }
  };
  const addUrl = () => {
    try {
      const url = new URL(imageUrl.trim());
      if (!/^https?:$/.test(url.protocol)) throw new Error();
      const item: BookImage = { id: crypto.randomUUID(), src: url.href, name: "صورة من رابط ويب", kind: "url", isCover: book.images.length === 0 };
      update("images", [...book.images, item]); setImageUrl(""); setNotice("");
    } catch { setNotice("أدخل رابط صورة صحيحاً يبدأ بـ https:// أو http://"); }
  };
  const searchCover = async () => {
    if (!book.title.trim()) { setNotice("أدخل اسم الكتاب أولاً للبحث عن غلافه."); return; }
    setBusy(true); setNotice("");
    try {
      const q = new URLSearchParams({ q: `intitle:${book.title} inauthor:${book.author}`, maxResults: "1" });
      const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${q}`);
      if (response.ok) {
        const data = await response.json(); const link = data.items?.[0]?.volumeInfo?.imageLinks?.thumbnail?.replace("http:", "https:");
        if (link) { addRemoteCover(link, book.title); return; }
      }
    } catch { /* fall through to Open Library */ }
    try {
      const q = new URLSearchParams({ title: book.title, author: book.author, limit: "1", fields: "cover_i,title" });
      const response = await fetch(`https://openlibrary.org/search.json?${q}`);
      const data = await response.json(); const cover = data.docs?.[0]?.cover_i;
      if (cover) { addRemoteCover(`https://covers.openlibrary.org/b/id/${cover}-L.jpg`, book.title); return; }
    } catch { /* handled below */ }
    setNotice("لم نعثر على غلاف متاح؛ يمكنك إضافة رابط صورة مباشر."); setBusy(false);
  };
  const addRemoteCover = (src: string, name: string) => { update("images", [...book.images, { id: crypto.randomUUID(), src, name: `غلاف ${name}`, kind: "url", isCover: book.images.length === 0 }]); setBusy(false); };
  const removeImage = (id: string) => update("images", book.images.filter(i => i.id !== id).map((i, n) => ({ ...i, isCover: i.isCover || n === 0 })));
  const setCover = (id: string) => update("images", book.images.map(i => ({ ...i, isCover: i.id === id })));
  const section = (title: string, children: React.ReactNode, icon?: React.ReactNode) => <section className="editor-section"><h3 style={{ color: accent }}>{icon}{translate(title, language)}</h3><div className="form-grid">{children}</div></section>;
  const saveBook = async () => {
    if (!book.title.trim()) { setTab("details"); setNotice("اسم الكتاب مطلوب."); return; }
    if (saving || busy) return;
    setSaving(true); setSaveError("");
    try { await onSave({ ...book, title: book.title.trim(), updatedAt: new Date().toISOString() }); }
    catch { setSaveError("تعذر حفظ الكتاب على هذا الجهاز. بقيت التعديلات في المحرر؛ تحقق من مساحة التخزين ثم حاول ثانية."); }
    finally { setSaving(false); }
  };

  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal book-modal" role="dialog" aria-modal="true" aria-labelledby="book-editor-title" style={{ "--accent": accent } as React.CSSProperties}>
    <header className="modal-heading"><div className="module-glyph small" style={{ background: `${accent}20`, color: accent }}><BookOpen size={19} /></div><div><h2 id="book-editor-title">{initial.title ? translate("تعديل بيانات الكتاب", language) : translate("إضافة كتاب جديد", language)}</h2><p>{translate("أضف تفاصيل كتابك وصوره ومكانه في رفوفك.", language)}</p></div><button className="icon-button" onClick={onClose} aria-label={translate("إغلاق", language)}><X size={19} /></button></header>
    <div className="editor-tabs"><button className={tab === "details" ? "active" : ""} onClick={() => setTab("details")}>{translate("بيانات الكتاب", language)}</button><button className={tab === "children" ? "active" : ""} onClick={() => setTab("children")}>{translate("كتب فرعية (", language)}{book.subBooks.length})</button><button className={tab === "ijazahs" ? "active" : ""} onClick={() => setTab("ijazahs")}>{translate("الإجازات", language)} ({ijazahs.filter(record => record.bookId === book.id && !record.deleted).length})</button></div>
    {tab === "details" ? <div className="editor-scroll">
      {section("المعلومات الأساسية", <><Field language={language} label={translate("اسم الكتاب", language)} value={book.title} onChange={v => update("title", v)} placeholder={translate("عنوان الكتاب", language)} wide required /><Field language={language} label={translate("المؤلف", language)} value={book.author} onChange={v => update("author", v)} placeholder={translate("اسم المؤلف", language)} /><Field language={language} label={translate("سنة وفاة المؤلف", language)} value={book.deathYear} onChange={v => update("deathYear", v)} placeholder={translate("748 هـ أو 1348 م", language)} /><Field language={language} label={translate("العلم", language)} value={book.subject} onChange={v => update("subject", v)} placeholder={translate("التفسير، التاريخ...", language)} /><Field language={language} label={translate("اللغة", language)} value={book.language} onChange={v => update("language", v)} /></>)}
      {section("بيانات الطبعة", <><Field language={language} label={translate("دار النشر", language)} value={book.publisher} onChange={v => update("publisher", v)} placeholder={translate("دار النشر", language)} /><Field language={language} label={translate("المحقق", language)} value={book.editor} onChange={v => update("editor", v)} placeholder={translate("اسم المحقق", language)} /><Field language={language} label={translate("رقم الطبعة", language)} value={book.edition} onChange={v => update("edition", v)} /><Field language={language} label={translate("سنة الطباعة", language)} value={book.printYear} onChange={v => update("printYear", v)} /></>)}
      {section("المواصفات المادية", <><Field language={language} label={translate("عدد المجلدات", language)} type="number" value={book.volumes} onChange={v => update("volumes", Number(v))} /><Field language={language} label={translate("عدد الصفحات", language)} type="number" value={book.pages} onChange={v => update("pages", v ? Number(v) : "")} /><Field language={language} label={translate("حجم المجلد", language)} value={book.volumeSize} onChange={v => update("volumeSize", v)} placeholder={translate("كبير، متوسط...", language)} /><Field language={language} label={translate("لون الورق", language)} value={book.paperColor} onChange={v => update("paperColor", v)} as="select" options={["شامواه", "أبيض", "أصفر", "كريمي", "أخرى"]} /><Field language={language} label={translate("نوع الغلاف", language)} value={book.binding} onChange={v => update("binding", v)} placeholder={translate("مجلد فني، غلاف ورقي...", language)} wide /></>)}
      {section("المكان", <><Field language={language} label={translate("المكان", language)} value={book.location} onChange={v => update("location", v)} placeholder={translate("المنزل، المكتب...", language)} wide /><Field language={language} label={translate("الغرفة", language)} value={book.room} onChange={v => update("room", v)} /><Field language={language} label={translate("الدولاب", language)} value={book.cabinet} onChange={v => update("cabinet", v)} /><Field language={language} label={translate("الرف", language)} value={book.shelf} onChange={v => update("shelf", v)} /><Field language={language} label={translate("الرقم", language)} value={book.number} onChange={v => update("number", v)} /></>)}
      {section("الاقتناء", <><Field language={language} label={translate("المصدر", language)} value={book.source} onChange={v => update("source", v)} as="select" options={["شراء", "إهداء", "وقف", "استعارة", "أخرى"]} /><Field language={language} label={translate("التكلفة", language)} type="number" value={book.cost} onChange={v => update("cost", v ? Number(v) : "")} /><Field language={language} label={translate("تاريخ الاقتناء", language)} type="date" value={book.acquiredAt} onChange={v => update("acquiredAt", v)} wide /></>)}
      {section("معلومات الإعارة", <><Field language={language} label={translate("المستعير", language)} value={book.borrower} onChange={v => update("borrower", v)} /><Field language={language} label={translate("تاريخ الإعارة", language)} type="date" value={book.lentAt} onChange={v => update("lentAt", v)} /><Field language={language} label={translate("تاريخ الإرجاع", language)} type="date" value={book.dueAt} onChange={v => update("dueAt", v)} /><Field language={language} label={translate("ملاحظات الإعارة", language)} value={book.loanNotes} onChange={v => update("loanNotes", v)} wide /></>)}
      {section("قراءة وفوائد", <><Field language={language} label={translate("تاريخ بداية القراءة", language)} type="date" value={book.readingStarted} onChange={v => update("readingStarted", v)} /><Field language={language} label={translate("تاريخ انتهاء القراءة", language)} type="date" value={book.readingFinished} onChange={v => update("readingFinished", v)} /><RichField language={language} label={translate("فوائد", language)} value={book.benefits} onChange={v => update("benefits", v)} placeholder={translate("اكتب الفوائد أو ألصق روابط خارجية...", language)} /></>)}
      {section("المعلومات الإضافية", <RichField language={language} label={translate("ملاحظات", language)} value={book.notes} onChange={v => update("notes", v)} placeholder={translate("اكتب ملاحظاتك هنا...", language)} />)}
      {section("صور الكتاب", <div className="field-wide image-manager">
        <div className="image-toolbar"><div className="segmented"><button className={imageTab === "upload" ? "selected" : ""} onClick={() => setImageTab("upload")}><Camera size={15} />{translate("رفع صورة", language)}</button><button className={imageTab === "url" ? "selected" : ""} onClick={() => setImageTab("url")}><Link2 size={15} />{translate("رابط ويب", language)}</button></div><span>{book.images.length}{translate("صور مضافة", language)}</span></div>
        {imageTab === "upload" ? <div className="upload-zone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void addFiles(e.dataTransfer.files); }} onClick={() => fileRef.current?.click()}><input ref={fileRef} hidden type="file" accept="image/*" multiple onChange={e => e.target.files && void addFiles(e.target.files)} /><input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={e => e.target.files && void addFiles(e.target.files)} /><div className="upload-icon">{busy ? <LoaderCircle className="spin" /> : <Upload size={21} />}</div><strong>{translate("اسحب الصورة هنا أو اضغط للاختيار", language)}</strong><small>{translate("الحد الأقصى 500 كيلوبايت بعد الضغط الذكي", language)}</small><div className="upload-actions"><button type="button" onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}><FileImage size={15} />{translate("اختيار ملف", language)}</button><button type="button" onClick={e => { e.stopPropagation(); cameraRef.current?.click(); }}><Camera size={15} />{translate("التقاط بالكاميرا", language)}</button></div></div> : <div className="url-add"><input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder={translate("أدخل رابط الصورة المباشر (https://...)", language)} /><button className="primary-button" onClick={addUrl}><Plus size={16} />{translate("إضافة الصورة", language)}</button><button className="outline-button" onClick={() => void searchCover()} disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}{translate("بحث تلقائي عن غلاف الكتاب", language)}</button></div>}
        {notice && <p className="inline-alert">{translate(notice, language)}</p>}
        {!book.images.length ? <div className="gallery-empty"><ImagePlus size={25} /><span>{translate("لم تتم إضافة أي صور بعد — يمكنك رفع صور غلاف الكتاب أو صفحات مهمة منه للرجوع إليها", language)}</span></div> : <div className="image-gallery">{book.images.map((image, i) => <div key={image.id} className={`image-thumb ${image.isCover ? "cover" : ""}`}><img src={displaySrc(image)} alt={image.name} onClick={() => setLightbox(i)} />{image.isCover && <span className="cover-badge"><Star size={11} fill="currentColor" />{translate("الغلاف الرئيسي", language)}</span>}<button className="thumb-zoom" onClick={() => setLightbox(i)} aria-label={translate("تكبير", language)}><ZoomIn size={14} /></button><button className="thumb-delete" onClick={() => removeImage(image.id)} aria-label={translate("حذف الصورة", language)}><Trash2 size={14} /></button>{!image.isCover && <button className="set-cover" onClick={() => setCover(image.id)}>{translate("تعيين غلاف", language)}</button>}</div>)}</div>}
      </div>)}
    </div> : tab === "children" ? <div className="editor-scroll child-books"><label className="search-field"><Search size={16} /><input value={childSearch} onChange={e => setChildSearch(e.target.value)} placeholder={translate("البحث في الكتب الفرعية", language)} /></label><div className="child-add"><input value={childTitle} onChange={e => setChildTitle(e.target.value)} placeholder={translate("عنوان الكتاب الفرعي", language)} onKeyDown={e => { if (e.key === "Enter" && childTitle.trim()) { e.preventDefault(); update("subBooks", [...book.subBooks, childTitle.trim()]); setChildTitle(""); } }} /><button className="primary-button" onClick={() => { if (childTitle.trim()) { update("subBooks", [...book.subBooks, childTitle.trim()]); setChildTitle(""); } }}><Plus size={16} />{translate("إضافة عنوان", language)}</button></div><p className="muted-note">{translate("احفظ الكتاب لتسجيل جميع التغييرات.", language)}</p><div className="child-list">{book.subBooks.filter(s => s.includes(childSearch)).map((title, i) => <div key={`${title}-${i}`}><BookOpen size={15} />{title}<button onClick={() => update("subBooks", book.subBooks.filter((_, n) => n !== i))}><Trash2 size={14} /></button></div>)}</div></div> : <div className="editor-scroll ijazah-editor-scroll"><IjazahManager books={books} ijazahs={ijazahs} language={language} fixedBook={book} canAdd={canManageIjazahs} compact onSave={onSaveIjazah} onDelete={onDeleteIjazah} /></div>}
    <footer className="modal-footer">{saveError && <p className="book-save-error" role="alert">{translate(saveError, language)}</p>}<button className="primary-button" onClick={() => void saveBook()} disabled={saving || busy}><Check size={16} />{translate(saving ? "جارٍ حفظ الكتاب..." : "حفظ الكتاب", language)}</button><button className="outline-button" onClick={onClose} disabled={saving}>{translate("إلغاء", language)}</button></footer>
    {lightbox !== null && <div className="lightbox" onMouseDown={e => { if (e.target === e.currentTarget) setLightbox(null); }}><button className="lightbox-close" onClick={() => setLightbox(null)}><X /></button><button className="lightbox-nav prev" onClick={() => setLightbox((lightbox - 1 + book.images.length) % book.images.length)}><ChevronRight /></button><img src={book.images[lightbox] ? displaySrc(book.images[lightbox]) : ""} alt={book.images[lightbox]?.name} /><button className="lightbox-nav next" onClick={() => setLightbox((lightbox + 1) % book.images.length)}><ChevronLeft /></button><span>{lightbox + 1} / {book.images.length}</span></div>}
  </div></div>;
}
