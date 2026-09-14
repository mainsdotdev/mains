import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { app } from "electron";
import crypto from "node:crypto";
import path from "path";
import fs from "fs";
import * as schema from "./schema";
import type {
  DatabaseInstance,
  SQLiteInstance,
  DatabaseConfig,
  DatabaseInitResult,
  ExtensionLoadResult,
} from "./types";

/**
 * Database client singleton for the Electron app
 */
class DatabaseClient {
  private static instance: DatabaseClient | null = null;
  private db: DatabaseInstance | null = null;
  private sqlite: SQLiteInstance | null = null;
  private dbPath: string | null = null;
  private isInitialized = false;
  private initializePromise: Promise<DatabaseInitResult> | null = null;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient();
    }
    return DatabaseClient.instance;
  }

  /**
   * Initialize database with configuration
   */
  async initialize(
    config?: Partial<DatabaseConfig>,
  ): Promise<DatabaseInitResult> {
    if (this.isInitialized && this.db && this.sqlite) {
      console.log("Database already initialized");
      return {
        db: this.db,
        sqlite: this.sqlite,
        extensions: [],
      };
    }

    // Prevent concurrent initialization
    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = this.doInitialize(config);
    try {
      return await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  private async doInitialize(
    config?: Partial<DatabaseConfig>,
  ): Promise<DatabaseInitResult> {
    // Ensure Electron is ready before using app.getPath()
    if (
      app &&
      app.isReady &&
      typeof app.isReady === "function" &&
      !app.isReady()
    ) {
      await app.whenReady();
    }

    try {
      // Determine database path
      this.dbPath = config?.url || this.getDefaultDatabasePath();

      // Ensure directory exists
      this.ensureDirectoryExists(this.dbPath);

      // Create SQLite instance
      this.sqlite = new Database(this.dbPath, {});

      // Configure database
      this.configureDatabase(config);

      // Create Drizzle instance
      this.db = drizzle(this.sqlite, { schema });

      // Run migrations
      this.runMigrations();

      // Load extensions (if needed)
      const extensions = this.loadExtensions();

      // Seed initial data
      await this.seedInitialData();

      this.isInitialized = true;

      console.log("Database initialized successfully");

      return {
        db: this.db,
        sqlite: this.sqlite,
        extensions,
      };
    } catch (error) {
      console.error("Failed to initialize database:", error);
      await this.close().catch(() => {});
      throw error;
    }
  }

  /**
   * Configure database settings
   */
  private configureDatabase(config?: Partial<DatabaseConfig>): void {
    if (!this.sqlite) return;

    const enableWAL = config?.enableWAL ?? true;
    const busyTimeout = config?.busyTimeout ?? 5000;

    // Enable WAL mode for better concurrency
    if (enableWAL) {
      this.sqlite.pragma("journal_mode = WAL");
    }

    // Set busy timeout
    this.sqlite.pragma(`busy_timeout = ${busyTimeout}`);

    // Enable foreign keys
    this.sqlite.pragma("foreign_keys = ON");

    // Performance / memory tuning. Values chosen to balance throughput with
    // a small Electron main-process memory footprint.
    //   - cache_size: negative value = KiB (-32000 ≈ 32 MB per connection).
    //     Previous value was 64 MB; 32 MB is still enough for our workloads
    //     while cutting the committed page cache in half.
    //   - mmap_size: capped at 128 MB (was 256 MB). This is address-space,
    //     not committed RAM, but smaller mmap reduces resident pages on
    //     machines under memory pressure.
    //   - temp_store: MEMORY keeps temp tables off disk for speed.
    //   - synchronous: NORMAL is the safe default with WAL.
    this.sqlite.pragma("synchronous = NORMAL");
    this.sqlite.pragma("cache_size = -32000"); // 32MB cache
    this.sqlite.pragma("temp_store = MEMORY");
    this.sqlite.pragma("mmap_size = 134217728"); // 128MB
  }

  /**
   * Create a backup of the database before migrations
   */
  private backupDatabase(): string | null {
    if (!this.dbPath || !fs.existsSync(this.dbPath)) return null;

    const backupPath = `${this.dbPath}.pre-migration-backup`;
    try {
      fs.copyFileSync(this.dbPath, backupPath);
      // Also backup WAL/SHM if they exist
      const walPath = `${this.dbPath}-wal`;
      const shmPath = `${this.dbPath}-shm`;
      if (fs.existsSync(walPath)) fs.copyFileSync(walPath, `${backupPath}-wal`);
      if (fs.existsSync(shmPath)) fs.copyFileSync(shmPath, `${backupPath}-shm`);
      console.log(`Database backup created at ${backupPath}`);
      return backupPath;
    } catch (err) {
      console.error("Failed to create database backup:", err);
      return null;
    }
  }

  /**
   * Restore database from backup
   */
  private restoreFromBackup(backupPath: string): void {
    if (!this.dbPath) return;
    try {
      fs.copyFileSync(backupPath, this.dbPath);
      const walBackup = `${backupPath}-wal`;
      const shmBackup = `${backupPath}-shm`;
      if (fs.existsSync(walBackup)) fs.copyFileSync(walBackup, `${this.dbPath}-wal`);
      if (fs.existsSync(shmBackup)) fs.copyFileSync(shmBackup, `${this.dbPath}-shm`);
      console.log("Database restored from backup");
    } catch (err) {
      console.error("Failed to restore database from backup:", err);
    }
  }

  /**
   * Remove backup files after successful migration
   */
  private removeBackup(backupPath: string): void {
    try {
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      if (fs.existsSync(`${backupPath}-wal`)) fs.unlinkSync(`${backupPath}-wal`);
      if (fs.existsSync(`${backupPath}-shm`)) fs.unlinkSync(`${backupPath}-shm`);
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Run database migrations (sync)
   */
  private runMigrations(): void {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    const migrationsFolder = this.getMigrationsFolder();

    if (!migrationsFolder) {
      console.log("No migrations folder resolved, skipping migrations");
      return;
    }

    if (fs.existsSync(migrationsFolder)) {
      // Guard: if tables exist but migration tracker is empty/missing,
      // backfill the tracker so migrate() doesn't re-run old migrations.
      // This happens when db:push was used to create tables without tracking.
      this.backfillMigrationTracker(migrationsFolder);

      // The pre-migration backup copies the whole DB file (plus WAL/SHM) —
      // a per-boot disk cost that grows with the database and lands right as
      // the renderer is loading. Only pay it when migrate() will actually
      // apply something; on any doubt, hasPendingMigrations returns true.
      const backupPath = this.hasPendingMigrations(migrationsFolder)
        ? this.backupDatabase()
        : null;

      try {
        console.log("Running migrations...");
        migrate(this.db, { migrationsFolder });
        console.log("Migrations completed");

        // Remove backup after success
        if (backupPath) this.removeBackup(backupPath);
      } catch (err) {
        console.error("Migration failed:", err);
        if (backupPath) {
          this.restoreFromBackup(backupPath);
        }
        throw err;
      }
    } else {
      console.log("No migrations folder found, skipping migrations");
    }
  }

  /**
   * Whether migrate() would apply anything. Mirrors drizzle's own check
   * (sqlite-core dialect.migrate): an entry is pending iff its journal
   * `when` (folderMillis) is greater than max(created_at) in
   * `__drizzle_migrations`. Returns true when this can't be determined
   * (fresh DB, missing tracker table, unreadable journal) so the caller
   * keeps the pre-migration backup for exactly the risky cases.
   */
  private hasPendingMigrations(migrationsFolder: string): boolean {
    if (!this.sqlite) return true;

    try {
      const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
      if (!fs.existsSync(journalPath)) return false;

      const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
        entries?: Array<{ when: number }>;
      };
      const entries = journal.entries ?? [];
      if (entries.length === 0) return false;

      const newest = Math.max(...entries.map((entry) => entry.when));
      const row = this.sqlite
        .prepare(
          `SELECT max(created_at) as latest FROM "__drizzle_migrations"`,
        )
        .get() as { latest: number | null } | undefined;

      return row?.latest == null || Number(row.latest) < newest;
    } catch {
      return true;
    }
  }

  /**
   * Detect and fix tracker/schema mismatch.
   *
   * If application tables already exist (e.g. created by `db:push`)
   * but `__drizzle_migrations` is empty, backfill the tracker with
   * all migration entries so that `migrate()` skips them.
   */
  private backfillMigrationTracker(migrationsFolder: string): void {
    if (!this.sqlite) return;

    try {
      // Check if __drizzle_migrations table exists
      const trackerExists = this.sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`,
        )
        .get();

      // Check if any app table exists (accounts is always the first)
      const appTableExists = this.sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'`,
        )
        .get();

      // No app tables → fresh DB, migrate() will handle everything
      if (!appTableExists) return;

      // Create tracker table if needed
      if (!trackerExists) {
        this.sqlite.exec(`
          CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hash TEXT NOT NULL,
            created_at INTEGER
          );
        `);
      }

      // Check if tracker has any entries
      const count = this.sqlite
        .prepare(`SELECT COUNT(*) as cnt FROM "__drizzle_migrations"`)
        .get() as { cnt: number };

      if (count.cnt > 0) return; // Tracker is populated, nothing to do

      // Tables exist but tracker is empty — read journal and backfill
      const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
      if (!fs.existsSync(journalPath)) return;

      const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
      const entries: Array<{ tag: string; when: number }> = journal.entries || [];

      console.log(
        `Migration tracker empty but tables exist — backfilling ${entries.length} migration(s)`,
      );

      const insert = this.sqlite.prepare(
        `INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`,
      );

      const backfill = this.sqlite.transaction(() => {
        for (const entry of entries) {
          const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
          if (!fs.existsSync(sqlPath)) continue;

          // Check if the tables from this migration already exist
          // by trying to see if the first CREATE TABLE target exists
          const sql = fs.readFileSync(sqlPath, "utf-8");
          const tableMatch = sql.match(/CREATE TABLE\s+`?(\w+)`?/i);

          if (tableMatch) {
            const tableName = tableMatch[1];
            const exists = this.sqlite!
              .prepare(
                `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
              )
              .get(tableName);

            if (!exists) {
              // This migration's tables don't exist yet — stop backfilling,
              // let migrate() apply this and subsequent migrations normally
              break;
            }
          }

          const hash = crypto
            .createHash("sha256")
            .update(sql)
            .digest("hex");
          insert.run(hash, entry.when);
        }
      });

      backfill();
      console.log("Migration tracker backfill complete");
    } catch (err) {
      console.warn("Migration tracker backfill failed (non-fatal):", err);
      // Non-fatal — migrate() will try anyway
    }
  }

  /**
   * Run versioned seeds — applies only new seed versions.
   * Replaces the old "all tables empty?" check with version tracking.
   */
  private async seedInitialData(): Promise<void> {
    if (!this.db) {
      return;
    }

    try {
      const { runSeeds } = await import("./seeds");
      await runSeeds(this.db);
    } catch (error) {
      console.error("Failed to run seeds:", error);
      // Don't throw - seeding is optional
    }
  }

  /**
   * Resolve migrations folder for dev/prod
   */
  private getMigrationsFolder(): string | null {
    // Try multiple paths in order
    const possiblePaths = [
      // Dev: adjacent to this file (if compiled in place)
      path.join(__dirname, "migrations"),
      // Vite build: .vite/build/db/migrations
      path.join(__dirname, "db", "migrations"),
      // Prod: resources/migrations
      process.resourcesPath
        ? path.join(process.resourcesPath, "migrations")
        : null,
    ].filter(Boolean) as string[];

    for (const migrationPath of possiblePaths) {
      if (fs.existsSync(migrationPath)) {
        return migrationPath;
      }
    }

    console.warn("Migrations folder not found in any expected location");
    console.warn("Checked paths:", possiblePaths);
    return null;
  }

  /**
   * Load SQLite extensions
   */
  private loadExtensions(): ExtensionLoadResult[] {
    return [];
  }

  /**
   * Get default database path in Electron userData directory
   */
  private getDefaultDatabasePath(): string {
    if (app && !app.isPackaged) {
      return path.join(process.cwd(), ".data", "mains.db");
    }
    const userDataPath =
      app?.getPath("userData") || path.join(process.cwd(), ".data");
    return path.join(userDataPath, "mains.db");
  }

  /**
   * Ensure directory exists for database file
   */
  private ensureDirectoryExists(filePath: string): void {
    const directory = path.dirname(filePath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
  }

  /**
   * Get Drizzle database instance
   */
  getDb(): DatabaseInstance {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.db;
  }

  /**
   * Get raw SQLite instance
   */
  getSqlite(): SQLiteInstance {
    if (!this.sqlite) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.sqlite;
  }

  /**
   * Get database path
   */
  getDbPath(): string | null {
    return this.dbPath;
  }

  /**
   * Check if database is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.db !== null && this.sqlite !== null;
  }

  /**
   * Execute a transaction
   */
  transaction<T>(callback: (tx: DatabaseInstance) => T): T {
    const db = this.getDb();
    return db.transaction((tx) => callback(tx));
  }

  /**
   * Create a backup of the database
   */
  async backup(backupPath: string): Promise<void> {
    if (!this.sqlite || !this.dbPath) {
      throw new Error("Database not initialized");
    }

    try {
      this.ensureDirectoryExists(backupPath);

      // Use SQLite backup API for safe backup
      await this.sqlite.backup(backupPath);
    } catch (error) {
      console.error("Backup failed:", error);
      throw error;
    }
  }

  /**
   * Optimize database (vacuum, analyze)
   */
  async optimize(): Promise<void> {
    if (!this.sqlite) {
      throw new Error("Database not initialized");
    }

    try {
      console.log("Optimizing database...");

      // Run VACUUM to reclaim space
      this.sqlite.exec("VACUUM");

      // Run ANALYZE to update statistics
      this.sqlite.exec("ANALYZE");

      // Optimize FTS5 index (merge segments)
      try {
        this.sqlite.exec("INSERT INTO entities_fts(entities_fts) VALUES ('optimize')");
      } catch (e) {
        console.warn("FTS5 optimize skipped:", e);
      }

      console.log("Database optimization completed");
    } catch (error) {
      console.error("Optimization failed:", error);
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  getStats(): {
    pageCount: number;
    pageSize: number;
    freelistCount: number;
    size: number;
    walSize?: number;
  } {
    if (!this.sqlite || !this.dbPath) {
      throw new Error("Database not initialized");
    }

    const pageCount = this.sqlite.pragma("page_count", {
      simple: true,
    }) as number;
    const pageSize = this.sqlite.pragma("page_size", {
      simple: true,
    }) as number;
    const freelistCount = this.sqlite.pragma("freelist_count", {
      simple: true,
    }) as number;

    const stats = {
      pageCount,
      pageSize,
      freelistCount,
      size: pageCount * pageSize,
    };

    // Check for WAL file
    const walPath = `${this.dbPath}-wal`;
    if (fs.existsSync(walPath)) {
      const walStats = fs.statSync(walPath);
      return { ...stats, walSize: walStats.size };
    }

    return stats;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.sqlite) {
      try {
        // Checkpoint WAL before closing
        this.sqlite.pragma("wal_checkpoint(TRUNCATE)");
        this.sqlite.close();
        console.log("Database connection closed");
      } catch (error) {
        console.error("Error closing database:", error);
      }
    }

    this.cleanup();
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.db = null;
    this.sqlite = null;
    this.dbPath = null;
    this.isInitialized = false;
    this.initializePromise = null;
  }

  /**
   * Reset singleton (mainly for testing)
   */
  static async reset(): Promise<void> {
    if (DatabaseClient.instance) {
      await DatabaseClient.instance.close().catch(() => {});
      DatabaseClient.instance = null;
    }
  }
}

// Export singleton instance getter
export const getDb = (): DatabaseInstance => DatabaseClient.getInstance().getDb();
export const getSqlite = (): SQLiteInstance => DatabaseClient.getInstance().getSqlite();
export const initializeDatabase = (config?: Partial<DatabaseConfig>) =>
  DatabaseClient.getInstance().initialize(config);
export const closeDatabase = () => DatabaseClient.getInstance().close();

export default DatabaseClient;
