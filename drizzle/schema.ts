import { boolean, index, int, longtext, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }).unique(),
  passwordHash: text("passwordHash"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const passwordResetTokens = mysqlTable("password_reset_tokens", {
  tokenHash: varchar("tokenHash", { length: 64 }).primaryKey(),
  userId: int("userId").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ userIdIndex: index("password_reset_tokens_userId_idx").on(table.userId) }));

export const libraryBooks = mysqlTable("library_books", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: int("ownerId").notNull(),
  module: mysqlEnum("module", ["library", "surplus", "borrowed", "wishlist"]).notNull(),
  payload: longtext("payload").notNull(),
  deleted: boolean("deleted").default(false).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const bookFairs = mysqlTable("book_fairs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: int("ownerId").notNull(),
  payload: longtext("payload").notNull(),
  deleted: boolean("deleted").default(false).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const ijazahRecords = mysqlTable("ijazah_records", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: int("ownerId").notNull(),
  bookId: varchar("bookId", { length: 36 }),
  payload: longtext("payload").notNull(),
  deleted: boolean("deleted").default(false).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  ownerBookIndex: index("ijazah_records_owner_book_idx").on(table.ownerId, table.bookId),
  ownerUpdatedIndex: index("ijazah_records_owner_updated_idx").on(table.ownerId, table.updatedAt),
}));

export const userPreferences = mysqlTable("user_preferences", {
  ownerId: int("ownerId").primaryKey(),
  payload: longtext("payload").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
