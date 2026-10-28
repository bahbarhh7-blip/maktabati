import { defaultPreferences, type Book, type Fair, type IjazahRecord, type Preferences } from "./models";

type StoreName = "books" | "fairs" | "ijazahs" | "meta";
const DB_NAME = "maktabati-offline-v1";
let activeDbName = DB_NAME;
let dbPromise: Promise<IDBDatabase> | undefined;
export function selectLocalAccount(accountId: number | string) {
  const next = `${DB_NAME}-${String(accountId).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (next !== activeDbName) { activeDbName = next; dbPromise = undefined; }
}
function openDb() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("IndexedDB غير متاح"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(activeDbName, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of ["books", "fairs", "ijazahs", "meta"] as StoreName[]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: store === "meta" ? "key" : "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}
async function all<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}
async function put<T>(store: StoreName, value: T) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function remove(store: StoreName, key: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export const localStore = {
  listBooks: () => all<Book>("books"),
  putBook: (book: Book) => put("books", book),
  deleteBook: (id: string) => remove("books", id),
  listFairs: () => all<Fair>("fairs"),
  putFair: (fair: Fair) => put("fairs", fair),
  deleteFair: (id: string) => remove("fairs", id),
  listIjazahs: () => all<IjazahRecord>("ijazahs"),
  putIjazah: (record: IjazahRecord) => put("ijazahs", record),
  deleteIjazah: (id: string) => remove("ijazahs", id),
  async getPreferences(): Promise<Preferences> {
    const data = await all<{ key: string; value: Preferences }>("meta");
    return data.find(x => x.key === "preferences")?.value ?? defaultPreferences;
  },
  putPreferences: (value: Preferences) => put("meta", { key: "preferences", value }),
  async getPreferencesAt() {
    const data = await all<{ key: string; value: string }>("meta");
    return data.find(x => x.key === "preferencesAt")?.value ?? "";
  },
  putPreferencesAt: (value: string) => put("meta", { key: "preferencesAt", value }),
  async getSyncAt() {
    const data = await all<{ key: string; value: string }>("meta");
    return data.find(x => x.key === "syncAt")?.value ?? "";
  },
  putSyncAt: (value: string) => put("meta", { key: "syncAt", value }),
  async importSnapshot(books: Book[], fairs: Fair[], ijazahs: IjazahRecord[] = []) {
    for (const book of books) await put("books", book);
    for (const fair of fairs) await put("fairs", fair);
    for (const ijazah of ijazahs) await put("ijazahs", ijazah);
  },
};
