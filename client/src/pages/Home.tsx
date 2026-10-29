import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownAZ, ArrowLeft, BarChart3, BookCopy, BookMarked, BookOpen, BookmarkCheck, Check, ChevronDown, Cloud, CloudOff, Download, FileImage, FileJson, FileSpreadsheet, Filter, LibraryBig, LogOut, Menu, Moon, Plus, Printer, Search, Settings, ShoppingCart, Sun, Ticket, Trash2, Upload, X } from "lucide-react";
import BookEditor from "@/features/BookEditor";
import BookPhotoSearch, { type ExternalBookCandidate } from "@/features/BookPhotoSearch";
import BookSearchBox from "@/features/BookSearchBox";
import PwaInstallButton from "@/features/PwaInstallButton";
import IjazahManager from "@/features/IjazahManager";
import DueReminderCenter from "@/features/DueReminderCenter";
import FairEditor from "@/features/FairEditor";
import SettingsModal from "@/features/SettingsModal";
import StatsModal from "@/features/StatsModal";
import { defaultPreferences, emptyBook, moduleInfo, MODULES, type Book, type BookModule, type Fair, type IjazahRecord, type ModuleId, type Preferences } from "@/lib/models";
import { localStore, selectLocalAccount } from "@/lib/offlineStore";
import { translate } from "@/lib/i18n";
import { fairsFromJson, fairsFromRows, fairsToRows } from "@/lib/fairImportExport";
import { sortBooks } from "@/lib/bookSorting";
import { rankBookMatches, scoreBookSearch } from "@/lib/bookSearch";
import { trpc } from "@/lib/trpc";

type Account = { id: number; name: string | null; email: string | null; openId?: string };
type SyncBook = { id: string; module: BookModule; data: string; deleted: boolean; updatedAt: string };
type SyncFair = { id: string; data: string; deleted: boolean; updatedAt: string };
type SyncBookInput = { id: string; module: BookModule; payload: string; deleted: boolean; updatedAt: string };
type SyncFairInput = { id: string; payload: string; deleted: boolean; updatedAt: string };
type SyncIjazah = { id: string; bookId: string | null; data: string; deleted: boolean; updatedAt: string };
type SyncIjazahInput = { id: string; bookId: string | null; payload: string; deleted: boolean; updatedAt: string };
const moduleIcons = { library: LibraryBig, surplus: BookCopy, borrowed: BookmarkCheck, wishlist: ShoppingCart, fair: Ticket };
const defaultLists = { subjects: [] as string[], authors: [] as string[], editors: [] as string[], publishers: [] as string[] };
const today = () => new Date().toISOString().slice(0, 10);
function dateLabel(value: string, calendar: Preferences["calendar"] = "gregory", language: "ar" | "en" = "ar") {
  const base = language === "en" ? "en" : "ar";
  const locale = calendar === "islamic" ? `${base}-u-ca-islamic` : `${base}-u-ca-gregory`;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}
const restoreRemoteBook = (book: Book): Book => ({ ...book, images: (book.images || []).map(image => image.backupData ? { ...image, src: image.backupData, cloudSrc: image.cloudSrc || image.src } : image) });
const imageDisplaySrc = (image: Book["images"][number]) => image.backupData || image.src;

