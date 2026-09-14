import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createAccount, createProvider } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type Database from "better-sqlite3";

let db: DatabaseInstance;
let _sqlite: Database.Database;
let cleanup: () => void;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

// Mock adapter functions
vi.mock("./adapters", () => ({
  listModelsForProvider: vi.fn().mockResolvedValue([
    { id: "gpt-4", name: "GPT-4" },
  ]),
  listCommandsForProvider: vi.fn().mockResolvedValue([
    { id: "run", name: "Run" },
  ]),
  listSkillsForProvider: vi.fn().mockResolvedValue([
    { id: "code", name: "Code" },
  ]),
  listInstalledPluginsForProvider: vi.fn().mockResolvedValue({
    marketplaces: [
      {
        name: "installed",
        path: "",
        interface: null,
        plugins: [{ id: "figma@installed", name: "figma", installed: true }],
      },
    ],
    marketplaceLoadErrors: [],
    remoteSyncError: null,
    featuredPluginIds: [],
  }),
  refreshWorkAdapterConfig: vi.fn(),
}));

import { providersService, providerForPairedDevice } from "./providers.service";

describe("providersService", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
    createAccount(db, { id: "default" });
  });

  afterEach(() => {
    cleanup();
  });

  // ─────────────────────────────────────────────────────────────
  // CRUD
  // ─────────────────────────────────────────────────────────────
  describe("getAll", () => {
    it("returns empty array when no providers", async () => {
      const result = await providersService.getAll();
      expect(result).toEqual([]);
    });

    it("returns all providers", async () => {
      createProvider(db, { id: "p1", displayName: "P1" });
      createProvider(db, { id: "p2", displayName: "P2" });

      const result = await providersService.getAll();
      expect(result).toHaveLength(2);
    });
  });

  describe("getById", () => {
    it("returns provider when found", async () => {
      createProvider(db, { id: "p1", displayName: "Provider 1" });

      const result = await providersService.getById("p1");
      expect(result?.displayName).toBe("Provider 1");
    });

    it("returns null when not found (absence rule)", async () => {
      expect(await providersService.getById("nonexistent")).toBeNull();
    });
  });

  describe("getByKind", () => {
    it("returns providers filtered by kind", async () => {
      createProvider(db, { id: "p1", kind: "agent_runtime" });
      createProvider(db, { id: "p2", kind: "llm_runtime" });

      const result = await providersService.getByKind("agent_runtime");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("p1");
    });
  });

  describe("getEnabled", () => {
    it("returns only enabled providers", async () => {
      createProvider(db, { id: "p1", isEnabled: true });
      createProvider(db, { id: "p2", isEnabled: false });

      const result = await providersService.getEnabled();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("p1");
    });
  });

  describe("create", () => {
    it("creates a new provider", async () => {
      const result = await providersService.create({
        id: "new-provider",
        kind: "agent_runtime",
        displayName: "New Provider",
      });
      expect(result).toBe("new-provider");
    });

    it("returns error if provider already exists", async () => {
      createProvider(db, { id: "p1" });

      await expect(providersService.create({ id: "p1", kind: "agent_runtime", displayName: "Duplicate", })).rejects.toThrow("Provider with this ID already exists");
    });
  });

  describe("update", () => {
    it("updates and returns provider", async () => {
      createProvider(db, { id: "p1", displayName: "Old" });

      const result = await providersService.update("p1", { displayName: "New" });
      expect(result.displayName).toBe("New");
    });

    it("returns error for nonexistent provider", async () => {
      await expect(providersService.update("nonexistent", { displayName: "X" })).rejects.toThrow("Provider not found");
    });
  });

  describe("updateRunSettings", () => {
    it("writes effortLevel + thinkingMode for Claude and turns ultracode off", async () => {
      createProvider(db, {
        id: "claude_code",
        config: JSON.stringify({ apiKey: "secret", ultracode: true, effortLevel: "medium", thinkingMode: true }),
      });
      const updated = await providersService.updateRunSettings("claude_code", { effortLevel: "high" });
      expect(updated.config).toMatchObject({
        apiKey: "secret",
        effortLevel: "high",
        thinkingMode: true,
        ultracode: false,
      });
    });

    it("stores Codex's effort as modelReasoningEffort", async () => {
      createProvider(db, { id: "codex", config: JSON.stringify({ sandboxMode: "workspace-write" }) });
      const updated = await providersService.updateRunSettings("codex", { effortLevel: "low" });
      expect(updated.config).toMatchObject({
        sandboxMode: "workspace-write",
        modelReasoningEffort: "low",
        thinkingMode: true,
      });
      expect(updated.config).not.toHaveProperty("effortLevel");
    });

    it("clears the level when reasoning is turned off", async () => {
      createProvider(db, {
        id: "claude_code",
        config: JSON.stringify({ effortLevel: "high", thinkingMode: true }),
      });
      const updated = await providersService.updateRunSettings("claude_code", { effortLevel: "" });
      expect(updated.config).not.toHaveProperty("effortLevel");
      expect(updated.config).toMatchObject({ thinkingMode: false });
    });

    it("rejects unknown effort levels", async () => {
      createProvider(db, { id: "claude_code" });
      await expect(
        providersService.updateRunSettings("claude_code", { effortLevel: "ludicrous" }),
      ).rejects.toThrow(/Unknown effort level/);
    });

    it("writes the permission mode under each provider's own key", async () => {
      createProvider(db, { id: "claude_code" });
      createProvider(db, { id: "codex" });
      createProvider(db, { id: "cursor" });
      expect(
        (await providersService.updateRunSettings("claude_code", { permissionMode: "acceptEdits" })).config,
      ).toMatchObject({ permissionMode: "acceptEdits" });
      expect(
        (await providersService.updateRunSettings("codex", { permissionMode: "read-only" })).config,
      ).toMatchObject({ sandboxMode: "read-only" });
      expect(
        (await providersService.updateRunSettings("cursor", { permissionMode: "plan" })).config,
      ).toMatchObject({ mode: "plan" });
    });

    it("rejects a permission mode the provider does not have", async () => {
      createProvider(db, { id: "copilot_cli" });
      await expect(
        providersService.updateRunSettings("copilot_cli", { permissionMode: "dontAsk" }),
      ).rejects.toThrow(/Unknown permission mode/);
    });

    it("maps fast mode to Codex's service tier and a boolean elsewhere", async () => {
      createProvider(db, { id: "codex" });
      createProvider(db, { id: "claude_code" });
      expect(
        (await providersService.updateRunSettings("codex", { fastMode: true })).config,
      ).toMatchObject({ serviceTier: "fast" });
      expect(
        (await providersService.updateRunSettings("codex", { fastMode: false })).config,
      ).not.toHaveProperty("serviceTier");
      expect(
        (await providersService.updateRunSettings("claude_code", { fastMode: true })).config,
      ).toMatchObject({ fastMode: true });
    });

    it("keeps Codex's goal and plan modes mutually exclusive", async () => {
      createProvider(db, { id: "codex", config: JSON.stringify({ planMode: true }) });
      expect(
        (await providersService.updateRunSettings("codex", { goalMode: true })).config,
      ).toMatchObject({ goalMode: true, planMode: false });
      expect(
        (await providersService.updateRunSettings("codex", { planMode: true })).config,
      ).toMatchObject({ goalMode: false, planMode: true });
    });

    it("refuses goal and plan toggles outside Codex", async () => {
      createProvider(db, { id: "claude_code" });
      await expect(
        providersService.updateRunSettings("claude_code", { goalMode: true }),
      ).rejects.toThrow(/Codex/);
      await expect(
        providersService.updateRunSettings("claude_code", { planMode: true }),
      ).rejects.toThrow(/Codex/);
    });

    it("throws for a missing provider", async () => {
      await expect(
        providersService.updateRunSettings("nope", { effortLevel: "high" }),
      ).rejects.toThrow("Provider not found");
    });
  });

  describe("providerForPairedDevice", () => {
    it("keeps run settings and drops credentials", async () => {
      createProvider(db, {
        id: "claude_code",
        config: JSON.stringify({
          apiKey: "secret",
          baseUrl: "http://internal",
          timeout: 5,
          effortLevel: "high",
          thinkingMode: true,
          permissionMode: "auto",
          fastMode: true,
        }),
      });
      const provider = await providersService.getById("claude_code");
      const view = providerForPairedDevice(provider!);
      expect(view.config).toEqual({
        effortLevel: "high",
        thinkingMode: true,
        permissionMode: "auto",
        fastMode: true,
      });
    });
  });

  describe("delete", () => {
    it("deletes a provider", async () => {
      createProvider(db, { id: "p1" });

      await providersService.delete("p1");

      expect(await providersService.getById("p1")).toBeNull();
    });
  });

  describe("enable", () => {
    it("enables a provider", async () => {
      createProvider(db, { id: "p1", isEnabled: false });

      await providersService.enable("p1");

      const check = await providersService.getById("p1");
      expect(check?.isEnabled).toBe(true);
    });
  });

  describe("disable", () => {
    it("disables a provider", async () => {
      createProvider(db, { id: "p1", isEnabled: true });

      await providersService.disable("p1");

      const check = await providersService.getById("p1");
      expect(check?.isEnabled).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Adapter-backed queries
  // ─────────────────────────────────────────────────────────────
  describe("getModels", () => {
    it("returns models for enabled provider", async () => {
      createProvider(db, { id: "p1", isEnabled: true });

      const result = await providersService.getModels("p1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("gpt-4");
    });

    it("returns error for nonexistent provider", async () => {
      await expect(providersService.getModels("nonexistent")).rejects.toThrow("Provider not found");
    });

    it("returns error for disabled provider", async () => {
      createProvider(db, { id: "p1", isEnabled: false });

      await expect(providersService.getModels("p1")).rejects.toThrow("Provider is not enabled");
    });
  });

  describe("getCommands", () => {
    it("returns commands for enabled provider", async () => {
      createProvider(db, { id: "p1", isEnabled: true });

      const result = await providersService.getCommands("p1");
      expect(result).toHaveLength(1);
    });

    it("returns error for disabled provider", async () => {
      createProvider(db, { id: "p1", isEnabled: false });

      await expect(providersService.getCommands("p1")).rejects.toThrow("Provider is not enabled");
    });
  });

  describe("getSkills", () => {
    it("returns skills for enabled provider", async () => {
      createProvider(db, { id: "p1", isEnabled: true });

      const result = await providersService.getSkills("p1");
      expect(result).toHaveLength(1);
    });

    it("returns error for nonexistent provider", async () => {
      await expect(providersService.getSkills("nonexistent")).rejects.toThrow("Provider not found");
    });

    it("returns error for disabled provider", async () => {
      createProvider(db, { id: "p1", isEnabled: false });

      await expect(providersService.getSkills("p1")).rejects.toThrow("Provider is not enabled");
    });
  });

  describe("getInstalledPlugins", () => {
    it("uses the installed-only adapter surface", async () => {
      createProvider(db, { id: "p1", isEnabled: true });

      const result = await providersService.getInstalledPlugins("p1");

      expect(result.marketplaces[0].plugins[0]).toMatchObject({
        id: "figma@installed",
        installed: true,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Missing branch: getCommands nonexistent provider
  // ─────────────────────────────────────────────────────────────
  describe("getCommands (additional)", () => {
    it("returns error for nonexistent provider", async () => {
      await expect(providersService.getCommands("nonexistent")).rejects.toThrow("Provider not found");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Catch block coverage via repo failures
  // ─────────────────────────────────────────────────────────────
  describe("error handling (catch blocks)", () => {
    it("getAll returns error on repo failure", async () => {
      const { providersRepo } = await import("./providers.repo");
      const spy = vi.spyOn(providersRepo, "findAll").mockRejectedValueOnce(new Error("db error"));

      await expect(providersService.getAll()).rejects.toThrow("db error");

      spy.mockRestore();
    });

    it("getById returns error on repo failure", async () => {
      const { providersRepo } = await import("./providers.repo");
      const spy = vi.spyOn(providersRepo, "findById").mockRejectedValueOnce(new Error("db error"));

      await expect(providersService.getById("p1")).rejects.toThrow("db error");

      spy.mockRestore();
    });

    it("getByKind returns error on repo failure", async () => {
      const { providersRepo } = await import("./providers.repo");
      const spy = vi.spyOn(providersRepo, "findByKind").mockRejectedValueOnce(new Error("db error"));

      await expect(providersService.getByKind("agent_runtime")).rejects.toThrow("db error");

      spy.mockRestore();
    });

    it("getEnabled returns error on repo failure", async () => {
      const { providersRepo } = await import("./providers.repo");
      const spy = vi.spyOn(providersRepo, "findEnabled").mockRejectedValueOnce(new Error("db error"));

      await expect(providersService.getEnabled()).rejects.toThrow("db error");

      spy.mockRestore();
    });

    it("create returns error on repo failure", async () => {
      const { providersRepo } = await import("./providers.repo");
      const spy = vi.spyOn(providersRepo, "findById").mockRejectedValueOnce(new Error("db error"));

      await expect(providersService.create({ id: "fail-provider", kind: "agent_runtime", displayName: "Fail", })).rejects.toThrow("db error");

      spy.mockRestore();
    });

    it("update returns error on repo failure", async () => {
      const { providersRepo } = await import("./providers.repo");
      const spy = vi.spyOn(providersRepo, "update").mockRejectedValueOnce(new Error("db error"));

      await expect(providersService.update("p1", { displayName: "X" })).rejects.toThrow("db error");

      spy.mockRestore();
    });

    it("delete returns error on repo failure", async () => {
      const { providersRepo } = await import("./providers.repo");
      const spy = vi.spyOn(providersRepo, "delete").mockRejectedValueOnce(new Error("db error"));

      await expect(providersService.delete("p1")).rejects.toThrow("db error");

      spy.mockRestore();
    });

    it("enable returns error on repo failure", async () => {
      const { providersRepo } = await import("./providers.repo");
      const spy = vi.spyOn(providersRepo, "setEnabled").mockRejectedValueOnce(new Error("db error"));

      await expect(providersService.enable("p1")).rejects.toThrow("db error");

      spy.mockRestore();
    });

    it("disable returns error on repo failure", async () => {
      const { providersRepo } = await import("./providers.repo");
      const spy = vi.spyOn(providersRepo, "setEnabled").mockRejectedValueOnce(new Error("db error"));

      await expect(providersService.disable("p1")).rejects.toThrow("db error");

      spy.mockRestore();
    });

    it("getModels returns error.message when error is an Error instance", async () => {
      createProvider(db, { id: "p1", isEnabled: true });
      const { listModelsForProvider } = await import("./adapters");
      const mockFn = vi.mocked(listModelsForProvider);
      mockFn.mockRejectedValueOnce(new Error("Model fetch failed"));

      await expect(providersService.getModels("p1")).rejects.toThrow("Model fetch failed");
    });

    it("getModels returns generic message when error is not an Error instance", async () => {
      createProvider(db, { id: "p1", isEnabled: true });
      const { listModelsForProvider } = await import("./adapters");
      const mockFn = vi.mocked(listModelsForProvider);
      mockFn.mockRejectedValueOnce("string error");

      await expect(providersService.getModels("p1")).rejects.toBe("string error");
    });

    it("getCommands returns error.message when error is an Error instance", async () => {
      createProvider(db, { id: "p1", isEnabled: true });
      const { listCommandsForProvider } = await import("./adapters");
      const mockFn = vi.mocked(listCommandsForProvider);
      mockFn.mockRejectedValueOnce(new Error("Command fetch failed"));

      await expect(providersService.getCommands("p1")).rejects.toThrow("Command fetch failed");
    });

    it("getCommands returns generic message when error is not an Error instance", async () => {
      createProvider(db, { id: "p1", isEnabled: true });
      const { listCommandsForProvider } = await import("./adapters");
      const mockFn = vi.mocked(listCommandsForProvider);
      mockFn.mockRejectedValueOnce("string error");

      await expect(providersService.getCommands("p1")).rejects.toBe("string error");
    });

    it("getSkills returns error.message when error is an Error instance", async () => {
      createProvider(db, { id: "p1", isEnabled: true });
      const { listSkillsForProvider } = await import("./adapters");
      const mockFn = vi.mocked(listSkillsForProvider);
      mockFn.mockRejectedValueOnce(new Error("Skill fetch failed"));

      await expect(providersService.getSkills("p1")).rejects.toThrow("Skill fetch failed");
    });

    it("getSkills returns generic message when error is not an Error instance", async () => {
      createProvider(db, { id: "p1", isEnabled: true });
      const { listSkillsForProvider } = await import("./adapters");
      const mockFn = vi.mocked(listSkillsForProvider);
      mockFn.mockRejectedValueOnce("string error");

      await expect(providersService.getSkills("p1")).rejects.toBe("string error");
    });
  });
});
