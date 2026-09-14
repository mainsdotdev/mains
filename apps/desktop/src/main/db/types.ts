import type * as schema from "./schema";

import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

export type DatabaseInstance = BetterSQLite3Database<typeof schema>;

export type SQLiteInstance = Database.Database;

export interface DatabaseConfig {
  url: string;
  verbose?: boolean;
  enableWAL?: boolean;
  busyTimeout?: number;
}

export interface ExtensionLoadResult {
  success: boolean;
  extensionName: string;
  error?: Error;
  message?: string;
}

export interface DatabaseInitResult {
  db: DatabaseInstance;
  sqlite: SQLiteInstance;
  extensions: ExtensionLoadResult[];
}

export const DEFAULT_DATABASE_CONFIG: Partial<DatabaseConfig> = {
  verbose: false,
  enableWAL: true,
  busyTimeout: 5000,
} as const;

