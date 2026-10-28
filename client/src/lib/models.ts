export const MODULES = ["library", "surplus", "borrowed", "wishlist", "fair"] as const;
export type ModuleId = (typeof MODULES)[number];
export type BookModule = Exclude<ModuleId, "fair">;

export const moduleInfo: Record<ModuleId, { title: string; subtitle: string; accent: string; icon: string }> = {
  library: { title: "مكتبتي", subtitle: "مساحة كتبك التي تعود إليها دائماً", accent: "#10B981", icon: "library" },
  surplus: { title: "كتب زائدة", subtitle: "رتّب النسخ الزائدة وشاركها", accent: "#14B8A6", icon: "copy" },
  borrowed: { title: "الكتب المستعارة", subtitle: "لا تدع موعد إرجاع يفوتك", accent: "#EC4899", icon: "bookmark" },
  wishlist: { title: "قائمة الشراء", subtitle: "خطّط لاقتناء كتبك القادمة", accent: "#818CF8", icon: "shopping" },
  fair: { title: "زيارة معرض", subtitle: "خطّط لجولتك القادمة بين الكتب", accent: "#F59E0B", icon: "ticket" },
};

export type BookImage = { id: string; src: string; name: string; isCover: boolean; kind: "upload" | "url"; cloudSrc?: string; backupData?: string };
export type Book = {
  id: string;
  module: BookModule;
  title: string;
  author: string;
  deathYear: string;
  subject: string;
  language: string;
  publisher: string;
  editor: string;
  edition: string;
  printYear: string;
  volumes: number;
  pages: number | "";
  volumeSize: string;
  paperColor: string;
  binding: string;
  location: string;
  room: string;
  cabinet: string;
  shelf: string;
  number: string;
  source: string;
  cost: number | "";
  acquiredAt: string;
  borrower: string;
  lentAt: string;
  dueAt: string;
  loanNotes: string;
  readingStarted: string;
  readingFinished: string;
  benefits: string;
  notes: string;
  images: BookImage[];
  subBooks: string[];
  priority: "high" | "medium" | "low";
  readState: "unread" | "reading" | "read";
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
};
export type IjazahImage = { id: string; name: string; data: string };
export type IjazahRecord = {
  id: string;
  bookId: string | null;
  bookTitle: string;
  title: string;
  grantor: string;
  grantee: string;
  issuedAt: string;
  matn: string;
  notes: string;
  images: IjazahImage[];
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
};
export type Fair = {
  id: string;
  name: string;
  visitDate: string;
  budget: number | "";
  startsAt: string;
  endsAt: string;
  place: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
};
export type Preferences = {
  language: "ar" | "en";
  theme: "dark" | "light";
  calendar: "gregory" | "islamic";
  digits: "latn" | "arab";
  currency: string;
  font: string;
  cardFields: Record<BookModule, { cover: boolean; author: boolean; subject: boolean; publisher: boolean; editor: boolean }>;
};
export const emptyBook = (module: BookModule): Book => ({
  id: crypto.randomUUID(), module, title: "", author: "", deathYear: "", subject: "", language: "العربية", publisher: "", editor: "", edition: "", printYear: "", volumes: 1, pages: "", volumeSize: "", paperColor: "شامواه", binding: "", location: "", room: "", cabinet: "", shelf: "", number: "", source: "شراء", cost: "", acquiredAt: "", borrower: "", lentAt: "", dueAt: "", loanNotes: "", readingStarted: "", readingFinished: "", benefits: "", notes: "", images: [], subBooks: [], priority: "medium", readState: "unread", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});
export const defaultPreferences: Preferences = {
  language: "ar", theme: "dark", calendar: "gregory", digits: "latn", currency: "ر.س", font: "Cairo",
  cardFields: Object.fromEntries((MODULES.filter(m => m !== "fair") as BookModule[]).map(m => [m, { cover: true, author: true, subject: true, publisher: true, editor: false }])) as Preferences["cardFields"],
};
