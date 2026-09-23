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

import { accountService } from "./account.service";
import { accountRepo } from "./account.repo";

// Throw-style service: tests assert plain values and rejections — the
// ServiceResponse envelope only exists at the IPC seam (handle()).

describe("accountService", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
  });

  afterEach(() => {
    cleanup();
  });

  describe("ensureAccount", () => {
    it("creates the default account when it does not exist", async () => {
      const account = await accountService.ensureAccount();
      expect(account).not.toBeNull();
      expect(account.id).toBe("default");
      expect(account.timezone).toBe("UTC");
    });

    it("returns existing account on subsequent calls", async () => {
      createAccount(db, { id: "default", displayName: "Existing" });

      const account = await accountService.ensureAccount();
      expect(account.displayName).toBe("Existing");
    });
  });

  describe("getAccount", () => {
    it("returns the formatted account", async () => {
      const account = await accountService.getAccount();
      expect(account.id).toBe("default");
      // formatAccountResponse defaults
      expect(account.timezone).toBe("UTC");
      expect(account.locale).toBe("en-US");
    });
  });

  describe("updateAccount", () => {
    it("updates with valid payload", async () => {
      const account = await accountService.updateAccount({
        displayName: "Updated Name",
      });
      expect(account.displayName).toBe("Updated Name");
    });

    it("throws for invalid payload", async () => {
      await expect(accountService.updateAccount(null)).rejects.toThrow();
    });

    it("throws for empty update", async () => {
      await expect(accountService.updateAccount({})).rejects.toThrow(
        "No fields to update",
      );
    });

    it("throws validation errors for invalid email", async () => {
      await expect(
        accountService.updateAccount({ email: "not-an-email" }),
      ).rejects.toThrow(/email: Invalid email/);
    });

    it("updates multiple fields", async () => {
      const account = await accountService.updateAccount({
        displayName: "New Name",
        email: "valid@test.com",
        bio: "Hello world",
      });
      expect(account.displayName).toBe("New Name");
      expect(account.email).toBe("valid@test.com");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Error paths
  // ─────────────────────────────────────────────────────────────
  describe("error handling", () => {
    it("getAccount propagates repo failures", async () => {
      vi.spyOn(accountRepo, "findById").mockRejectedValueOnce(new Error("db"));
      await expect(accountService.getAccount()).rejects.toThrow("db");
    });

    it("updateAccount propagates repo failures", async () => {
      vi.spyOn(accountRepo, "update").mockRejectedValueOnce(new Error("db"));
      await expect(
        accountService.updateAccount({ displayName: "X" }),
      ).rejects.toThrow("db");
    });
  });
});
