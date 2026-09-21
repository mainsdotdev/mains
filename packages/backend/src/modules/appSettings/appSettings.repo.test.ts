import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createAccount, createAppSettings, createSpace } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type Database from "better-sqlite3";

let db: DatabaseInstance;
let _sqlite: Database.Database;
let cleanup: () => void;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

import { appSettingsRepo } from "./appSettings.repo";

describe("appSettingsRepo", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
  });

  afterEach(() => {
    cleanup();
  });

  describe("findById", () => {
    it("returns null when not found", async () => {
      const result = await appSettingsRepo.findById("nonexistent");
      expect(result).toBeNull();
    });

    it("returns the row when found", async () => {
      createAppSettings(db, { id: "default" });
      const result = await appSettingsRepo.findById("default");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("default");
    });
  });

  describe("createDefaultAccount", () => {
    it("creates the default account if it does not exist", async () => {
      await expect(appSettingsRepo.createDefaultAccount()).resolves.not.toThrow();
    });

    it("does not fail if the default account already exists", async () => {
      createAccount(db, { id: "default" });
      await expect(appSettingsRepo.createDefaultAccount()).resolves.not.toThrow();
    });
  });

  describe("create", () => {
    it("inserts a new row", async () => {
      createAccount(db, { id: "default" });
      await appSettingsRepo.create({ id: "s1", accountId: "default" });

      const result = await appSettingsRepo.findById("s1");
      expect(result).not.toBeNull();
      expect(result!.accountId).toBe("default");
    });

    it("does nothing on conflict", async () => {
      createAppSettings(db, { id: "s1" });
      await expect(
        appSettingsRepo.create({ id: "s1", accountId: "default" }),
      ).resolves.not.toThrow();
    });
  });

  describe("update", () => {
    it("applies a single-field patch", async () => {
      createAppSettings(db, { id: "default" });
      const result = await appSettingsRepo.update("default", {
        enableWorktrees: false,
      });
      expect(result).not.toBeNull();
      expect(result!.enableWorktrees).toBe(false);
    });

    it("applies a multi-field patch", async () => {
      createAppSettings(db, { id: "default" });
      const result = await appSettingsRepo.update("default", {
        showToolCalls: false,
        notifyOnRunComplete: false,
        commitInstructions: "Conventional commits",
      });
      expect(result!.showToolCalls).toBe(false);
      expect(result!.notifyOnRunComplete).toBe(false);
      expect(result!.commitInstructions).toBe("Conventional commits");
    });

    it("sets activeSpaceId to a space id", async () => {
      createAppSettings(db, { id: "default" });
      const space = createSpace(db, { accountId: "default" });
      const result = await appSettingsRepo.update("default", {
        activeSpaceId: space.id,
      });
      expect(result!.activeSpaceId).toBe(space.id);
    });

    it("clears activeSpaceId when set to null", async () => {
      createAppSettings(db, { id: "default" });
      const result = await appSettingsRepo.update("default", {
        activeSpaceId: null,
      });
      expect(result!.activeSpaceId).toBeNull();
    });

    it("touches updatedAt", async () => {
      createAppSettings(db, { id: "default" });
      const before = (await appSettingsRepo.findById("default"))!;
      // unixepoch() has 1-second resolution; wait past that boundary.
      await new Promise((r) => setTimeout(r, 1100));
      const result = await appSettingsRepo.update("default", {
        enableWorktrees: false,
      });
      expect(result!.updatedAt.getTime()).toBeGreaterThan(
        before.updatedAt.getTime(),
      );
    });
  });
});
