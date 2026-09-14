import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createProvider } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type Database from "better-sqlite3";

let db: DatabaseInstance;
let _sqlite: Database.Database;
let cleanup: () => void;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

import { providersRepo } from "./providers.repo";

describe("providersRepo", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
  });

  afterEach(() => {
    cleanup();
  });

  describe("findAll", () => {
    it("returns empty array when no providers", async () => {
      const result = await providersRepo.findAll();
      expect(result).toEqual([]);
    });

    it("returns all providers", async () => {
      createProvider(db, { id: "p1", displayName: "Provider 1" });
      createProvider(db, { id: "p2", displayName: "Provider 2" });

      const result = await providersRepo.findAll();
      expect(result).toHaveLength(2);
    });

    it("parses JSON config and capabilities", async () => {
      createProvider(db, {
        id: "p1",
        config: JSON.stringify({ baseUrl: "http://api.test" }),
        capabilities: JSON.stringify({ streaming: true }),
      });

      const result = await providersRepo.findAll();
      expect(result[0].config).toEqual({ baseUrl: "http://api.test" });
      expect(result[0].capabilities).toEqual({ streaming: true });
    });

    it("returns null for null config and capabilities", async () => {
      createProvider(db, { id: "p1" });

      const result = await providersRepo.findAll();
      expect(result[0].config).toBeNull();
      expect(result[0].capabilities).toBeNull();
    });
  });

  describe("findById", () => {
    it("returns provider by id", async () => {
      createProvider(db, { id: "p1", displayName: "Test Provider" });

      const result = await providersRepo.findById("p1");
      expect(result).not.toBeNull();
      expect(result!.displayName).toBe("Test Provider");
    });

    it("returns null for non-existent id", async () => {
      const result = await providersRepo.findById("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("findByKind", () => {
    it("returns providers matching kind", async () => {
      createProvider(db, { id: "p1", kind: "agent_runtime" });
      createProvider(db, { id: "p2", kind: "llm_runtime" });
      createProvider(db, { id: "p3", kind: "agent_runtime" });

      const result = await providersRepo.findByKind("agent_runtime");
      expect(result).toHaveLength(2);
      result.forEach((p) => expect(p.kind).toBe("agent_runtime"));
    });
  });

  describe("findEnabled", () => {
    it("returns only enabled providers", async () => {
      createProvider(db, { id: "p1", isEnabled: true });
      createProvider(db, { id: "p2", isEnabled: false });

      const result = await providersRepo.findEnabled();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("p1");
    });
  });

  describe("insert", () => {
    it("creates a new provider", async () => {
      const id = await providersRepo.insert({
        id: "new-provider",
        kind: "llm_runtime",
        displayName: "New Provider",
        isEnabled: true,
        defaultModel: "gpt-4",
      });

      expect(id).toBe("new-provider");
      const found = await providersRepo.findById("new-provider");
      expect(found!.displayName).toBe("New Provider");
      expect(found!.defaultModel).toBe("gpt-4");
    });

    it("stores JSON config and capabilities", async () => {
      await providersRepo.insert({
        id: "p1",
        kind: "agent_runtime",
        displayName: "Test",
        config: { baseUrl: "http://test.com", timeout: 5000 },
        capabilities: { streaming: true, vision: false },
      });

      const found = await providersRepo.findById("p1");
      expect(found!.config).toEqual({ baseUrl: "http://test.com", timeout: 5000 });
      expect(found!.capabilities).toEqual({ streaming: true, vision: false });
    });
  });

  describe("update", () => {
    it("updates provider fields", async () => {
      createProvider(db, { id: "p1", displayName: "Old Name" });

      const result = await providersRepo.update("p1", {
        displayName: "New Name",
        defaultModel: "claude-3",
      });

      expect(result!.displayName).toBe("New Name");
      expect(result!.defaultModel).toBe("claude-3");
    });

    it("updates config JSON", async () => {
      createProvider(db, { id: "p1" });

      const result = await providersRepo.update("p1", {
        config: { apiKey: "test-key" },
      });

      expect(result!.config).toEqual({ apiKey: "test-key" });
    });

    it("returns null for non-existent provider", async () => {
      const result = await providersRepo.update("non-existent", {
        displayName: "Test",
      });
      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("deletes provider", async () => {
      createProvider(db, { id: "p1" });

      await providersRepo.delete("p1");
      const result = await providersRepo.findById("p1");
      expect(result).toBeNull();
    });
  });

  describe("setEnabled", () => {
    it("enables a disabled provider", async () => {
      createProvider(db, { id: "p1", isEnabled: false });

      await providersRepo.setEnabled("p1", true);
      const found = await providersRepo.findById("p1");
      expect(found!.isEnabled).toBe(true);
    });

    it("disables an enabled provider", async () => {
      createProvider(db, { id: "p1", isEnabled: true });

      await providersRepo.setEnabled("p1", false);
      const found = await providersRepo.findById("p1");
      expect(found!.isEnabled).toBe(false);
    });
  });
});
