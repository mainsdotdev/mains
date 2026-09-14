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

import { spaceRepo } from "./space.repo";

describe("spaceRepo", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
    createAccount(db, { id: "default" });
  });

  afterEach(() => {
    cleanup();
  });

  describe("findAll", () => {
    it("returns empty array when no spaces", async () => {
      const result = await spaceRepo.findAll();
      expect(result).toEqual([]);
    });

    it("returns all spaces for default account", async () => {
      createSpace(db, { accountId: "default", name: "Space A" });
      createSpace(db, { accountId: "default", name: "Space B" });

      const result = await spaceRepo.findAll();
      expect(result).toHaveLength(2);
    });
  });

  describe("findById", () => {
    it("returns undefined when not found", async () => {
      const result = await spaceRepo.findById("nonexistent");
      expect(result).toBeUndefined();
    });

    it("returns space when found", async () => {
      const space = createSpace(db, { accountId: "default", name: "My Space" });

      const result = await spaceRepo.findById(space.id);
      expect(result).toBeDefined();
      expect(result!.name).toBe("My Space");
    });
  });

  describe("findBySlug", () => {
    it("returns undefined when not found", async () => {
      const result = await spaceRepo.findBySlug("nonexistent");
      expect(result).toBeUndefined();
    });

    it("returns space by slug", async () => {
      createSpace(db, { accountId: "default", name: "Coding", slug: "coding" });

      const result = await spaceRepo.findBySlug("coding");
      expect(result).toBeDefined();
      expect(result!.name).toBe("Coding");
    });
  });

  describe("getMaxSortOrder", () => {
    it("returns 0 when no spaces exist", async () => {
      const result = await spaceRepo.getMaxSortOrder();
      expect(result).toBe(0);
    });

    it("returns next sort order", async () => {
      createSpace(db, { accountId: "default", name: "Space A", sortOrder: 3 });
      createSpace(db, { accountId: "default", name: "Space B", sortOrder: 5 });

      const result = await spaceRepo.getMaxSortOrder();
      expect(result).toBe(6);
    });
  });

  describe("create", () => {
    it("creates a new space", async () => {
      await spaceRepo.create({
        id: "sp-1",
        accountId: "default",
        name: "New Space",
        slug: "new-space",
        description: null,
        systemPrompt: null,
        model: null,
        icon: null,
        themeConfig: null,
        providerId: "claude_code",
        mode: "developer",
        sortOrder: 0,
      });

      const result = await spaceRepo.findById("sp-1");
      expect(result).toBeDefined();
      expect(result!.name).toBe("New Space");
    });
  });

  describe("update", () => {
    it("updates space fields", async () => {
      const space = createSpace(db, { accountId: "default", name: "Old" });

      await spaceRepo.update(space.id, { name: "New" });

      const result = await spaceRepo.findById(space.id);
      expect(result!.name).toBe("New");
    });
  });

  describe("delete", () => {
    it("deletes a space", async () => {
      const space = createSpace(db, { accountId: "default" });

      await spaceRepo.delete(space.id);

      const result = await spaceRepo.findById(space.id);
      expect(result).toBeUndefined();
    });
  });

  describe("archive", () => {
    it("archives a space", async () => {
      const space = createSpace(db, { accountId: "default" });

      await spaceRepo.archive(space.id);

      const result = await spaceRepo.findById(space.id);
      expect(result!.isArchived).toBe(true);
    });
  });
});
