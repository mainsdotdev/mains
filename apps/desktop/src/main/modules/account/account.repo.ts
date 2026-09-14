import { eq, sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { accounts } from "../../db/schema";
import type { AccountRecord, UpdateAccountRequest } from "./account.dto";

// ─────────────────────────────────────────────────────────────
// Repository - Drizzle queries
// ─────────────────────────────────────────────────────────────
export const accountRepo = {
  async findById(id: string): Promise<AccountRecord | null> {
    const db = getDb();
    const result = await db.query.accounts.findFirst({
      where: eq(accounts.id, id),
    });
    return result ?? null;
  },

  async create(data: { id: string; timezone: string; locale: string }): Promise<void> {
    const db = getDb();
    await db.insert(accounts).values(data).onConflictDoNothing();
  },

  async update(id: string, data: Partial<UpdateAccountRequest>): Promise<AccountRecord | null> {
    const db = getDb();
    await db
      .update(accounts)
      .set({
        ...data,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(accounts.id, id));

    return this.findById(id);
  },
};
