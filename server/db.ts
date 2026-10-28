import { and, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { bookFairs, InsertUser, ijazahRecords, libraryBooks, passwordResetTokens, userPreferences, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0];
}

export async function createEmailUser(input: { openId: string; email: string; name: string; passwordHash: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.insert(users).values({
    openId: input.openId, email: input.email, name: input.name, passwordHash: input.passwordHash,
    loginMethod: "email-password", lastSignedIn: new Date(),
  });
  return getUserByOpenId(input.openId);
}

export async function replacePasswordResetToken(userId: number, tokenHash: string, expiresAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.delete(passwordResetTokens).where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
  await db.insert(passwordResetTokens).values({ userId, tokenHash, expiresAt });
}

export async function deletePasswordResetToken(tokenHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash));
}

export async function consumePasswordResetToken(tokenHash: string, passwordHash: string, rotatedOpenId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db.transaction(async tx => {
    const now = new Date();
    const [result] = await tx.update(passwordResetTokens).set({ usedAt: now }).where(and(
      eq(passwordResetTokens.tokenHash, tokenHash),
      gt(passwordResetTokens.expiresAt, now),
      isNull(passwordResetTokens.usedAt),
    ));
    if (result.affectedRows !== 1) return false;
    const [token] = await tx.select({ userId: passwordResetTokens.userId }).from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash)).limit(1);
    if (!token) throw new Error("Password reset token disappeared");
    await tx.update(users).set({ passwordHash, openId: rotatedOpenId, updatedAt: now }).where(eq(users.id, token.userId));
    return true;
  });
}

export async function listBooks(ownerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db.select().from(libraryBooks).where(eq(libraryBooks.ownerId, ownerId));
}

export async function saveBook(ownerId: number, item: { id: string; module: "library" | "surplus" | "borrowed" | "wishlist"; payload: string; deleted?: boolean; updatedAt?: Date }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const [existing] = await db.select({ ownerId: libraryBooks.ownerId }).from(libraryBooks).where(eq(libraryBooks.id, item.id)).limit(1);
  if (existing && existing.ownerId !== ownerId) throw new Error("Record is not owned by this account");
  const values = { ...item, ownerId, deleted: item.deleted ?? false, updatedAt: item.updatedAt ?? new Date() };
  await db.insert(libraryBooks).values(values).onDuplicateKeyUpdate({
    set: { module: item.module, payload: item.payload, deleted: values.deleted, updatedAt: values.updatedAt },
  });
}

export async function listFairs(ownerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db.select().from(bookFairs).where(eq(bookFairs.ownerId, ownerId));
}

export async function saveFair(ownerId: number, item: { id: string; payload: string; deleted?: boolean; updatedAt?: Date }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const [existing] = await db.select({ ownerId: bookFairs.ownerId }).from(bookFairs).where(eq(bookFairs.id, item.id)).limit(1);
  if (existing && existing.ownerId !== ownerId) throw new Error("Record is not owned by this account");
  const values = { ...item, ownerId, deleted: item.deleted ?? false, updatedAt: item.updatedAt ?? new Date() };
  await db.insert(bookFairs).values(values).onDuplicateKeyUpdate({
    set: { payload: item.payload, deleted: values.deleted, updatedAt: values.updatedAt },
  });
}

export async function listIjazahs(ownerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db.select().from(ijazahRecords).where(eq(ijazahRecords.ownerId, ownerId));
}

export async function saveIjazah(ownerId: number, item: { id: string; bookId: string | null; payload: string; deleted?: boolean; updatedAt?: Date }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  if (item.bookId) {
    const [book] = await db.select({ ownerId: libraryBooks.ownerId, deleted: libraryBooks.deleted })
      .from(libraryBooks).where(eq(libraryBooks.id, item.bookId)).limit(1);
    if (!book || book.ownerId !== ownerId) throw new Error("Linked book is not owned by this account");
    if (book.deleted && !item.deleted) throw new Error("Cannot attach an active ijazah to a deleted book");
  }
  const [existing] = await db.select({ ownerId: ijazahRecords.ownerId }).from(ijazahRecords)
    .where(eq(ijazahRecords.id, item.id)).limit(1);
  if (existing && existing.ownerId !== ownerId) throw new Error("Ijazah is not owned by this account");
  const values = { ...item, ownerId, deleted: item.deleted ?? false, updatedAt: item.updatedAt ?? new Date() };
  if (existing) {
    await db.update(ijazahRecords).set({ bookId: item.bookId, payload: item.payload, deleted: values.deleted, updatedAt: values.updatedAt })
      .where(and(eq(ijazahRecords.id, item.id), eq(ijazahRecords.ownerId, ownerId)));
  } else {
    await db.insert(ijazahRecords).values(values);
  }
}

export async function getUserPreferences(ownerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const [row] = await db.select().from(userPreferences).where(eq(userPreferences.ownerId, ownerId)).limit(1);
  return row ? { payload: row.payload, updatedAt: row.updatedAt.toISOString() } : null;
}

export async function saveUserPreferences(ownerId: number, payload: string, updatedAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.insert(userPreferences).values({ ownerId, payload, updatedAt }).onDuplicateKeyUpdate({ set: { payload, updatedAt } });
}