function makeCsv(rows: Book[]) {
  const columns: (keyof Book)[] = ["title", "author", "deathYear", "subject", "language", "publisher", "editor", "edition", "printYear", "volumes", "pages", "volumeSize", "paperColor", "binding", "location", "room", "cabinet", "shelf", "number", "source", "cost", "acquiredAt", "borrower", "lentAt", "dueAt", "loanNotes", "readingStarted", "readingFinished", "benefits", "notes", "priority", "readState"];
  const quote = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  return [columns.join(","), ...rows.map(row => columns.map(col => quote(row[col])).join(","))].join("\r\n");
}
function parseCsv(text: string, module: BookModule): Book[] {
  const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean).map(line => { const out: string[] = []; let cell = "", quote = false; for (let i = 0; i < line.length; i++) { const c = line[i]!; if (c === '"' && quote && line[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quote = !quote; else if (c === "," && !quote) { out.push(cell); cell = ""; } else cell += c; } out.push(cell); return out; });
  if (rows.length < 2) return [];
  const keys = rows[0] as (keyof Book)[];
  return rows.slice(1).map(row => { const book = emptyBook(module); keys.forEach((key, i) => { if (key in book && row[i] !== undefined) (book as any)[key] = ["cost", "volumes", "pages"].includes(String(key)) && row[i] ? Number(row[i]) : row[i]; }); return book; }).filter(b => b.title.trim());
}
function saveDownload(name: string, data: BlobPart, type: string) { const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

export default function Home() {
  const auth = trpc.auth.me.useQuery(undefined, { retry: 2, retryDelay: attempt => Math.min(1000 * 2 ** attempt, 8000), refetchOnWindowFocus: true, refetchOnReconnect: "always", staleTime: 15_000 });
  const utils = trpc.useUtils();
  const syncBooksMutation = trpc.library.sync.useMutation();
  const syncFairsMutation = trpc.fairs.sync.useMutation();
  const syncIjazahsMutation = trpc.ijazahs.sync.useMutation();
  const syncPreferencesMutation = trpc.preferences.save.useMutation();
  const uploadImage = trpc.media.upload.useMutation();
  const [offlineAccount, setOfflineAccount] = useState<Account | null>(null);
  const [guestPreview, setGuestPreview] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [books, setBooks] = useState<Book[]>([]);
  const [fairs, setFairs] = useState<Fair[]>([]);
  const [ijazahs, setIjazahs] = useState<IjazahRecord[]>([]);
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [preferencesAccount, setPreferencesAccount] = useState<number | null>(null);
  const [lists, setLists] = useState(defaultLists);
  const [listsAccount, setListsAccount] = useState<number | null>(null);
  const [module, setModule] = useState<ModuleId>("library");
  const [screen, setScreen] = useState<"dashboard" | "module" | "ijazahs">("dashboard");
  const [search, setSearch] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");
  const [filterDraft, setFilterDraft] = useState<Record<string, string>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fairSearch, setFairSearch] = useState("");
  const [fairPlaceFilter, setFairPlaceFilter] = useState("");
  const [fairVisitFrom, setFairVisitFrom] = useState("");
  const [fairVisitTo, setFairVisitTo] = useState("");
  const [fairMinBudget, setFairMinBudget] = useState("");
  const [fairMaxBudget, setFairMaxBudget] = useState("");
  const [fairSort, setFairSort] = useState("visit-asc");
  const [sort, setSort] = useState("alpha");
  const [readOnly, setReadOnly] = useState({ read: false, reading: false, lent: false, due: false });
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [editingFair, setEditingFair] = useState<Fair | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [syncState, setSyncState] = useState<"loading" | "synced" | "pending" | "offline" | "error">("loading");
  const [syncNote, setSyncNote] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [syncRetry, setSyncRetry] = useState(0);
  const [expandedBook, setExpandedBook] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup" | "forgot" | "reset">(() => new URLSearchParams(window.location.search).has("reset") ? "reset" : "login");
  const [authNotice, setAuthNotice] = useState("");
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get("reset") ?? "");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [guestTheme, setGuestTheme] = useState<"dark" | "light">("dark");
  const [guestLanguage, setGuestLanguage] = useState<"ar" | "en">("ar");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "", remember: true });
  const loadedAccount = useRef<number | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const importJsonRef = useRef<HTMLInputElement>(null);
  const syncLock = useRef(false);
  const syncRequested = useRef(false);
  const localMutationVersion = useRef(0);
  const syncGeneration = useRef(0);
  const actualUser = auth.data as Account | null | undefined;
  const currentUser = guestPreview ? null : actualUser ?? offlineAccount;
  const markLocalMutation = () => { localMutationVersion.current += 1; if (syncLock.current) syncRequested.current = true; };
  const visibleBooks = guestPreview ? [] : books;
  const visibleFairs = guestPreview ? [] : fairs;
  const visibleIjazahs = guestPreview ? [] : ijazahs;
  const accent = moduleInfo[module].accent;
  const cardFields = preferences.cardFields[module === "fair" ? "library" : module];
  const language = currentUser ? preferences.language : guestLanguage;
  const fmt = (value: number) => new Intl.NumberFormat(language === "en" ? "en" : "ar", { numberingSystem: currentUser && preferences.digits === "arab" ? "arab" : "latn" }).format(value);
  const activeBooks = useMemo(() => visibleBooks.filter(b => !b.deleted && b.module !== "wishlist"), [visibleBooks]);
  const moduleBooks = useMemo(() => visibleBooks.filter(b => !b.deleted && b.module === module), [visibleBooks, module]);
  const activeFairs = useMemo(() => visibleFairs.filter(fair => !fair.deleted), [visibleFairs]);
  const filteredFairs = useMemo(() => {
    const term = fairSearch.trim().toLocaleLowerCase();
    const place = fairPlaceFilter.trim().toLocaleLowerCase();
    const minimum = fairMinBudget === "" ? null : Number(fairMinBudget);
    const maximum = fairMaxBudget === "" ? null : Number(fairMaxBudget);
    const matches = activeFairs.filter(fair => {
      if (term && ![fair.name, fair.place, fair.notes].some(value => value.toLocaleLowerCase().includes(term))) return false;
      if (place && !fair.place.toLocaleLowerCase().includes(place)) return false;
      if (fairVisitFrom && (!fair.visitDate || fair.visitDate < fairVisitFrom)) return false;
      if (fairVisitTo && (!fair.visitDate || fair.visitDate > fairVisitTo)) return false;
      if (minimum !== null && (fair.budget === "" || Number(fair.budget) < minimum)) return false;
      if (maximum !== null && (fair.budget === "" || Number(fair.budget) > maximum)) return false;
      return true;
    });
    return matches.sort((a, b) => fairSort === "name"
      ? a.name.localeCompare(b.name, language)
      : fairSort === "visit-desc" ? b.visitDate.localeCompare(a.visitDate) : a.visitDate.localeCompare(b.visitDate));
  }, [activeFairs, fairSearch, fairPlaceFilter, fairVisitFrom, fairVisitTo, fairMinBudget, fairMaxBudget, fairSort, language]);
  const dueCount = useMemo(() => visibleBooks.filter(b => !b.deleted && b.module === "borrowed" && b.dueAt && b.dueAt <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)).length, [books]);

  useEffect(() => {
    const readOfflineUser = () => { try { const raw = localStorage.getItem("maktabati:lastUser"); if (raw) setOfflineAccount(JSON.parse(raw)); } catch { /* invalid local cache */ } };
    readOfflineUser();
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => {
    if (auth.data && !guestPreview) {
      const user = auth.data as Account; setOfflineAccount(user);
      try { localStorage.setItem("maktabati:lastUser", JSON.stringify(user)); } catch { /* storage may be disabled */ }
    }
  }, [auth.data, guestPreview]);
  useEffect(() => {
    if (guestPreview || !offlineAccount || actualUser || !online) return;
    setSyncState("error");
    setSyncNote("الخادم المجاني يستيقظ وقد يستغرق دقيقة؛ مكتبتك محفوظة محلياً وجارٍ إعادة الاتصال.");
    const timer = window.setInterval(() => { void auth.refetch(); }, 5000);
    return () => window.clearInterval(timer);
  }, [offlineAccount?.id, actualUser?.id, online, auth.refetch]);
  useEffect(() => {
    if (actualUser) setSyncNote(note => note.startsWith("الخادم المجاني يستيقظ") ? "" : note);
  }, [actualUser?.id]);
  useEffect(() => {
    if (!currentUser || currentUser.id === loadedAccount.current) return;
    loadedAccount.current = currentUser.id; setPreferencesAccount(null); setListsAccount(null); selectLocalAccount(currentUser.id);
    let cancelled = false;
    void Promise.all([localStore.listBooks(), localStore.listFairs(), localStore.listIjazahs(), localStore.getPreferences()]).then(([savedBooks, savedFairs, savedIjazahs, prefs]) => {
      if (cancelled) return;
      setBooks(savedBooks); setFairs(savedFairs); setIjazahs(savedIjazahs); setPreferences(prefs); setPreferencesAccount(currentUser.id);
      try { const raw = localStorage.getItem(`maktabati:lists:${currentUser.id}`); setLists({ ...defaultLists, ...(raw ? JSON.parse(raw) : {}) }); } catch { setLists(defaultLists); }
      setListsAccount(currentUser.id);
      setSyncState(navigator.onLine ? "pending" : "offline");
    }).catch(() => { if (!cancelled) setSyncState("error"); });
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  const syncNow = useCallback(async () => {
    if (guestPreview || !currentUser || !actualUser || preferencesAccount !== currentUser.id || !navigator.onLine) { if (!navigator.onLine) setSyncState("offline"); return; }
    if (syncLock.current) { syncRequested.current = true; return; }
    syncLock.current = true;
    const mutationAtStart = localMutationVersion.current;
    const generation = syncGeneration.current; const obsolete = () => guestPreview || generation !== syncGeneration.current; setSyncState("pending"); setSyncNote("");
    try {
      const localBooks = await localStore.listBooks();
      if (obsolete()) return;
      const remoteBooks = await utils.library.list.fetch();
      if (obsolete()) return;
      const localFairs = await localStore.listFairs();
      if (obsolete()) return;
      const remoteFairs = await utils.fairs.list.fetch();
      if (obsolete()) return;
      const localIjazahs = await localStore.listIjazahs();
      if (obsolete()) return;
      const remoteIjazahs = await utils.ijazahs.list.fetch();
      if (obsolete()) return;
      const remotePreferences = await utils.preferences.get.fetch();
      if (obsolete()) return;
      const localPreferencesAt = await localStore.getPreferencesAt();
      if (obsolete()) return;
      if (remotePreferences && (!localPreferencesAt || Date.parse(remotePreferences.updatedAt) > Date.parse(localPreferencesAt))) {
        const restored = JSON.parse(remotePreferences.payload) as Preferences & { lists?: typeof defaultLists };
        const { lists: cloudLists, ...preferenceValues } = restored;
        if (cloudLists) setLists({ ...defaultLists, ...cloudLists });
        const values = preferenceValues as Preferences;
        setPreferences(values); await localStore.putPreferences(values); await localStore.putPreferencesAt(remotePreferences.updatedAt);
        if (obsolete()) return;
      } else {
        const stamp = localPreferencesAt || new Date().toISOString();
        await syncPreferencesMutation.mutateAsync({ payload: JSON.stringify({ ...preferences, lists }), updatedAt: stamp });
        if (obsolete()) return;
        if (!localPreferencesAt) await localStore.putPreferencesAt(stamp);
        if (obsolete()) return;
      }
      const lastSync = await localStore.getSyncAt();
      const remoteBookMap = new Map(remoteBooks.map(row => [row.id, row]));
      const localBookMap = new Map(localBooks.map(row => [row.id, row]));
      const merged: Book[] = [];
      for (const local of localBooks) {
        const remote = remoteBookMap.get(local.id);
        if (!remote) { merged.push(local); continue; }
        const remoteBook = restoreRemoteBook(JSON.parse(remote.data) as Book);
        const localTime = Date.parse(local.updatedAt), remoteTime = Date.parse(remote.updatedAt);
        if (lastSync && localTime > Date.parse(lastSync) && remoteTime > Date.parse(lastSync) && JSON.stringify(local) !== JSON.stringify(remoteBook)) {
          merged.push(local);
          const duplicate = { ...remoteBook, id: crypto.randomUUID(), title: `${remoteBook.title} — نسخة تعارض محفوظة`, notes: `${remoteBook.notes}\n\n[نسخة محفوظة بسبب تعديل متزامن من جهاز آخر]`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          merged.push(duplicate); setSyncNote("حُفظت نسخة إضافية لتعارض متزامن كي لا تضيع أي تعديلات.");
        } else merged.push(localTime >= remoteTime ? local : remoteBook);
        remoteBookMap.delete(local.id);
      }
      for (const row of remoteBookMap.values()) merged.push(restoreRemoteBook(JSON.parse(row.data) as Book));
      const preparedBooks: SyncBookInput[] = [];
      for (const book of merged) {
        const prepared = { ...book, images: book.images.map(image => ({ ...image })) };
        for (const image of prepared.images) {
          if (image.src.startsWith("data:image/")) {
            const localData = image.src;
            const cloudSrc = image.cloudSrc || (await uploadImage.mutateAsync({ bookId: prepared.id, imageId: image.id, dataUrl: localData })).src;
            if (obsolete()) return;
            image.backupData = localData; image.cloudSrc = cloudSrc; image.src = cloudSrc;
          } else if (image.cloudSrc) {
            image.src = image.cloudSrc;
          }
        }
        preparedBooks.push({ id: prepared.id, module: prepared.module, payload: JSON.stringify(prepared), deleted: Boolean(prepared.deleted), updatedAt: prepared.updatedAt });
        const original = merged.find(b => b.id === prepared.id);
        if (original) original.images = original.images.map(image => {
          const uploaded = prepared.images.find(item => item.id === image.id);
          return uploaded?.cloudSrc ? { ...image, cloudSrc: uploaded.cloudSrc, backupData: image.backupData || (image.src.startsWith("data:image/") ? image.src : undefined) } : image;
        });
      }
      await syncBooksMutation.mutateAsync({ books: preparedBooks });
      if (obsolete()) return;
      const remoteFairMap = new Map(remoteFairs.map(row => [row.id, row]));
      const mergedFairs = localFairs.map(local => { const remote = remoteFairMap.get(local.id); remoteFairMap.delete(local.id); if (!remote) return local; const fair = JSON.parse(remote.data) as Fair; return Date.parse(local.updatedAt) >= Date.parse(remote.updatedAt) ? local : fair; });
      for (const row of remoteFairMap.values()) mergedFairs.push(JSON.parse(row.data) as Fair);
      await syncFairsMutation.mutateAsync({ fairs: mergedFairs.map(f => ({ id: f.id, payload: JSON.stringify(f), deleted: Boolean(f.deleted), updatedAt: f.updatedAt })) });
      if (obsolete()) return;
      const remoteIjazahMap = new Map(remoteIjazahs.map(row => [row.id, row]));
      const mergedIjazahs: IjazahRecord[] = [];
      for (const local of localIjazahs) {
        const remote = remoteIjazahMap.get(local.id);
        if (!remote) { mergedIjazahs.push(local); continue; }
        const remoteRecord = JSON.parse(remote.data) as IjazahRecord;
        const localTime = Date.parse(local.updatedAt), remoteTime = Date.parse(remoteRecord.updatedAt);
        if (lastSync && localTime > Date.parse(lastSync) && remoteTime > Date.parse(lastSync) && JSON.stringify(local) !== JSON.stringify(remoteRecord)) {
          mergedIjazahs.push(local);
          const now = new Date().toISOString();
          const conflictSuffix = preferences.language === "en" ? "conflict copy" : "نسخة تعارض محفوظة";
          const fallbackTitle = preferences.language === "en" ? "Scientific ijazah" : "إجازة علمية";
          const conflictNote = preferences.language === "en" ? "[Preserved because another device edited this record concurrently]" : "[نسخة محفوظة بسبب تعديل متزامن من جهاز آخر]";
          mergedIjazahs.push({ ...remoteRecord, id: crypto.randomUUID(), title: `${remoteRecord.title || fallbackTitle} — ${conflictSuffix}`, notes: `${remoteRecord.notes}\n\n${conflictNote}`, deleted: false, createdAt: now, updatedAt: now });
          setSyncNote("حُفظت نسخة إضافية لتعارض متزامن كي لا تضيع أي تعديلات.");
        } else mergedIjazahs.push(localTime >= remoteTime ? local : remoteRecord);
        remoteIjazahMap.delete(local.id);
      }
      for (const row of remoteIjazahMap.values()) mergedIjazahs.push(JSON.parse(row.data) as IjazahRecord);
      const activeBookIds = new Set(merged.filter(book => !book.deleted).map(book => book.id));
      const reconciledIjazahs = mergedIjazahs.map(record => record.bookId === null || activeBookIds.has(record.bookId) || record.deleted ? record : { ...record, deleted: true, updatedAt: new Date().toISOString() });
      const preparedIjazahs: SyncIjazahInput[] = reconciledIjazahs.map(record => ({ id: record.id, bookId: record.bookId, payload: JSON.stringify(record), deleted: Boolean(record.deleted), updatedAt: record.updatedAt }));
      await syncIjazahsMutation.mutateAsync({ ijazahs: preparedIjazahs });
      if (obsolete()) return;
      if (localMutationVersion.current !== mutationAtStart) { syncRequested.current = true; return; }
      await localStore.importSnapshot(merged, mergedFairs, reconciledIjazahs);
      if (obsolete()) return;
      if (localMutationVersion.current !== mutationAtStart) { syncRequested.current = true; return; }
      const stamp = new Date().toISOString(); await localStore.putSyncAt(stamp);
      if (obsolete()) return;
      setBooks(merged); setFairs(mergedFairs); setIjazahs(reconciledIjazahs); setSyncState("synced");
    } catch (error) {
      if (obsolete()) return;
      console.error("[Maktabati sync]", error);
      setSyncState(navigator.onLine ? "error" : "offline");
      setSyncNote("تعذرت المزامنة الآن؛ بياناتك محفوظة محلياً وستتم المحاولة مجدداً.");
    } finally {
      syncLock.current = false;
      if (syncRequested.current) {
        syncRequested.current = false;
        window.setTimeout(() => setSyncRetry(value => value + 1), 50);
      }
    }
  }, [currentUser?.id, actualUser?.id, preferencesAccount, preferences, lists, utils, uploadImage, syncBooksMutation, syncFairsMutation, syncIjazahsMutation, syncPreferencesMutation, guestPreview]);

  useEffect(() => {
    if (currentUser && actualUser && loadedAccount.current === currentUser.id && online) void syncNow();
  }, [currentUser?.id, actualUser?.id, online, preferencesAccount, syncNow]);
  useEffect(() => {
    if (syncState !== "pending" || !currentUser || !actualUser) return;
    const timer = window.setTimeout(() => void syncNow(), 1200);
    return () => window.clearTimeout(timer);
  }, [books, fairs, ijazahs, syncState, syncRetry, currentUser?.id, actualUser?.id, syncNow]);
  useEffect(() => {
    document.documentElement.dataset.theme = currentUser ? preferences.theme : guestTheme;
    document.documentElement.dir = currentUser && preferences.language === "en" || !currentUser && guestLanguage === "en" ? "ltr" : "rtl";
    document.documentElement.lang = currentUser ? preferences.language : guestLanguage;
    document.documentElement.style.setProperty("--app-font", `"${currentUser ? preferences.font : "Cairo"}", sans-serif`);
  }, [preferences.theme, preferences.language, preferences.font, guestTheme, guestLanguage, currentUser?.id]);
  useEffect(() => { if (currentUser && preferencesAccount === currentUser.id) { void localStore.putPreferences(preferences); } }, [preferences, preferencesAccount, currentUser?.id]);
  useEffect(() => { if (currentUser && listsAccount === currentUser.id) { try { localStorage.setItem(`maktabati:lists:${currentUser.id}`, JSON.stringify(lists)); } catch { /* no-op */ } } }, [lists, listsAccount, currentUser?.id]);
  useEffect(() => { if (currentUser && actualUser && listsAccount === currentUser.id) { void localStore.putPreferencesAt(new Date().toISOString()); setSyncState("pending"); } }, [lists, listsAccount, currentUser?.id, actualUser?.id]);

  const persistBook = async (book: Book) => {
    if (guestPreview) return;
    markLocalMutation();
    await localStore.putBook(book);
    setBooks(previous => [...previous.filter(item => item.id !== book.id), book]);
    setSyncState(navigator.onLine && actualUser ? "pending" : "offline");
    setEditingBook(null);
    setSaveNotice(actualUser && navigator.onLine ? "تم حفظ الكتاب محلياً وجارٍ مزامنته." : "تم حفظ الكتاب محلياً؛ ستتم مزامنته عند الاتصال.");
    window.setTimeout(() => setSaveNotice(""), 4500);
  };
  const persistFair = async (fair: Fair) => {
    if (guestPreview) return;
    markLocalMutation(); await localStore.putFair(fair);
    setEditingFair(null); setFairs(previous => [...previous.filter(item => item.id !== fair.id), fair]); setSyncState(navigator.onLine && actualUser ? "pending" : "offline");
  };
  const updatePreferences = (p: Preferences) => { if (guestPreview) return; markLocalMutation(); setPreferences(p); void localStore.putPreferencesAt(new Date().toISOString()); setSyncState(navigator.onLine && actualUser ? "pending" : "offline"); };
  const deleteBook = async (book: Book) => {
    if (guestPreview) return;
    markLocalMutation();
    const timestamp = new Date().toISOString();
    const deleted = { ...book, deleted: true, updatedAt: timestamp };
    const linked = ijazahs.filter(record => record.bookId === book.id && !record.deleted).map(record => ({ ...record, deleted: true, updatedAt: timestamp }));
    setBooks(prev => prev.map(item => item.id === book.id ? deleted : item));
    if (linked.length) setIjazahs(prev => [...prev.filter(record => !linked.some(item => item.id === record.id)), ...linked]);
    setSyncState(navigator.onLine && actualUser ? "pending" : "offline");
    await Promise.all([localStore.putBook(deleted), ...linked.map(record => localStore.putIjazah(record))]);
  };
  const deleteFair = async (fair: Fair) => { if (guestPreview) return; markLocalMutation(); const deleted = { ...fair, deleted: true, updatedAt: new Date().toISOString() }; setFairs(prev => prev.map(item => item.id === fair.id ? deleted : item)); setSyncState(navigator.onLine && actualUser ? "pending" : "offline"); await localStore.putFair(deleted); };
  const persistIjazah = async (record: IjazahRecord) => { if (guestPreview) return; markLocalMutation(); await localStore.putIjazah(record); setIjazahs(previous => [...previous.filter(item => item.id !== record.id), record]); setSyncState(navigator.onLine && actualUser ? "pending" : "offline"); };
  const deleteIjazah = async (record: IjazahRecord) => persistIjazah({ ...record, deleted: true, updatedAt: new Date().toISOString() });
  const saveAll = (all: Book[]) => {
    if (guestPreview) return;
    markLocalMutation(); setBooks(all);
    const deletedIds = new Set(all.filter(book => book.deleted).map(book => book.id));
    const linked = ijazahs.filter(record => record.bookId !== null && deletedIds.has(record.bookId) && !record.deleted).map(record => ({ ...record, deleted: true, updatedAt: new Date().toISOString() }));
    if (linked.length) setIjazahs(previous => [...previous.filter(record => !linked.some(item => item.id === record.id)), ...linked]);
    setSyncState(navigator.onLine && actualUser ? "pending" : "offline");
    void Promise.all([...all.map(book => localStore.putBook(book)), ...linked.map(record => localStore.putIjazah(record))]);
  };

  const filteredBooks = useMemo(() => {
    const term = search.trim();
    const matchingIds = term ? new Set(rankBookMatches(moduleBooks, term).map(match => match.book.id)) : null;
    let result = moduleBooks.filter(b => {
      if (term && !matchingIds?.has(b.id)) return false;
      if (authorFilter && !scoreBookSearch(b, authorFilter)) return false;
      for (const key of ["publisher", "editor", "volumeSize", "source", "location", "room", "cabinet", "shelf"] as const) {
        const expected = filterDraft[key]?.trim().toLocaleLowerCase();
        if (expected && !String(b[key] ?? "").toLocaleLowerCase().includes(expected)) return false;
      }
      if (readOnly.read && b.readState !== "read") return false;
      if (readOnly.reading && b.readState !== "reading") return false;
      if (readOnly.lent && !b.borrower) return false;
      if (readOnly.due && !(b.dueAt && b.dueAt <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))) return false;
      return true;
    });
    result = sortBooks(result, sort, language);
    return result;
  }, [moduleBooks, search, authorFilter, readOnly, sort, filterDraft, language]);

  const exportJson = () => {
    if (guestPreview) return;
    if (module === "fair") {
      saveDownload(`maktabati-fairs-${today()}.json`, JSON.stringify({ version: 1, module: "fair", fairs: fairs.filter(fair => !fair.deleted) }, null, 2), "application/json");
      return;
    }
    const backup = moduleBooks.map(book => ({ ...book, images: book.images.map(({ cloudSrc: _cloudSrc, backupData, ...image }) => ({ ...image, src: backupData || image.src })) }));
    saveDownload(`maktabati-${module}-${today()}.json`, JSON.stringify({ version: 1, module, books: backup }, null, 2), "application/json");
  };
  const exportCsv = () => {
    if (guestPreview) return;
    if (module === "fair") {
      const headers = ["اسم المعرض", "تاريخ الزيارة", "الميزانية المرصودة", "تاريخ البداية", "تاريخ النهاية", "المكان", "ملاحظات"];
      const rows = fairsToRows(fairs);
      const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
      const csv = [headers.map(quote).join(","), ...rows.map(row => headers.map(header => quote(row[header] ?? "")).join(","))].join("\r\n");
      saveDownload(`maktabati-fairs-${today()}.csv`, "\uFEFF" + csv, "text/csv;charset=utf-8");
      return;
    }
    saveDownload(`maktabati-${module}-${today()}.csv`, "\uFEFF" + makeCsv(moduleBooks), "text/csv;charset=utf-8");
  };
  const exportExcel = async () => {
    if (guestPreview) return;
    const XLSX = await import("xlsx");
    const rows = module === "fair" ? fairsToRows(fairs) : moduleBooks.map(({ images: _images, ...book }) => book);
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, module === "fair" ? "Fairs" : "Books");
    XLSX.writeFile(workbook, `maktabati-${module}-${today()}.xlsx`);
  };
  const saveImportedFairs = (rows: Record<string, unknown>[]) => {
    if (guestPreview) return;
    const imported = fairsFromRows(rows);
    if (!imported.length) return;
    setFairs(previous => [...previous, ...imported]);
    setSyncState(navigator.onLine && actualUser ? "pending" : "offline");
    void Promise.all(imported.map(fair => localStore.putFair(fair)));
  };
  const importCsv = async (file: File) => {
    if (guestPreview) return;
    if (module === "fair") {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
      if (!sheet) throw new Error("لا يحتوي الملف ورقة بيانات.");
      saveImportedFairs(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }));
      return;
    }
    const parsed = parseCsv(await file.text(), module as BookModule);
    if (parsed.length) saveAll([...books.filter(book => book.module !== module), ...parsed]);
  };
  const importExcel = async (file: File) => {
    if (guestPreview) return;
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: module === "fair" });
    const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
    if (!sheet) throw new Error("لا يحتوي الملف ورقة بيانات.");
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (module === "fair") {
      saveImportedFairs(rows);
      return;
    }
    const parsed = rows.filter(row => String(row.title ?? "").trim()).map(row => {
      const item = emptyBook(module as BookModule);
      for (const [key, value] of Object.entries(row)) if (key in item && key !== "id" && key !== "images" && key !== "module") (item as any)[key] = value;
      return item;
    });
    if (parsed.length) saveAll([...books, ...parsed]);
  };
  const importJson = async (file: File) => {
    if (guestPreview) return;
    try {
      const raw = JSON.parse(await file.text());
      if (module === "fair") {
        const imported = fairsFromJson(raw);
        if (!imported) throw new Error();
        saveImportedFairs(imported);
        return;
      }
      const imported = Array.isArray(raw) ? raw : raw.books;
      if (!Array.isArray(imported)) throw new Error();
      const fixed = imported.filter(item => item && typeof item.title === "string").map(item => ({ ...emptyBook(module as BookModule), ...item, images: Array.isArray(item.images) ? item.images.map((image: Book["images"][number]) => ({ ...image, src: image.backupData || image.src, cloudSrc: undefined, backupData: undefined })) : [], id: crypto.randomUUID(), module: module as BookModule, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Book));
      saveAll([...books, ...fixed]);
    } catch {
      window.alert(module === "fair" ? "ملف JSON غير صالح أو لا يحتوي قائمة معارض مفهومة." : "ملف JSON غير صالح أو لا يحتوي قائمة كتب مفهومة.");
    }
  };
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault(); setAuthBusy(true); setAuthError(""); setAuthNotice("");
    if (authMode === "reset" && authForm.password !== passwordConfirm) { setAuthError("كلمتا المرور غير متطابقتين."); setAuthBusy(false); return; }
    const route = authMode === "signup" ? "register" : authMode === "forgot" ? "forgot" : authMode === "reset" ? "reset" : "login";
    try {
      const response = await fetch(`/api/auth/${route}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...authForm, email: authForm.email.trim().toLowerCase(), token: resetToken }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر إتمام الطلب.");
      if (authMode === "forgot") { setAuthNotice("إذا كان البريد مرتبطاً بحساب، فسيصلك رابط إعادة التعيين خلال دقائق."); return; }
      if (authMode === "reset") { setAuthNotice("تم تغيير كلمة المرور. يمكنك تسجيل الدخول الآن."); setAuthMode("login"); setResetToken(""); setPasswordConfirm(""); setAuthForm({ ...authForm, password: "" }); setOfflineAccount(null); localStorage.removeItem("maktabati:lastUser"); setBooks([]); setFairs([]); setIjazahs([]); loadedAccount.current = null; utils.auth.me.setData(undefined, null); window.history.replaceState({}, "", window.location.pathname); return; }
      setOfflineAccount(data.user); localStorage.setItem("maktabati:lastUser", JSON.stringify(data.user)); selectLocalAccount(data.user.id); loadedAccount.current = null;
      await auth.refetch(); await utils.invalidate();
    } catch (error) { setAuthError(error instanceof Error ? error.message : "تعذر الاتصال بالخادم."); }
    finally { setAuthBusy(false); }
  };
  const logout = async () => { syncGeneration.current += 1; await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => undefined); localStorage.removeItem("maktabati:lastUser"); utils.auth.me.setData(undefined, null); setOfflineAccount(null); setBooks([]); setFairs([]); setIjazahs([]); loadedAccount.current = null; await auth.refetch(); };
  const enterGuestPreview = () => { if (syncLock.current) { setAuthNotice("هناك مزامنة جارية؛ انتظر لحظات ثم جرّب الدخول كضيف مجدداً."); return; } syncGeneration.current += 1; loadedAccount.current = null; setBooks([]); setFairs([]); setIjazahs([]); setPreferences(defaultPreferences); setLists(defaultLists); setPreferencesAccount(null); setListsAccount(null); setScreen("dashboard"); setModule("library"); setSpeedOpen(false); setFiltersOpen(false); setEditingBook(null); setEditingFair(null); setSettingsOpen(false); setStatsOpen(false); setSyncNote(""); setGuestPreview(true); };
  const leaveGuestPreview = () => { setGuestPreview(false); setScreen("dashboard"); setModule("library"); setSpeedOpen(false); setFiltersOpen(false); };
  const confirmDeleteAll = async () => {
    if (guestPreview) return;
    if (module === "fair") {
      if (!window.confirm("هل تريد حذف جميع المعارض؟ لا يمكن التراجع عن هذا الإجراء.")) return;
      const timestamp = new Date().toISOString();
      const deleted = fairs.filter(fair => !fair.deleted).map(fair => ({ ...fair, deleted: true, updatedAt: timestamp }));
      setFairs(previous => previous.map(fair => fair.deleted ? fair : { ...fair, deleted: true, updatedAt: timestamp }));
      setSyncState(navigator.onLine && actualUser ? "pending" : "offline");
      await Promise.all(deleted.map(fair => localStore.putFair(fair)));
      setSpeedOpen(false);
      return;
    }
    if (!window.confirm(`هل تريد حذف جميع كتب وحدة «${translate(moduleInfo[module].title, language)}»؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    const deleted = moduleBooks.map(book => ({ ...book, deleted: true, updatedAt: new Date().toISOString() }));
    saveAll([...books.filter(book => book.module !== module), ...deleted]);
    setSpeedOpen(false);
  };
  const onImportChange = async (file: File | undefined, json: boolean) => {
    if (guestPreview || !file) return;
    try {
      if (json) await importJson(file);
      else if (/\.csv$/i.test(file.name)) await importCsv(file);
      else await importExcel(file);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "تعذر استيراد الملف.");
    }
    if (importRef.current) importRef.current.value = "";
    if (importJsonRef.current) importJsonRef.current.value = "";
    setSpeedOpen(false);
  };
  const openNewBook = () => { if (guestPreview) return; setSpeedOpen(false); setEditingBook(emptyBook(module as BookModule)); };
  const openNewFair = () => {
    if (guestPreview) return;
    setSpeedOpen(false);
    const now = new Date().toISOString();
    setEditingFair({ id: crypto.randomUUID(), name: "", visitDate: "", budget: "", startsAt: "", endsAt: "", place: "", notes: "", createdAt: now, updatedAt: now });
  };
  const speedItems = [
    { label: "PDF", icon: <Printer />, action: () => { setSpeedOpen(false); window.setTimeout(() => window.print(), 60); } },
    { label: "تصدير Excel / CSV", icon: <FileSpreadsheet />, action: async () => { await exportExcel(); setSpeedOpen(false); } },
    { label: "استيراد Excel / CSV", icon: <Upload />, action: () => { setSpeedOpen(false); importRef.current?.click(); } },
    { label: "تصدير JSON", icon: <Download />, action: () => { exportJson(); setSpeedOpen(false); } },
    { label: "استيراد JSON", icon: <FileJson />, action: () => { setSpeedOpen(false); importJsonRef.current?.click(); } },
    { label: module === "fair" ? "حذف جميع المعارض" : "حذف جميع الكتب", icon: <Trash2 />, action: () => void confirmDeleteAll(), danger: true },
    { label: module === "fair" ? "إضافة معرض" : "إضافة كتاب", icon: <Plus />, action: module === "fair" ? openNewFair : openNewBook, primary: true },
  ];
  const renderActionMenu = (fair = false) => <>
    {speedOpen && <div className={`speed-dial ${fair ? "fair-speed-dial" : ""}`} id="section-action-menu">
      {speedItems.map((item, index) => <button key={item.label} className={`speed-item ${item.danger ? "danger" : ""} ${item.primary ? "primary" : ""}`} style={{ "--i": index } as React.CSSProperties} onClick={() => { void item.action(); }}>
        <span>{item.icon}</span><b>{translate(item.label, language)}</b>
      </button>)}
    </div>}
    <button className={`speed-main ${fair ? "fair-speed-main" : ""}`} onClick={() => setSpeedOpen(open => !open)} aria-label={speedOpen ? translate("إغلاق الإجراءات", language) : translate("فتح الإجراءات", language)} aria-expanded={speedOpen} aria-controls="section-action-menu" title={translate("فتح الإجراءات", language)} style={{ background: speedOpen ? "#1e293b" : accent }}>
      {speedOpen ? <X /> : <Menu />}
    </button>
  </>;
  const clearFairFilters = () => {
    setFairSearch("");
    setFairPlaceFilter("");
    setFairVisitFrom("");
    setFairVisitTo("");
    setFairMinBudget("");
    setFairMaxBudget("");
    setFairSort("visit-asc");
  };
  const fairFilterPanel = <section className={`filter-panel ${filtersOpen ? "expanded" : ""} fair-filter-panel`}>
    <div className="filter-main">
      <label className="search-field"><Search size={17} /><input value={fairSearch} onChange={event => setFairSearch(event.target.value)} placeholder={translate("ابحث عن معرض...", language)} /><button type="button" className="clear-search" onClick={() => setFairSearch("")} hidden={!fairSearch}><X size={14} /></button></label>
      <button type="button" className="all-button" onClick={clearFairFilters}>{translate("الكل", language)}</button>
      <button type="button" className={`filter-toggle ${filtersOpen ? "active" : ""}`} onClick={() => setFiltersOpen(open => !open)} aria-expanded={filtersOpen} aria-controls="fair-filter-expanded" aria-label={translate("الفلاتر", language)}><Filter size={16} /><span>{translate("الفلاتر", language)}</span><b>{filtersOpen ? "−" : "+"}</b></button>
      <label className="sort-select"><ArrowDownAZ size={15} /><select value={fairSort} onChange={event => setFairSort(event.target.value)}><option value="name">{translate("ترتيب أبجدي ⇅", language)}</option><option value="visit-asc">{translate("الأقرب موعداً", language)}</option><option value="visit-desc">{translate("الأبعد موعداً", language)}</option></select><ChevronDown size={13} /></label>
    </div>
    {filtersOpen && <div className="filter-expanded" id="fair-filter-expanded"><div className="filter-grid fair-filter-grid">
      <label><span>{translate("المكان", language)}</span><input value={fairPlaceFilter} onChange={event => setFairPlaceFilter(event.target.value)} placeholder={translate("المكان...", language)} /></label>
      <label><span>{translate("تاريخ الزيارة من", language)}</span><input type="date" value={fairVisitFrom} onChange={event => setFairVisitFrom(event.target.value)} /></label>
      <label><span>{translate("تاريخ الزيارة إلى", language)}</span><input type="date" value={fairVisitTo} onChange={event => setFairVisitTo(event.target.value)} /></label>
      <label><span>{translate("الميزانية من", language)}</span><input type="number" min="0" value={fairMinBudget} onChange={event => setFairMinBudget(event.target.value)} placeholder="0" /></label>
      <label><span>{translate("الميزانية إلى", language)}</span><input type="number" min="0" value={fairMaxBudget} onChange={event => setFairMaxBudget(event.target.value)} placeholder="0" /></label>
    </div></div>}
  </section>;
  const openPhotoMatch = (book: Book) => {
    setSearch(""); setModule(book.module); setExpandedBook(book.id); setScreen("module");
    requestAnimationFrame(() => document.getElementById(`book-${book.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
  const createFromPhotoCandidate = (candidate: ExternalBookCandidate) => {
    const targetModule: BookModule = module === "fair" ? "library" : module;
    const draft = emptyBook(targetModule);
    draft.title = candidate.title;
    draft.author = candidate.author;
    draft.publisher = candidate.publisher;
    draft.printYear = candidate.printYear;
    draft.pages = candidate.pages || "";
    if (candidate.description || candidate.isbn) draft.notes = [candidate.description, candidate.isbn ? `ISBN: ${candidate.isbn}` : ""].filter(Boolean).join("\n\n");
    setModule(targetModule); setScreen("module"); setSearch(""); setEditingBook(draft);
  };
  const showLogin = !guestPreview && (authMode === "forgot" || authMode === "reset" || auth.isLoading && !offlineAccount || !currentUser);

  if (showLogin) return <div className="auth-screen" dir={guestLanguage === "en" ? "ltr" : "rtl"}><div className="auth-card"><div className="auth-brand"><div className="auth-top-actions"><button onClick={() => setGuestTheme(v => v === "dark" ? "light" : "dark")} aria-label={translate("تغيير المظهر", language)}>{guestTheme === "dark" ? <Sun /> : <Moon />}</button><button onClick={() => setGuestLanguage(v => v === "ar" ? "en" : "ar")}><span>{translate("العربية", language)}</span><span className="globe">◎</span></button></div><div className="brand-mark"><BookOpen size={33} /><BookOpen size={33} /><BookOpen size={33} /></div><h1>{translate("مكتبتي", language)}</h1><p>{translate("أدر فهرسة مكتبتك الشخصية بكل سهولة", language)}</p></div><form className="auth-form" onSubmit={handleAuth}><div className="auth-heading"><span className="eyebrow">{translate("مساحة كتبك، أينما كنت", language)}</span><h2>{authMode === "signup" ? translate("إنشاء حساب", language) : authMode === "forgot" ? translate("استعادة كلمة المرور", language) : authMode === "reset" ? translate("تعيين كلمة مرور جديدة", language) : translate("تسجيل الدخول", language)}</h2><p>{authMode === "signup" ? translate("أنشئ حسابك وابدأ فهرسة مكتبتك.", language) : authMode === "forgot" ? translate("أدخل بريدك لطلب رابط إعادة التعيين.", language) : authMode === "reset" ? translate("اختر كلمة مرور جديدة لا تقل عن 10 أحرف.", language) : translate("سجّل دخولك للعودة إلى رفوفك.", language)}</p></div>{authMode === "signup" && <label className="field"><span>{translate("الاسم", language)}</span><input autoComplete="name" value={authForm.name} onChange={e => setAuthForm({ ...authForm, name: e.target.value })} placeholder={translate("اسمك", language)} required /></label>}{authMode !== "reset" && <label className="field"><span>{translate("البريد الإلكتروني", language)}</span><input type="email" autoComplete="email" value={authForm.email} onChange={e => setAuthForm({ ...authForm, email: e.target.value })} placeholder="name@example.com" required /></label>}{authMode !== "forgot" && <label className="field"><span>{translate("كلمة المرور", language)}</span><div className="password-wrap"><input type={showPassword ? "text" : "password"} autoComplete={authMode === "login" ? "current-password" : "new-password"} value={authForm.password} onChange={e => setAuthForm({ ...authForm, password: e.target.value })} placeholder="••••••••••" required minLength={authMode === "signup" || authMode === "reset" ? 10 : 1} /><button type="button" onClick={() => setShowPassword(v => !v)} aria-label={translate("إظهار كلمة المرور", language)}>{showPassword ? translate("إخفاء", language) : translate("إظهار", language)}</button></div></label>}{authMode === "reset" && <label className="field"><span>{translate("تأكيد كلمة المرور", language)}</span><input type="password" autoComplete="new-password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} required minLength={10} /></label>}{authMode === "login" && <div className="auth-options"><label><input type="checkbox" checked={authForm.remember} onChange={e => setAuthForm({ ...authForm, remember: e.target.checked })} />{translate("تذكرني", language)}</label><button type="button" onClick={() => { setAuthMode("forgot"); setAuthError(""); setAuthNotice(""); }}>{translate("نسيت كلمة المرور؟", language)}</button></div>}{authError && <div className="inline-alert">{translate(authError, language)}</div>}{authNotice && <div className="auth-notice">{translate(authNotice, language)}</div>}<button className="primary-button auth-submit" disabled={authBusy}>{authBusy ? translate("جارٍ المعالجة...", language) : authMode === "signup" ? translate("إنشاء الحساب", language) : authMode === "forgot" ? translate("طلب رابط الاستعادة", language) : authMode === "reset" ? translate("حفظ كلمة المرور الجديدة", language) : translate("دخول", language)}</button><div className="auth-switch">{authMode === "signup" ? <>{translate("لديك حساب؟", language)}<button type="button" onClick={() => { setAuthMode("login"); setAuthError(""); setAuthNotice(""); }}>{translate("تسجيل الدخول", language)}</button></> : authMode === "forgot" || authMode === "reset" ? <button type="button" onClick={() => { setAuthMode("login"); setAuthError(""); setAuthNotice(""); }}>{translate("العودة إلى تسجيل الدخول", language)}</button> : <>{translate("ليس لديك حساب؟", language)}<button type="button" onClick={() => { setAuthMode("signup"); setAuthError(""); setAuthNotice(""); }}>{translate("إنشاء حساب", language)}</button></>}</div>{authMode === "login" && <div className="guest-entry"><span>{translate("استكشف واجهات التطبيق دون عرض كتب أو بيانات مستخدمين.", language)}</span><button type="button" className="outline-button" onClick={enterGuestPreview}>{translate("الدخول كضيف", language)}</button></div>}</form></div></div>;

  if (!guestPreview && auth.isLoading && !offlineAccount && !actualUser) return <div className="app-loading"><span className="spinner" />{translate("جارٍ فتح مكتبتك…", language)}</div>;
  const bookCount = visibleBooks.filter(b => !b.deleted && b.module !== "wishlist").length;
  const volumeCount = visibleBooks.filter(b => !b.deleted && b.module !== "wishlist").reduce((sum, b) => sum + Math.max(1, Number(b.volumes) || 1), 0);
  const activeModuleBooks = module === "fair" ? [] : filteredBooks;
  const activeIjazahs = visibleIjazahs.filter(record => !record.deleted && (record.bookId === null || visibleBooks.some(book => book.id === record.bookId && !book.deleted)));

  return <div className="app-shell" style={{ "--accent": accent } as React.CSSProperties}>
    <header className="topbar"><button className="wordmark" onClick={() => { setSpeedOpen(false); setFiltersOpen(false); setModule("library"); setScreen("dashboard"); }}><span className="logo-stack"><BookOpen /><BookOpen /><BookOpen /></span><span><b>{translate("مكتبتي", language)}</b><small>Maktabati</small></span></button><div className="topbar-center">{guestPreview ? <><span className="guest-mode-pill">{translate("معاينة كضيف", language)}</span><span className="welcome-user">{translate("تصفّح الميزات دون بيانات", language)}</span></> : <><span className="sync-status"><i className={syncState === "synced" ? "online-dot" : syncState === "error" ? "error-dot" : "pending-dot"} />{syncState === "synced" ? translate("متزامن", language) : syncState === "offline" ? translate("غير متصل", language) : syncState === "error" ? translate("تعذرت المزامنة", language) : translate("جارٍ الحفظ", language)}</span><span className="sync-separator" /> <span className="welcome-user">{translate("مرحباً،", language)}{currentUser?.name || currentUser?.email?.split("@")[0] || translate("ضيف", language)}</span></>}</div><div className="topbar-actions">{!guestPreview && <BookPhotoSearch books={visibleBooks} language={language} onOpenBook={openPhotoMatch} onUseCandidate={createFromPhotoCandidate} />}<PwaInstallButton language={language} /><DueReminderCenter books={visibleBooks} userId={currentUser?.id ?? 0} language={language} previewOnly={guestPreview} onOpenBook={book => { setModule(book.module); setScreen("module"); setEditingBook(book); }} />{guestPreview ? <><button className="icon-button" onClick={() => setGuestTheme(value => value === "dark" ? "light" : "dark")} title={translate("تغيير المظهر", language)} aria-label={translate("تغيير المظهر", language)}>{guestTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button><button className="outline-button" onClick={() => setGuestLanguage(value => value === "ar" ? "en" : "ar")} title={translate("تبديل اللغة", language)}>{guestLanguage === "ar" ? "EN" : "ع"}</button></> : <button className="icon-button" onClick={() => setSettingsOpen(true)} title={translate("الإعدادات", language)}><Settings size={18} /></button>}{guestPreview ? <button className="outline-button guest-exit" onClick={leaveGuestPreview}><LogOut size={15} />{translate("إنهاء المعاينة", language)}</button> : <button className="icon-button logout-button" onClick={logout} title={translate("تسجيل الخروج", language)}><LogOut size={18} /></button>}</div></header>
    {guestPreview && <aside className="guest-preview-banner" role="status">{translate("أنت في معاينة الضيف: واجهات الميزات فقط، بلا كتب أو بيانات حسابات.", language)}</aside>}
    {syncNote && <div className="sync-note"><span>{translate(syncNote, language)}</span><button onClick={() => setSyncNote("")}><X size={15} /></button></div>}
    {saveNotice && <div className="save-toast" role="status">{translate(saveNotice, language)}</div>}
    {screen === "ijazahs" ? <main className="module-page ijazah-standalone"><IjazahManager books={visibleBooks.filter(book => !book.deleted)} ijazahs={visibleIjazahs} language={language} canAdd={!guestPreview} previewOnly={guestPreview} onSave={persistIjazah} onDelete={deleteIjazah} onBack={() => setScreen("dashboard")} onOpenBook={book => { setModule(book.module); setScreen("module"); setEditingBook(book); }} /></main> : screen === "module" && module === "fair" ? <main className="module-page" style={{ "--accent": moduleInfo.fair.accent } as React.CSSProperties}><div className="module-heading"><button className="back-button" onClick={() => { setSpeedOpen(false); setFiltersOpen(false); setModule("library"); setScreen("dashboard"); }}><ArrowLeft size={17} />{translate("الرئيسية", language)}</button><div className="module-title"><span className="module-glyph" style={{ color: moduleInfo.fair.accent, background: `${moduleInfo.fair.accent}18` }}><Ticket /></span><div><h1>{translate("زيارة معرض", language)}</h1><p>{fmt(activeFairs.length)}{translate("معرض", language)}<span className="sync-status"><i className={syncState === "synced" ? "online-dot" : "pending-dot"} />{translate("متزامن", language)}</span></p></div></div>{!guestPreview && <button className="icon-button" onClick={() => setSettingsOpen(true)}><Settings size={18} /></button>}</div>{fairFilterPanel}{activeFairs.length === 0 ? <div className="fair-empty"><div className="fair-art"><Ticket size={42} /></div><h2>{translate("لا توجد معارض مسجلة", language)}</h2><p>{translate("أضف معرضاً وخطط جولتك القادمة بين الكتب.", language)}</p>{!guestPreview && <button className="primary-button" onClick={openNewFair}><Plus size={17} />{translate("أضف أول معرض", language)}</button>}{guestPreview && <p>{translate("هذه معاينة فارغة؛ سجّل الدخول لإضافة بياناتك الخاصة.", language)}</p>}</div> : filteredFairs.length === 0 ? <div className="fair-empty filter-results-empty"><div className="fair-art"><Search size={42} /></div><h2>{translate("لا توجد نتائج مطابقة", language)}</h2><p>{translate("جرّب تغيير عبارة البحث أو تخفيف الفلاتر.", language)}</p><button className="outline-button" onClick={clearFairFilters}>{translate("الكل", language)}</button></div> : <div className="fair-grid">{filteredFairs.map(fair => <article className="fair-card" key={fair.id}><span className="fair-card-icon"><Ticket /></span><div className="fair-card-content"><h3>{fair.name}</h3><p>{fair.place || translate("المكان غير محدد", language)}</p><div className="fair-meta">{fair.visitDate && <span>{translate("زيارة", language)}{dateLabel(fair.visitDate, preferences.calendar, language)}</span>}{fair.startsAt && <span>{dateLabel(fair.startsAt, preferences.calendar, language)} – {dateLabel(fair.endsAt, preferences.calendar, language)}</span>}</div>{fair.notes && <small>{fair.notes}</small>}</div>{!guestPreview && <div className="fair-card-actions"><button className="icon-button" onClick={() => setEditingFair(fair)}><Settings size={15} /></button><button className="icon-button danger-icon" onClick={() => void deleteFair(fair)}><Trash2 size={15} /></button></div>}</article>)}</div>}{!guestPreview && <input ref={importRef} hidden type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={e => void onImportChange(e.target.files?.[0], false)} />}{!guestPreview && <input ref={importJsonRef} hidden type="file" accept="application/json,.json" onChange={e => void onImportChange(e.target.files?.[0], true)} />}{!guestPreview && renderActionMenu(true)}</main> : screen === "dashboard" ? <main className="dashboard"><section className="dashboard-intro"><div><span className="eyebrow">{translate(guestPreview ? "معاينة الميزات" : "فهرسك الشخصي", language)}</span><h1>{translate(guestPreview ? "تصفّح أقسام مكتبتي." : "كل كتاب له مكانه.", language)}</h1><p>{translate(guestPreview ? "هذه معاينة للواجهات فقط، بلا كتب أو بيانات مستخدمين." : "مكتبتك في ترتيب جميل، أينما أخذتك القراءة.", language)}</p></div><div className="library-summary"><span className="summary-icon"><BookOpen size={20} /></span><div><b>{fmt(bookCount)}</b><small>{translate("كتاب مفهرس", language)}</small></div><span className="summary-line" /><div><b>{fmt(volumeCount)}</b><small>{translate("مجلد في رفوفك", language)}</small></div></div></section><section className="module-section"><div className="section-heading"><div><span className="eyebrow">{translate("مساحاتك", language)}</span><h2>{translate("اختر وجهتك", language)}</h2></div><span className="sync-status"><i className={syncState === "synced" ? "online-dot" : "pending-dot"} />{syncState === "synced" ? translate("متزامن", language) : syncState === "offline" ? translate("يعمل دون اتصال", language) : translate("يحفظ التغييرات", language)}</span></div><div className="module-grid">{MODULES.map(id => { const Icon = moduleIcons[id]; const count = id === "fair" ? activeFairs.length : visibleBooks.filter(b => !b.deleted && b.module === id).length; const descriptions: Record<ModuleId, string> = { library: "إدارة مكتبتك الشخصية وفهرسة الكتب", surplus: "تنظيم وتتبع الكتب الزائدة والمكررة", borrowed: "تتبع الكتب المستعارة وتواريخ إرجاعها", wishlist: "قائمة وميزانية الكتب المراد اقتناؤها", fair: "تخطيط الزيارات وجولات معارض الكتب" }; return <button className={`module-card ${id === "library" ? "featured" : ""}`} key={id} onClick={() => { setSpeedOpen(false); setFiltersOpen(false); setModule(id); setScreen("module"); }} style={{ "--accent": moduleInfo[id].accent } as React.CSSProperties}><span className="module-glyph"><Icon size={21} /></span><span className="module-card-copy"><b>{translate(moduleInfo[id].title, language)}</b><small>{translate(descriptions[id], language)}</small><span className="module-count">{fmt(count)} {id === "fair" ? translate("معرض", language) : translate("كتاب", language)}</span></span><span className="module-arrow">↗</span></button>; })}<button className="module-card ijazah-dashboard-card" onClick={() => setScreen("ijazahs")} style={{ "--accent": "#0f9b83" } as React.CSSProperties}><span className="module-glyph"><FileImage size={21} /></span><span className="module-card-copy"><b>{translate("الإجازات العلمية", language)}</b><small>{translate("سنداتك وصور وثائقها الخاصة", language)}</small><span className="module-count">{fmt(activeIjazahs.length)} {translate("إجازة", language)}</span></span><span className="module-arrow">↗</span></button></div></section><section className="dashboard-footer"><div><span className="eyebrow">{translate("تذكير لطيف", language)}</span><b>{dueCount ? `لديك ${dueCount} كتاب حان أو اقترب موعد إرجاعه` : translate(guestPreview ? "كل قسم يعرض واجهته فارغة للمعاينة." : "وقت هادئ لاكتشاف كتاب جديد", language)}</b><small>{translate(guestPreview ? "لا تُعرض هنا مكتبات المستخدمين أو بياناتهم." : "يمكنك متابعة مواعيد الإعارة من وحدة الكتب المستعارة.", language)}</small></div><span className="footer-book"><BookMarked /></span></section></main> : <main className="module-page"><div className="module-heading"><button className="back-button" onClick={() => { setSpeedOpen(false); setFiltersOpen(false); setModule("library"); setScreen("dashboard"); }}><ArrowLeft size={17} />{translate("الرئيسية", language)}</button><div className="module-title"><span className="module-glyph" style={{ color: accent, background: `${accent}18` }}>{(() => { const Icon = moduleIcons[module]; return <Icon />; })()}</span><div><h1>{translate(moduleInfo[module].title, language)}</h1><p>{fmt(moduleBooks.length)}{translate("كتاب", language)}<span className="dot-separator">•</span> {fmt(moduleBooks.reduce((sum, b) => sum + Math.max(1, Number(b.volumes) || 1), 0))}{translate("مجلد", language)}<span className="sync-status"><i className={syncState === "synced" ? "online-dot" : syncState === "offline" ? "pending-dot" : "pending-dot"} />{syncState === "synced" ? translate("متزامن", language) : syncState === "offline" ? translate("دون اتصال", language) : translate("يحفظ", language)}</span></p></div></div><div className="module-head-actions">{!guestPreview && module === "library" && <button className="icon-button" onClick={() => setStatsOpen(true)} title={translate("الإحصائيات", language)}><BarChart3 size={18} /></button>}{!guestPreview && <button className="icon-button" onClick={() => setSettingsOpen(true)} title={translate("الإعدادات", language)}><Settings size={18} /></button>}</div></div>
      <section className={`filter-panel ${filtersOpen ? "expanded" : ""}`}><div className="filter-main"><BookSearchBox value={search} books={moduleBooks} language={language} placeholder={translate("ابحث عن كتاب...", language)} onChange={setSearch} onSelect={book => requestAnimationFrame(() => document.getElementById(`book-${book.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }))} /><button className="all-button" onClick={() => { setSearch(""); setAuthorFilter(""); setReadOnly({ read: false, reading: false, lent: false, due: false }); setFilterDraft({}); setSort("alpha"); }}>{translate("الكل", language)}</button><button type="button" className={`filter-toggle ${filtersOpen ? "active" : ""}`} onClick={() => setFiltersOpen(v => !v)} aria-expanded={filtersOpen} aria-controls="book-filter-expanded" aria-label={translate("الفلاتر", language)}><Filter size={16} /><span>{translate("الفلاتر", language)}</span><b>{filtersOpen ? "−" : "+"}</b></button><label className="sort-select"><ArrowDownAZ size={15} /><select value={sort} onChange={e => setSort(e.target.value)}>
<option value="alpha">{translate("ترتيب أبجدي ⇅", language)}</option>
<option value="newest">{translate("الأحدث إضافة", language)}</option>
<option value="oldest">{translate("الأقدم إضافة", language)}</option>
<option value="volumes-desc">{translate("الأكثر مجلدات", language)}</option>
<option value="volumes-asc">{translate("الأقل مجلدات", language)}</option>
<option value="cost-desc">{translate("الأعلى سعراً", language)}</option>
<option value="cost-asc">{translate("الأقل سعراً", language)}</option>
<option value="author-alpha">{translate("حسب المؤلف أبجدياً", language)}</option>
<option value="death-asc">{translate("الأقدم وفاةً للمؤلف", language)}</option>
{module === "wishlist" && <option value="priority">{translate("أولوية الشراء", language)}</option>}
<option value="reverse">{translate("الأبجدي العكسي", language)}</option>
</select><ChevronDown size={13} /></label></div>{filtersOpen && <div className="filter-expanded" id="book-filter-expanded"><label className="search-field wide-search"><Search size={16} /><input value={authorFilter} onChange={e => setAuthorFilter(e.target.value)} placeholder={translate("ابحث بالمؤلف...", language)} /></label><div className={`filter-grid ${module === "wishlist" ? "wishlist-filters" : ""} ${module === "borrowed" ? "borrowed-filters" : ""}`}><label><span>{translate("دار النشر", language)}</span><input value={filterValue("publisher", moduleBooks)} onChange={e => setFilter("publisher", e.target.value)} list="publishers-list" placeholder={translate("دار النشر...", language)} /></label><label><span>{translate("المحقق", language)}</span><input value={filterValue("editor", moduleBooks)} onChange={e => setFilter("editor", e.target.value)} list="editors-list" placeholder={translate("المحقق...", language)} /></label>{module !== "wishlist" && <label className={module === "borrowed" ? "field-wide" : ""}><span>{translate("حجم المجلد", language)}</span><input value={filterValue("volumeSize", moduleBooks)} onChange={e => setFilter("volumeSize", e.target.value)} placeholder={translate("حجم المجلد...", language)} /></label>}{module !== "wishlist" && module !== "borrowed" && <label><span>{translate("المصدر", language)}</span><input value={filterValue("source", moduleBooks)} onChange={e => setFilter("source", e.target.value)} placeholder={translate("المصدر...", language)} /></label>}{module !== "wishlist" && <><label><span>{translate("المكان", language)}</span><input value={filterValue("location", moduleBooks)} onChange={e => setFilter("location", e.target.value)} placeholder={translate("المكان...", language)} /></label><label><span>{translate("الغرفة", language)}</span><input value={filterValue("room", moduleBooks)} onChange={e => setFilter("room", e.target.value)} placeholder={translate("الغرفة...", language)} /></label><label><span>{translate("الدولاب", language)}</span><input value={filterValue("cabinet", moduleBooks)} onChange={e => setFilter("cabinet", e.target.value)} placeholder={translate("الدولاب...", language)} /></label><label><span>{translate("الرف", language)}</span><input value={filterValue("shelf", moduleBooks)} onChange={e => setFilter("shelf", e.target.value)} placeholder={translate("الرف...", language)} /></label></>}</div><div className="check-filters">{module !== "wishlist" && <><label><input type="checkbox" checked={readOnly.read} onChange={e => setReadOnly({ ...readOnly, read: e.target.checked })} />{translate("عرض الكتب المقروءة فقط", language)}</label><label><input type="checkbox" checked={readOnly.reading} onChange={e => setReadOnly({ ...readOnly, reading: e.target.checked })} />{translate("عرض الكتب قيد القراءة فقط", language)}</label></>}{(module === "library" || module === "surplus") && <label><input type="checkbox" checked={readOnly.lent} onChange={e => setReadOnly({ ...readOnly, lent: e.target.checked })} />{translate("عرض الكتب المعارة فقط", language)}</label>}{module === "borrowed" && <label><input type="checkbox" checked={readOnly.due} onChange={e => setReadOnly({ ...readOnly, due: e.target.checked })} />{translate("كتب موعد إرجاعها قريب أو فائت", language)}</label>}</div></div>}</section>
      <datalist id="publishers-list">{Array.from(new Set(moduleBooks.map(b => b.publisher).filter(Boolean))).map(v => <option key={v} value={v} />)}</datalist><datalist id="editors-list">{Array.from(new Set(moduleBooks.map(b => b.editor).filter(Boolean))).map(v => <option key={v} value={v} />)}</datalist>
      {activeModuleBooks.length ? <div className="books-list">{activeModuleBooks.map(book => <article id={`book-${book.id}`} className={`book-card ${expandedBook === book.id ? "book-expanded" : ""}`} key={book.id} style={{ "--accent": moduleInfo[module].accent } as React.CSSProperties}>{cardFields.cover && <button className="book-cover" onClick={() => book.images.length && setExpandedBook(expandedBook === book.id ? null : book.id)} aria-label={translate("صورة الغلاف", language)}>{book.images.find(i => i.isCover) ? <img src={imageDisplaySrc(book.images.find(i => i.isCover)!)} alt={`غلاف ${book.title}`} /> : <span><BookOpen size={26} /><i /></span>}</button>}<div className="book-content"><div className="book-title-row"><button className="book-title" onClick={() => guestPreview ? setExpandedBook(expandedBook === book.id ? null : book.id) : setEditingBook(book)}>{book.title}</button><span className="book-state">{book.readState === "read" ? translate("مقروء", language) : book.readState === "reading" ? translate("قيد القراءة", language) : module === "wishlist" ? ({ high: "أولوية عالية", medium: "أولوية متوسطة", low: "أولوية منخفضة" }[book.priority]) : translate("غير مقروء", language)}</span></div><div className="book-subtitle">{cardFields.author && (book.author || translate("مؤلف غير محدد", language))}{cardFields.subject && book.subject && <><i>·</i>{book.subject}</>}{cardFields.publisher && book.publisher && <><i>·</i>{book.publisher}</>}{cardFields.editor && book.editor && <><i>·</i>{book.editor}</>}</div><div className="book-data">{book.volumes > 1 && <span>{fmt(book.volumes)}{translate("مجلد", language)}</span>}{book.volumeSize && <span>{book.volumeSize}</span>}{book.location && <span>{book.location}{book.shelf ? `، رف ${book.shelf}` : ""}</span>}{book.borrower && <span className="borrow-chip">{translate("مستعار إلى", language)}{book.borrower}</span>}{book.dueAt && <span className={book.dueAt <= today() ? "due-soon" : ""}>{translate("الإرجاع", language)}{dateLabel(book.dueAt, preferences.calendar, language)}</span>}</div>{expandedBook === book.id && <div className="book-details"><span>{translate("الطبعة:", language)}{book.edition || "—"} · {book.printYear || "—"}</span><span>{translate("المحقق:", language)}{book.editor || "—"}</span><span>{translate("المصدر:", language)}{book.source}{translate("· التكلفة:", language)}{book.cost || "—"} {preferences.currency}</span>{book.notes && <p>{book.notes}</p>}</div>}</div>{!guestPreview && <div className="book-actions"><button onClick={() => setExpandedBook(expandedBook === book.id ? null : book.id)} title={translate("تفاصيل", language)}>{translate("تفاصيل", language)}</button><button onClick={() => setEditingBook(book)} title={translate("تعديل", language)}>{translate("تعديل", language)}</button><button className="danger-icon" onClick={() => void deleteBook(book)} title={translate("حذف", language)}><Trash2 size={16} /></button></div>}</article>)}</div> : <div className="empty-books"><div className="empty-book-icon"><BookOpen size={29} /></div><h2>{search || authorFilter ? translate("لا توجد نتائج مطابقة", language) : `رف ${translate(moduleInfo[module].title, language)} ينتظر كتابك الأول`}</h2><p>{search || authorFilter ? translate("جرّب تغيير عبارة البحث أو تخفيف الفلاتر.", language) : translate(guestPreview ? "معاينة فارغة: لا تظهر كتب أو بيانات لأي مستخدم." : "أضف بيانات كتابك، وسيبقى فهرسك قريباً منك حتى دون اتصال.", language)}</p>{!guestPreview && !search && <button className="primary-button" onClick={openNewBook}><Plus size={17} />{translate("أضف كتاباً", language)}</button>}</div>}
      {!guestPreview && <input ref={importRef} hidden type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={e => void onImportChange(e.target.files?.[0], false)} />}{!guestPreview && <input ref={importJsonRef} hidden type="file" accept="application/json,.json" onChange={e => void onImportChange(e.target.files?.[0], true)} />}
      {!guestPreview && renderActionMenu(false)}
    </main>}
    {!guestPreview && editingBook && <BookEditor ijazahs={ijazahs} canManageIjazahs={books.some(book => book.id === editingBook.id && !book.deleted)} onSaveIjazah={persistIjazah} onDeleteIjazah={deleteIjazah} books={books.filter(book => !book.deleted)} language={preferences.language} book={editingBook} module={module as BookModule} onSave={persistBook} onClose={() => setEditingBook(null)} />}
    {!guestPreview && editingFair && <FairEditor language={preferences.language} fair={editingFair} onSave={fair => void persistFair(fair)} onClose={() => setEditingFair(null)} />}
    {!guestPreview && settingsOpen && <SettingsModal preferences={preferences} onPreferences={updatePreferences} books={books} lists={lists} onLists={setLists} onClose={() => setSettingsOpen(false)} />}
    {!guestPreview && statsOpen && <StatsModal language={preferences.language} books={activeBooks} currency={preferences.currency} onClose={() => setStatsOpen(false)} />}
  </div>;

  function filterValue(key: keyof Book, arr: Book[]) { return (filterDraft as any)[key] ?? ""; }
  function setFilter(key: keyof Book, value: string) { setFilterDraft(prev => ({ ...prev, [key]: value })); }
}
