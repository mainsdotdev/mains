import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DatabaseClient, { closeDatabase, getSqlite, initializeDatabase } from "./client";
import { acquireDatabaseOwnership, databaseOwnershipPath } from "./database-ownership";
import { installTestBackendRuntime } from "../../test/backend-runtime";

let directory: string, restore: () => void;
const databasePath = () => path.join(directory, "mains.db");
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "mains-db-lifecycle-"));
  restore = installTestBackendRuntime({ getPath: () => directory });
});
afterEach(async () => {
  await DatabaseClient.reset(); restore(); fs.rmSync(directory, { recursive: true, force: true });
});

describe("database initialization and ownership lifecycle", () => {
  it.each(["lock", "sqlite"])("rolls back a failed %s acquisition and allows a clean retry", async (failure) => {
    const owner = failure === "lock" ? acquireDatabaseOwnership(databasePath(), "Mains Desktop") : undefined;
    if (failure === "sqlite") fs.mkdirSync(databasePath());
    try {
      await expect(initializeDatabase({ url: databasePath() })).rejects.toThrow();
      expect(DatabaseClient.getInstance().isReady()).toBe(false);
      expect(DatabaseClient.getInstance().getDbPath()).toBeNull();
      if (owner) expect(() => acquireDatabaseOwnership(databasePath(), "Third backend")).toThrow(/already in use/);
      else expect(fs.existsSync(databaseOwnershipPath(databasePath()))).toBe(false);
    } finally { owner?.release(); if (failure === "sqlite") fs.rmdirSync(databasePath()); }
    await initializeDatabase({ url: databasePath() });
    expect(DatabaseClient.getInstance().isReady()).toBe(true);
  });

  it("rejects a different database path while retaining the original connection", async () => {
    const first = await initializeDatabase({ url: databasePath() });
    const other = path.join(directory, "other.db");
    await expect(initializeDatabase({ url: other })).rejects.toThrow(/different/i);
    expect(getSqlite()).toBe(first.sqlite);
    expect(fs.existsSync(databaseOwnershipPath(other))).toBe(false);
  });

  it("shares close, waits for the pending opener and rejects a new opener until drained", async () => {
    const ready = deferred(), entered = deferred();
    const restoreReady = installTestBackendRuntime({ getPath: () => directory, whenReady: () => { entered.resolve(); return ready.promise; } });
    try {
      const opening = initializeDatabase({ url: databasePath() });
      await entered.promise;
      const closing = closeDatabase();
      let closed = false; void closing.then(() => { closed = true; });
      try {
        for (let i = 0; i < 5; i++) await Promise.resolve();
        expect(closed).toBe(false);
        expect(closeDatabase()).toBe(closing);
        await expect(initializeDatabase({ url: databasePath() })).rejects.toThrow(/clos/i);
      } finally { ready.resolve(); await Promise.allSettled([opening, closing]); }
      await initializeDatabase({ url: databasePath() });
      expect(DatabaseClient.getInstance().isReady()).toBe(true);
    } finally { ready.resolve(); restoreReady(); }
  });

  it("retains ownership when an active SQLite reader prevents closing, then releases on retry", async () => {
    await initializeDatabase({ url: databasePath() });
    const sqlite = getSqlite(), reader = sqlite.prepare("SELECT * FROM accounts").iterate();
    reader.next();
    try {
      await expect(closeDatabase()).rejects.toThrow();
      expect(sqlite.open).toBe(true);
      expect(() => acquireDatabaseOwnership(databasePath(), "Second backend")).toThrow(/already in use/);
    } finally { reader.return?.(); }
    await closeDatabase();
    expect(sqlite.open).toBe(false);
    const replacement = acquireDatabaseOwnership(databasePath(), "Second backend"); replacement.release();
  });

  it("does not reopen SQLite when host readiness arrives after close", async () => {
    const ready = deferred(), entered = deferred();
    const restoreReady = installTestBackendRuntime({ getPath: () => directory, whenReady: () => { entered.resolve(); return ready.promise; } });
    try {
      const opening = initializeDatabase({ url: databasePath() });
      await entered.promise;
      const closing = closeDatabase(); ready.resolve();
      const [result] = await Promise.allSettled([opening, closing]);
      expect(DatabaseClient.getInstance().isReady()).toBe(false);
      expect(fs.existsSync(databaseOwnershipPath(databasePath()))).toBe(false);
      expect(result.status).toBe("rejected");
    } finally { ready.resolve(); restoreReady(); }
  });
});
