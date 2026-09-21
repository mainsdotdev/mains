import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createAccount, createEntity, createTask, createIssue } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type Database from "better-sqlite3";

let db: DatabaseInstance;
let _sqlite: Database.Database;
let cleanup: () => void;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

import { entitiesService } from "./entities.service";

describe("entitiesService", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
    createAccount(db, { id: "default" });
  });

  afterEach(() => {
    cleanup();
  });

  // ─────────────────────────────────────────────────────────────
  // Entity Operations
  // ─────────────────────────────────────────────────────────────
  describe("getAll", () => {
    it("returns success with entities", async () => {
      createEntity(db, { id: "e1" });
      const result = await entitiesService.getAll();
      expect(result).toHaveLength(1);
    });

    it("passes options through", async () => {
      createEntity(db, { id: "e1", kind: "task" });
      createEntity(db, { id: "e2", kind: "issue" });

      const result = await entitiesService.getAll({ kind: "task" });
      expect(result).toHaveLength(1);
    });
  });

  describe("getById", () => {
    it("returns entity by id", async () => {
      createEntity(db, { id: "e1", title: "Test" });
      const result = await entitiesService.getById("e1");
      expect((result as any)?.title).toBe("Test");
    });

    it("returns null data for non-existent", async () => {
      const result = await entitiesService.getById("missing");
      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("creates entity with generated id", async () => {
      const result = await entitiesService.create({
        accountId: "default",
        kind: "task",
        title: "Created Entity",
      });
      expect((result as any)?.title).toBe("Created Entity");
      expect((result as any)?.id).toBeTruthy();
    });
  });

  describe("update", () => {
    it("updates entity", async () => {
      createEntity(db, { id: "e1", title: "Old" });
      const result = await entitiesService.update("e1", { title: "New" });
      expect((result as any)?.title).toBe("New");
    });
  });

  describe("delete", () => {
    it("soft-deletes entity", async () => {
      createEntity(db, { id: "e1" });
      await entitiesService.delete("e1");

      const check = await entitiesService.getAll();
      expect(check).toHaveLength(0);
    });
  });

  describe("search", () => {
    it("returns matching entities", async () => {
      createEntity(db, { id: "e1", title: "Fix login bug" });
      createEntity(db, { id: "e2", title: "Add feature" });

      const result = await entitiesService.search("login");
      expect(result).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Task Operations
  // ─────────────────────────────────────────────────────────────
  describe("getAllTasks", () => {
    it("returns tasks", async () => {
      createTask(db, { entity: { id: "t1", title: "Task" } });
      const result = await entitiesService.getAllTasks();
      expect(result).toHaveLength(1);
    });
  });

  describe("getTaskById", () => {
    it("returns task by entity id", async () => {
      createTask(db, { entity: { id: "t1", title: "My Task" } });
      const result = await entitiesService.getTaskById("t1");
      expect((result as any)?.entity.title).toBe("My Task");
    });
  });

  describe("createTask", () => {
    it("creates task with entity", async () => {
      const result = await entitiesService.createTask({
        entity: { accountId: "default", kind: "task", title: "New Task" },
        status: "doing",
        priority: 2,
      });
      expect((result as any)?.task.status).toBe("doing");
    });
  });

  describe("updateTask", () => {
    it("updates task", async () => {
      createTask(db, { entity: { id: "t1" }, task: { status: "todo" } });
      const result = await entitiesService.updateTask("t1", { status: "done" });
      expect((result as any)?.task.status).toBe("done");
    });
  });

  describe("deleteTask", () => {
    it("soft-deletes task entity", async () => {
      createTask(db, { entity: { id: "t1" } });
      await entitiesService.deleteTask("t1");

      const check = await entitiesService.getAllTasks();
      expect(check).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Issue Operations
  // ─────────────────────────────────────────────────────────────
  describe("getAllIssues", () => {
    it("returns issues", async () => {
      createIssue(db, { entity: { id: "i1" }, issue: { provider: "github", state: "open" } });
      const result = await entitiesService.getAllIssues();
      expect(result).toHaveLength(1);
    });
  });

  describe("getIssueById", () => {
    it("returns issue by entity id", async () => {
      createIssue(db, {
        entity: { id: "i1", title: "Bug" },
        issue: { provider: "github", state: "open" },
      });
      const result = await entitiesService.getIssueById("i1");
      expect((result as any)?.entity.title).toBe("Bug");
    });
  });

  describe("createIssue", () => {
    it("creates issue with entity", async () => {
      const result = await entitiesService.createIssue({
        entity: { accountId: "default", kind: "issue", title: "New Issue" },
        provider: "github",
        state: "open",
        number: 42,
      });
      expect((result as any)?.issue.number).toBe(42);
    });
  });

  describe("updateIssue", () => {
    it("updates issue", async () => {
      createIssue(db, {
        entity: { id: "i1" },
        issue: { provider: "github", state: "open" },
      });
      const result = await entitiesService.updateIssue("i1", { state: "closed" });
      expect((result as any)?.issue.state).toBe("closed");
    });
  });

  describe("deleteIssue", () => {
    it("soft-deletes issue entity", async () => {
      createIssue(db, {
        entity: { id: "i1" },
        issue: { provider: "github", state: "open" },
      });
      await entitiesService.deleteIssue("i1");

      const check = await entitiesService.getAllIssues();
      expect(check).toHaveLength(0);
    });
  });
});
