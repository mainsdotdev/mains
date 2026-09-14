import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createAccount, createSpace } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type Database from "better-sqlite3";

let db: DatabaseInstance;
let _sqlite: Database.Database;
let cleanup: () => void;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

import { appSettingsService } from "./appSettings.service";
import { appSettingsRepo } from "./appSettings.repo";

describe("appSettingsService", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
    createAccount(db, { id: "default" });
  });

  afterEach(() => {
    cleanup();
  });

  describe("ensureSettings", () => {
    it("creates the default row lazily on first access", async () => {
      const result = await appSettingsService.ensureSettings();
      expect(result.id).toBe("default");
      expect(result.accountId).toBe("default");
    });

    // Fresh installs start with worktrees off. Nothing writes the column —
    // neither the seed's insert nor the lazy create above — so the schema
    // default is the whole mechanism, and this is what would catch it
    // flipping back.
    it("creates the row with worktrees off", async () => {
      const result = await appSettingsService.ensureSettings();
      expect(result.enableWorktrees).toBe(false);
    });

    it("is idempotent", async () => {
      const first = await appSettingsService.ensureSettings();
      const second = await appSettingsService.ensureSettings();
      expect(first.id).toBe(second.id);
      expect(first.createdAt).toEqual(second.createdAt);
    });

    it("throws when the row cannot be read after insert", async () => {
      const original = appSettingsRepo.findById;
      appSettingsRepo.findById = async () => null;
      try {
        await expect(appSettingsService.ensureSettings()).rejects.toThrow(
          "Failed to create app settings",
        );
      } finally {
        appSettingsRepo.findById = original;
      }
    });
  });

  describe("getSettings", () => {
    it("returns the default row", async () => {
      const settings = await appSettingsService.getSettings();
      expect(settings.id).toBe("default");
    });

    it("propagates the error when ensureSettings throws", async () => {
      const original = appSettingsRepo.findById;
      appSettingsRepo.findById = async () => {
        throw new Error("db connection lost");
      };
      try {
        await expect(appSettingsService.getSettings()).rejects.toThrow(
          "db connection lost",
        );
      } finally {
        appSettingsRepo.findById = original;
      }
    });
  });

  describe("updateSettings", () => {
    it("applies a single-field patch and returns the latest row", async () => {
      const settings = await appSettingsService.updateSettings({
        enableWorktrees: false,
      });
      expect(settings.enableWorktrees).toBe(false);
    });

    it("applies a multi-field patch atomically", async () => {
      const settings = await appSettingsService.updateSettings({
        showToolCalls: false,
        notifyOnRunComplete: false,
        commitInstructions: "Use conventional commits",
      });
      expect(settings.showToolCalls).toBe(false);
      expect(settings.notifyOnRunComplete).toBe(false);
      expect(settings.commitInstructions).toBe("Use conventional commits");
    });

    it("accepts a valid spaceId for activeSpaceId", async () => {
      const space = createSpace(db, { accountId: "default" });
      const settings = await appSettingsService.updateSettings({
        activeSpaceId: space.id,
      });
      expect(settings.activeSpaceId).toBe(space.id);
    });

    it("accepts null for activeSpaceId", async () => {
      const settings = await appSettingsService.updateSettings({
        activeSpaceId: null,
      });
      expect(settings.activeSpaceId).toBeNull();
    });

    it("strips unknown keys silently", async () => {
      const settings = await appSettingsService.updateSettings({
        enableWorktrees: false,
        somethingMadeUp: "ignored",
      } as unknown);
      expect(settings.enableWorktrees).toBe(false);
      expect(
        (settings as unknown as Record<string, unknown>).somethingMadeUp,
      ).toBeUndefined();
    });

    it("strips immutable fields (id, accountId, createdAt, updatedAt)", async () => {
      const before = await appSettingsService.ensureSettings();
      const settings = await appSettingsService.updateSettings({
        id: "hacked",
        accountId: "hacked",
        createdAt: 0,
        updatedAt: 0,
        enableWorktrees: false,
      } as unknown);
      expect(settings.id).toBe("default");
      expect(settings.accountId).toBe("default");
      expect(settings.createdAt).toEqual(before.createdAt);
      expect(settings.enableWorktrees).toBe(false);
    });

    it("rejects non-object patches", async () => {
      for (const bad of [null, undefined, "string", 42, true]) {
        await expect(appSettingsService.updateSettings(bad)).rejects.toThrow(
          "patch must be an object",
        );
      }
    });

    it("throws when repo.update returns null", async () => {
      const original = appSettingsRepo.update;
      appSettingsRepo.update = async () => null;
      try {
        await expect(
          appSettingsService.updateSettings({ enableWorktrees: true }),
        ).rejects.toThrow("Failed to update settings");
      } finally {
        appSettingsRepo.update = original;
      }
    });

    it("propagates the error when repo.update throws", async () => {
      const original = appSettingsRepo.update;
      appSettingsRepo.update = async () => {
        throw new Error("update failed");
      };
      try {
        await expect(
          appSettingsService.updateSettings({ enableWorktrees: true }),
        ).rejects.toThrow("update failed");
      } finally {
        appSettingsRepo.update = original;
      }
    });
  });
});
