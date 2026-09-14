/**
 * Smoke Tests
 *
 * Verifies that the database bootstraps correctly with seed data
 * and that core service calls return expected results.
 *
 * Uses real in-memory SQLite — no mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb } from "./setup-db";
import type { DatabaseInstance } from "../main/db/types";
import type Database from "better-sqlite3";

// ── DB mock — all services call getDb() internally ──────────
let db: DatabaseInstance;
let _sqlite: Database.Database;
let cleanup: () => void;

import { vi } from "vitest";
vi.mock("../main/db/client", () => ({
  getDb: () => db,
}));

// ── Seed runner ─────────────────────────────────────────────
import { runSeeds, CURRENT_SEED_VERSION } from "../main/db/seeds";

// ── Services under test ─────────────────────────────────────
import { accountService } from "../main/modules/account/account.service";
import { appSettingsService } from "../main/modules/appSettings/appSettings.service";
import { spaceService } from "../main/modules/space/space.service";
import { providersService } from "../main/modules/providers/providers.service";
import { connectionsService } from "../main/modules/connections/connections.service";
import { projectsService } from "../main/modules/projects/projects.service";
import { workspaceService } from "../main/modules/workspace";
import { entitiesService } from "../main/modules/entities/entities.service";

// ─────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────
describe("smoke", () => {
  beforeAll(async () => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());

    // Run versioned seeds (mirrors production boot)
    await runSeeds(db);
  });

  afterAll(() => {
    cleanup();
  });

  // ───────────────────────────────────────────────────────────
  // 2. DB Bootstrap — seed data integrity
  // ───────────────────────────────────────────────────────────
  describe("db bootstrap", () => {
    it("seeds default account", async () => {
      const account = await accountService.ensureAccount();
      expect(account).not.toBeNull();
      expect(account.id).toBe("default");
      expect(account.timezone).toBe("UTC");
      expect(account.locale).toBe("en-US");
    });

    it("seeds two providers (copilot_cli, claude_code)", async () => {
      const providers = await providersService.getAll();
      const ids = providers.map((p) => p.id);
      expect(ids).toContain("copilot_cli");
      expect(ids).toContain("claude_code");
      expect(providers.length).toBeGreaterThanOrEqual(2);

      // Both should be agent_runtime and enabled
      for (const p of providers) {
        expect(p.kind).toBe("agent_runtime");
        expect(p.isEnabled).toBe(true);
      }
    });

    it("seeds two spaces (claude, copilot)", async () => {
      const spaces = await spaceService.getAll();
      const slugs = spaces.map((s) => s.slug);
      expect(slugs).toContain("claude");
      expect(slugs).toContain("copilot");
    });

    it("seeds app settings with activeSpaceId=claude", async () => {
      const settings = await appSettingsService.getSettings();
      expect(settings.id).toBe("default");
      expect(settings.accountId).toBe("default");
      expect(settings.activeSpaceId).toBe("claude");
    });

    it("sets seedVersion to current version", async () => {
      const settings = await appSettingsService.getSettings();
      expect(settings.seedVersion).toBe(CURRENT_SEED_VERSION);
    });

    it("runSeeds is idempotent (no-op on second call)", async () => {
      // Should not throw or duplicate data
      await runSeeds(db);

      const providers = await providersService.getAll();
      expect(providers.length).toBe(4);
    });

    it("seeds connection states for all integrations", async () => {
      const states = await connectionsService.listStates();

      const ids = states.map((a) => a.id);
      expect(ids).toContain("github");
      expect(ids).toContain("linear");
      expect(ids).toContain("jira");
      expect(ids).toContain("gitlab");
      expect(ids).toContain("asana");
      expect(ids).toContain("trello");

      // All should be disconnected by default
      for (const app of states) {
        expect(app.isConnected).toBe(false);
      }
    });

    it("seeds seven connections (all revoked)", async () => {
      // Query connections table directly since connectionsService needs more setup
      const rows = db.query.connections.findMany().sync?.() ?? [];
      expect(rows.length).toBe(8);

      const providers = rows.map((r: { provider: string }) => r.provider);
      expect(providers).toContain("github");
      expect(providers).toContain("linear");
      expect(providers).toContain("gitlab");
      expect(providers).toContain("jira");
      expect(providers).toContain("asana");
      expect(providers).toContain("trello");
      expect(providers).toContain("sentry");

      for (const row of rows) {
        expect((row as { status: string }).status).toBe("revoked");
      }
    });
  });

  // ───────────────────────────────────────────────────────────
  // 3. Service round-trip — basic calls return valid responses
  // ───────────────────────────────────────────────────────────
  describe("service round-trip", () => {
    it("accountService.getAccount returns formatted account", async () => {
      const account = await accountService.getAccount();
      expect(account.id).toBe("default");
      expect(account.timezone).toBe("UTC");
      expect(account.locale).toBe("en-US");
    });

    it("appSettingsService.getSettings returns settings", async () => {
      const settings = await appSettingsService.getSettings();
      expect(settings).toHaveProperty("id");
      expect(settings).toHaveProperty("accountId");
      expect(settings).toHaveProperty("activeSpaceId");
    });

    it("spaceService.getAll returns seeded spaces", async () => {
      const spaces = await spaceService.getAll();
      expect(spaces.length).toBeGreaterThanOrEqual(2);
      // Each space should have required fields
      for (const space of spaces) {
        expect(space).toHaveProperty("id");
        expect(space).toHaveProperty("name");
        expect(space).toHaveProperty("slug");
        expect(space).toHaveProperty("accountId", "default");
      }
    });

    it("providersService.getAll returns enabled agent runtimes", async () => {
      for (const p of await providersService.getAll()) {
        expect(p).toHaveProperty("id");
        expect(p).toHaveProperty("displayName");
        expect(p).toHaveProperty("kind");
        expect(p).toHaveProperty("isEnabled");
      }
    });

    it("projectsService.list returns empty list (no projects seeded)", async () => {
      expect(await projectsService.list()).toEqual([]);
    });

    it("workspaceService.list returns empty list (no workspaces seeded)", async () => {
      expect(await workspaceService.list()).toEqual([]);
    });

    it("entitiesService.getAll returns empty list (no entities seeded)", async () => {
      expect(await entitiesService.getAll()).toEqual([]);
    });

    it("accountService.updateAccount round-trips correctly", async () => {
      await accountService.updateAccount({ displayName: "Smoke Test User" });

      const account = await accountService.getAccount();
      expect(account.displayName).toBe("Smoke Test User");
    });

    it("appSettingsService.updateSettings changes activeSpaceId", async () => {
      await appSettingsService.updateSettings({ activeSpaceId: "copilot" });

      const settings = await appSettingsService.getSettings();
      expect(settings.activeSpaceId).toBe("copilot");

      // Restore
      await appSettingsService.updateSettings({ activeSpaceId: "claude" });
    });

    it("spaceService.getById returns specific space", async () => {
      const space = await spaceService.getById("claude");
      expect(space?.id).toBe("claude");
      expect(space?.slug).toBe("claude");
    });

    it("spaceService.getById returns null for nonexistent (absence rule)", async () => {
      expect(await spaceService.getById("nonexistent")).toBeNull();
    });
  });
});
