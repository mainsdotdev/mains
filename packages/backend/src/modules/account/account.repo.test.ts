import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createAccount } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type Database from "better-sqlite3";

let db: DatabaseInstance;
let _sqlite: Database.Database;
let cleanup: () => void;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

// Import after mock so it picks up the mocked getDb
import { accountRepo } from "./account.repo";

describe("accountRepo", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
  });

  afterEach(() => {
    cleanup();
  });

  describe("findById", () => {
    it("returns null when account does not exist", async () => {
      const result = await accountRepo.findById("nonexistent");
      expect(result).toBeNull();
    });

    it("returns the account when it exists", async () => {
      createAccount(db, { id: "test-1", displayName: "Test User" });

      const result = await accountRepo.findById("test-1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("test-1");
      expect(result!.displayName).toBe("Test User");
    });
  });

  describe("create", () => {
    it("inserts a new account", async () => {
      await accountRepo.create({ id: "new-1", timezone: "UTC", locale: "en-US" });

      const result = await accountRepo.findById("new-1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("new-1");
      expect(result!.timezone).toBe("UTC");
    });

    it("does not throw on conflict (onConflictDoNothing)", async () => {
      await accountRepo.create({ id: "dup-1", timezone: "UTC", locale: "en-US" });
      // Should not throw
      await accountRepo.create({ id: "dup-1", timezone: "PST", locale: "en-US" });

      const result = await accountRepo.findById("dup-1");
      // Original value preserved
      expect(result!.timezone).toBe("UTC");
    });
  });

  describe("update", () => {
    it("updates fields and returns the updated record", async () => {
      createAccount(db, { id: "upd-1", displayName: "Old Name" });

      const result = await accountRepo.update("upd-1", { displayName: "New Name" });
      expect(result).not.toBeNull();
      expect(result!.displayName).toBe("New Name");
    });

    it("preserves unchanged fields", async () => {
      createAccount(db, { id: "upd-2", displayName: "Keep", email: "keep@example.com" });

      const result = await accountRepo.update("upd-2", { displayName: "Changed" });
      expect(result!.displayName).toBe("Changed");
      expect(result!.email).toBe("keep@example.com");
    });

    it("sets updatedAt on update", async () => {
      createAccount(db, { id: "upd-3" });

      const after = await accountRepo.update("upd-3", { displayName: "Updated" });
      expect(after!.updatedAt).toBeInstanceOf(Date);
    });
  });
});
