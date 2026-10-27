import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { accounts, appSettings } from "./schema";
import type { DatabaseInstance } from "./types";

/** One identity per database, shared by pairing and Bridge ownership. */
export function getLocalBackendId(db: DatabaseInstance = getDb()): string {
  const current = db.select().from(appSettings).where(eq(appSettings.id, "default")).get();
  if (current?.backendId) return current.backendId;
  return db.transaction((tx) => {
    const settings = tx.select().from(appSettings).where(eq(appSettings.id, "default")).get();
    if (settings?.backendId) return settings.backendId;
    const backendId = randomUUID();
    if (settings) {
      tx.update(appSettings).set({ backendId }).where(eq(appSettings.id, "default")).run();
    } else {
      tx.insert(accounts).values({ id: "default" }).onConflictDoNothing().run();
      tx.insert(appSettings).values({ id: "default", accountId: "default", backendId }).run();
    }
    return backendId;
  });
}
