import { eq, sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { appSettings, accounts } from "../../db/schema";
import { ACCOUNT_ID } from "./appSettings.constants";
import type { AppSettingsPatch, AppSettingsRecord } from "./appSettings.dto";

// ─────────────────────────────────────────────────────────────
// Repository - Drizzle queries
// ─────────────────────────────────────────────────────────────
export const appSettingsRepo = {
  async findById(id: string): Promise<AppSettingsRecord | null> {
    const db = getDb();
    const result = await db.query.appSettings.findFirst({
      where: eq(appSettings.id, id),
    });
    return result ?? null;
  },

  async createDefaultAccount(): Promise<void> {
    const db = getDb();
    const existing = await db.query.accounts.findFirst({
      where: eq(accounts.id, ACCOUNT_ID),
    });

    if (!existing) {
      await db.insert(accounts).values({ id: ACCOUNT_ID }).onConflictDoNothing();
    }
  },

  async create(data: { id: string; accountId: string }): Promise<void> {
    const db = getDb();
    await db.insert(appSettings).values(data).onConflictDoNothing();
  },

  async update(
    id: string,
    patch: AppSettingsPatch,
  ): Promise<AppSettingsRecord | null> {
    const db = getDb();
    await db
      .update(appSettings)
      .set({ ...patch, updatedAt: sql`(unixepoch())` })
      .where(eq(appSettings.id, id));

    return this.findById(id);
  },
};
