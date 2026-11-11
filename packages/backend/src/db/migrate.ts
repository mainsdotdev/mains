import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { DatabaseInstance, SQLiteInstance } from "./types";

/** SQLite cannot disable FK actions inside Drizzle's migration transaction.
 * Suspend them before BEGIN so rebuilding a parent does not cascade-delete
 * its children. Migrations that rebuild tables assert integrity before COMMIT. */
export function migrateDatabase(db: DatabaseInstance, sqlite: SQLiteInstance, migrationsFolder: string) {
  const enabled = sqlite.pragma("foreign_keys", { simple: true });
  sqlite.pragma("foreign_keys = OFF");
  try {
    migrate(db, { migrationsFolder });
    if ((sqlite.pragma("foreign_key_check") as unknown[]).length) throw new Error("Migration left invalid database references");
  } finally {
    sqlite.pragma(`foreign_keys = ${enabled ? "ON" : "OFF"}`);
  }
}
