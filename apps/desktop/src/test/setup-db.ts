import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../main/db/schema";
import type { DatabaseInstance } from "../main/db/types";
import fs from "fs";
import path from "path";

const MIGRATIONS_DIR = path.resolve(__dirname, "../main/db/migrations");

/**
 * Read the Drizzle migration journal and return SQL files in order.
 */
function getMigrationFiles(): string[] {
  const journalPath = path.join(MIGRATIONS_DIR, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
  return journal.entries.map(
    (entry: { tag: string }) => path.join(MIGRATIONS_DIR, `${entry.tag}.sql`),
  );
}

/**
 * Parse a Drizzle migration SQL file, splitting on `--> statement-breakpoint`.
 */
function parseMigrationStatements(sqlFile: string): string[] {
  const content = fs.readFileSync(sqlFile, "utf-8");
  return content
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Create an in-memory SQLite database with the full schema applied via migrations.
 * Returns the Drizzle instance, raw sqlite handle, and a cleanup function.
 */
export function createTestDb(): {
  db: DatabaseInstance;
  sqlite: Database.Database;
  cleanup: () => void;
} {
  const sqlite = new Database(":memory:");

  // Enable foreign keys (matches production config)
  sqlite.pragma("foreign_keys = ON");

  // Apply all migrations in order
  const migrationFiles = getMigrationFiles();
  for (const file of migrationFiles) {
    const statements = parseMigrationStatements(file);
    for (const stmt of statements) {
      sqlite.exec(stmt);
    }
  }

  // Create Drizzle migrations tracking table so Drizzle doesn't complain
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at INTEGER
    );
  `);

  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    cleanup: () => {
      try {
        sqlite.close();
      } catch {
        // already closed
      }
    },
  };
}
