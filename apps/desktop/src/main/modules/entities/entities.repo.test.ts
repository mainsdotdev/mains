import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import {
  createAccount,
  createConnection,
  createConnectionResource,
  createEntity,
  createIssue,
  createTask,
} from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type Database from "better-sqlite3";

let db: DatabaseInstance;
let _sqlite: Database.Database;
let cleanup: () => void;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

import { entitiesRepo } from "./entities.repo";

describe("entitiesRepo", () => {
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
  describe("findAll", () => {
    it("returns empty array when no entities", async () => {
      const result = await entitiesRepo.findAll();
      expect(result).toEqual([]);
    });

    it("returns non-deleted entities", async () => {
      createEntity(db, { id: "e1", title: "Entity 1" });
      createEntity(db, { id: "e2", title: "Entity 2" });
      createEntity(db, { id: "e3", title: "Deleted", isDeleted: true });

      const result = await entitiesRepo.findAll();
      expect(result).toHaveLength(2);
    });

    it("filters by kind", async () => {
      createEntity(db, { id: "e1", kind: "task" });
      createEntity(db, { id: "e2", kind: "issue" });

      const result = await entitiesRepo.findAll({ kind: "task" });
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe("task");
    });

    it("filters by kinds array", async () => {
      createEntity(db, { id: "e1", kind: "task" });
      createEntity(db, { id: "e2", kind: "issue" });
      createEntity(db, { id: "e3", kind: "note" });

      const result = await entitiesRepo.findAll({ kinds: ["task", "issue"] });
      expect(result).toHaveLength(2);
    });

    it("filters by connectionId", async () => {
      const conn = createConnection(db, { id: "conn-1" });
      createEntity(db, { id: "e1", connectionId: conn.id });
      createEntity(db, { id: "e2" });

      const result = await entitiesRepo.findAll({ connectionId: "conn-1" });
      expect(result).toHaveLength(1);
      expect(result[0].connectionId).toBe("conn-1");
    });

    it("filters by connectionIds array", async () => {
      createConnection(db, { id: "conn-1" });
      createConnection(db, { id: "conn-2" });
      createEntity(db, { id: "e1", connectionId: "conn-1" });
      createEntity(db, { id: "e2", connectionId: "conn-2" });
      createEntity(db, { id: "e3" });

      const result = await entitiesRepo.findAll({ connectionIds: ["conn-1", "conn-2"] });
      expect(result).toHaveLength(2);
    });

    it("respects limit option", async () => {
      for (let i = 0; i < 5; i++) {
        createEntity(db, { id: `e${i}` });
      }
      const result = await entitiesRepo.findAll({ limit: 3 });
      expect(result).toHaveLength(3);
    });
  });

  describe("findById", () => {
    it("returns entity by id", async () => {
      createEntity(db, { id: "e1", title: "My Entity" });
      const result = await entitiesRepo.findById("e1");
      expect(result).not.toBeNull();
      expect(result!.title).toBe("My Entity");
    });

    it("returns null for non-existent id", async () => {
      const result = await entitiesRepo.findById("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("insert", () => {
    it("creates a new entity", async () => {
      const result = await entitiesRepo.insert("e1", {
        accountId: "default",
        kind: "task",
        title: "New Entity",
        body: "Body text",
        summary: "Summary",
      });
      expect(result).not.toBeNull();
      expect(result!.id).toBe("e1");
      expect(result!.title).toBe("New Entity");
    });

    it("creates entity with metadata", async () => {
      await entitiesRepo.insert("e1", {
        accountId: "default",
        kind: "task",
        metadata: { source: "github", priority: "high" },
      });
      const found = await entitiesRepo.findById("e1");
      expect(found).not.toBeNull();
      expect(JSON.parse(found!.metadata!)).toEqual({ source: "github", priority: "high" });
    });
  });

  describe("update", () => {
    it("updates entity fields", async () => {
      createEntity(db, { id: "e1", title: "Original" });

      const result = await entitiesRepo.update("e1", { title: "Updated" });
      expect(result!.title).toBe("Updated");
    });

    it("updates metadata", async () => {
      createEntity(db, { id: "e1" });

      await entitiesRepo.update("e1", { metadata: { key: "value" } });
      const found = await entitiesRepo.findById("e1");
      expect(JSON.parse(found!.metadata!)).toEqual({ key: "value" });
    });
  });

  describe("softDelete", () => {
    it("marks entity as deleted", async () => {
      createEntity(db, { id: "e1" });

      await entitiesRepo.softDelete("e1");
      const found = await entitiesRepo.findById("e1");
      expect(found!.isDeleted).toBe(true);
    });

    it("soft-deleted entities excluded from findAll", async () => {
      createEntity(db, { id: "e1" });
      createEntity(db, { id: "e2" });

      await entitiesRepo.softDelete("e1");
      const result = await entitiesRepo.findAll();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("e2");
    });
  });

  describe("search", () => {
    it("searches by title", async () => {
      createEntity(db, { id: "e1", title: "Fix login bug" });
      createEntity(db, { id: "e2", title: "Add feature" });

      const result = await entitiesRepo.search("login");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("e1");
    });

    it("searches by body", async () => {
      createEntity(db, { id: "e1", title: "Bug", body: "The authentication flow is broken" });
      createEntity(db, { id: "e2", title: "Feature" });

      const result = await entitiesRepo.search("authentication");
      expect(result).toHaveLength(1);
    });

    it("searches by summary", async () => {
      createEntity(db, { id: "e1", summary: "Login page crash" });
      createEntity(db, { id: "e2", summary: "Dashboard update" });

      const result = await entitiesRepo.search("crash");
      expect(result).toHaveLength(1);
    });

    it("excludes deleted entities from search", async () => {
      createEntity(db, { id: "e1", title: "searchable", isDeleted: true });
      createEntity(db, { id: "e2", title: "also searchable" });

      const result = await entitiesRepo.search("searchable");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("e2");
    });

    it("filters search by kind", async () => {
      createEntity(db, { id: "e1", kind: "task", title: "Fix bug" });
      createEntity(db, { id: "e2", kind: "issue", title: "Fix issue bug" });

      const result = await entitiesRepo.search("Fix", { kind: "task" });
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe("task");
    });

    it("respects search limit", async () => {
      for (let i = 0; i < 5; i++) {
        createEntity(db, { id: `e${i}`, title: `Search item ${i}` });
      }
      const result = await entitiesRepo.search("Search", { limit: 2 });
      expect(result).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Task Operations
  // ─────────────────────────────────────────────────────────────
  describe("findAllTasks", () => {
    it("returns empty array when no tasks", async () => {
      const result = await entitiesRepo.findAllTasks();
      expect(result).toEqual([]);
    });

    it("returns tasks with joined entity data", async () => {
      createTask(db, {
        entity: { id: "t1", title: "My Task" },
        task: { status: "todo" },
      });

      const result = await entitiesRepo.findAllTasks();
      expect(result).toHaveLength(1);
      expect(result[0].entity.title).toBe("My Task");
      expect(result[0].task.status).toBe("todo");
    });

    it("filters by status", async () => {
      createTask(db, { entity: { id: "t1" }, task: { status: "todo" } });
      createTask(db, { entity: { id: "t2" }, task: { status: "done" } });

      const result = await entitiesRepo.findAllTasks({ status: "done" });
      expect(result).toHaveLength(1);
      expect(result[0].task.status).toBe("done");
    });

    it("excludes deleted entities", async () => {
      createTask(db, { entity: { id: "t1", isDeleted: true } });
      createTask(db, { entity: { id: "t2" } });

      const result = await entitiesRepo.findAllTasks();
      expect(result).toHaveLength(1);
    });
  });

  describe("findTaskById", () => {
    it("returns task with entity data", async () => {
      createTask(db, { entity: { id: "t1", title: "Task 1" } });

      const result = await entitiesRepo.findTaskById("t1");
      expect(result).not.toBeNull();
      expect(result!.entity.title).toBe("Task 1");
    });

    it("returns null for non-existent task", async () => {
      const result = await entitiesRepo.findTaskById("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("insertTask", () => {
    it("creates entity and task together", async () => {
      const result = await entitiesRepo.insertTask("t1", {
        entity: {
          accountId: "default",
          kind: "task",
          title: "New Task",
          body: "Task body",
        },
        status: "doing",
        priority: 3,
        labels: ["bug", "critical"],
      });

      expect(result).not.toBeNull();
      expect(result!.entity.title).toBe("New Task");
      expect(result!.task.status).toBe("doing");
      expect(result!.task.priority).toBe(3);
    });

    it("defaults status to todo and priority to 0", async () => {
      const result = await entitiesRepo.insertTask("t1", {
        entity: { accountId: "default", kind: "task", title: "Task" },
      });

      expect(result!.task.status).toBe("todo");
      expect(result!.task.priority).toBe(0);
    });
  });

  describe("updateTask", () => {
    it("updates task fields", async () => {
      createTask(db, { entity: { id: "t1" }, task: { status: "todo", priority: 0 } });

      const result = await entitiesRepo.updateTask("t1", {
        status: "done",
        priority: 5,
      });

      expect(result!.task.status).toBe("done");
      expect(result!.task.priority).toBe(5);
    });

    it("updates labels", async () => {
      createTask(db, { entity: { id: "t1" } });

      const result = await entitiesRepo.updateTask("t1", {
        labels: ["urgent", "frontend"],
      });

      const labels = result!.task.labels ? JSON.parse(result!.task.labels) : [];
      expect(labels).toEqual(["urgent", "frontend"]);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Issue Operations
  // ─────────────────────────────────────────────────────────────
  describe("findAllIssues", () => {
    it("returns empty array when no issues", async () => {
      const result = await entitiesRepo.findAllIssues();
      expect(result).toEqual([]);
    });

    it("returns issues with entity data", async () => {
      createIssue(db, {
        entity: { id: "i1", title: "Bug Report" },
        issue: { provider: "github", state: "open", number: 42 },
      });

      const result = await entitiesRepo.findAllIssues();
      expect(result).toHaveLength(1);
      expect(result[0].entity.title).toBe("Bug Report");
      expect(result[0].issue.number).toBe(42);
    });

    it("filters by provider", async () => {
      createIssue(db, { entity: { id: "i1" }, issue: { provider: "github", state: "open" } });
      createIssue(db, { entity: { id: "i2" }, issue: { provider: "linear", state: "open" } });

      const result = await entitiesRepo.findAllIssues({ provider: "github" });
      expect(result).toHaveLength(1);
    });

    it("filters by state", async () => {
      createIssue(db, { entity: { id: "i1" }, issue: { provider: "github", state: "open" } });
      createIssue(db, { entity: { id: "i2" }, issue: { provider: "github", state: "closed" } });

      const result = await entitiesRepo.findAllIssues({ state: "closed" });
      expect(result).toHaveLength(1);
    });

    it("filters by repo", async () => {
      createIssue(db, { entity: { id: "i1" }, issue: { provider: "github", state: "open", repo: "owner/repo-a" } });
      createIssue(db, { entity: { id: "i2" }, issue: { provider: "github", state: "open", repo: "owner/repo-b" } });

      const result = await entitiesRepo.findAllIssues({ repo: "owner/repo-a" });
      expect(result).toHaveLength(1);
    });
  });

  describe("findIssuesByResourceIds", () => {
    it("returns empty array when no resourceIds given", async () => {
      const result = await entitiesRepo.findIssuesByResourceIds([]);
      expect(result).toEqual([]);
    });

    it("returns issues for entities linked to any of the resourceIds", async () => {
      const conn = createConnection(db, { id: "conn-1" });
      createConnectionResource(db, { id: "res-1", connectionId: conn.id });
      createConnectionResource(db, { id: "res-2", connectionId: conn.id });
      createConnectionResource(db, { id: "res-3", connectionId: conn.id });

      createIssue(db, {
        entity: { id: "i1", resourceId: "res-1", title: "First" },
        issue: { provider: "github", state: "open", number: 1 },
      });
      createIssue(db, {
        entity: { id: "i2", resourceId: "res-2", title: "Second" },
        issue: { provider: "github", state: "open", number: 2 },
      });
      createIssue(db, {
        entity: { id: "i3", resourceId: "res-3", title: "Other" },
        issue: { provider: "github", state: "open", number: 3 },
      });

      const result = await entitiesRepo.findIssuesByResourceIds(["res-1", "res-2"]);
      expect(result).toHaveLength(2);
      const titles = result.map((r) => r.entity.title).sort();
      expect(titles).toEqual(["First", "Second"]);
    });

    it("excludes deleted entities", async () => {
      const conn = createConnection(db, { id: "conn-1" });
      createConnectionResource(db, { id: "res-1", connectionId: conn.id });

      createIssue(db, {
        entity: { id: "i1", resourceId: "res-1", isDeleted: true },
        issue: { provider: "github", state: "open" },
      });

      const result = await entitiesRepo.findIssuesByResourceIds(["res-1"]);
      expect(result).toHaveLength(0);
    });

    it("orders by issue number", async () => {
      const conn = createConnection(db, { id: "conn-1" });
      createConnectionResource(db, { id: "res-1", connectionId: conn.id });

      createIssue(db, {
        entity: { id: "i1", resourceId: "res-1" },
        issue: { provider: "github", state: "open", number: 30 },
      });
      createIssue(db, {
        entity: { id: "i2", resourceId: "res-1" },
        issue: { provider: "github", state: "open", number: 10 },
      });

      const result = await entitiesRepo.findIssuesByResourceIds(["res-1"]);
      expect(result.map((r) => r.issue.number)).toEqual([10, 30]);
    });
  });

  describe("findIssueById", () => {
    it("returns issue with entity data", async () => {
      createIssue(db, {
        entity: { id: "i1", title: "Issue Title" },
        issue: { provider: "github", state: "open" },
      });

      const result = await entitiesRepo.findIssueById("i1");
      expect(result).not.toBeNull();
      expect(result!.entity.title).toBe("Issue Title");
    });

    it("returns null for non-existent", async () => {
      const result = await entitiesRepo.findIssueById("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("insertIssue", () => {
    it("creates entity and issue together", async () => {
      const result = await entitiesRepo.insertIssue("i1", {
        entity: {
          accountId: "default",
          kind: "issue",
          title: "New Issue",
        },
        provider: "github",
        state: "open",
        number: 100,
        repo: "owner/repo",
        assignee: "user1",
        labels: ["bug"],
      });

      expect(result).not.toBeNull();
      expect(result!.entity.title).toBe("New Issue");
      expect(result!.issue.provider).toBe("github");
      expect(result!.issue.number).toBe(100);
      expect(result!.issue.assignee).toBe("user1");
    });
  });

  describe("updateIssue", () => {
    it("updates issue fields", async () => {
      createIssue(db, {
        entity: { id: "i1" },
        issue: { provider: "github", state: "open" },
      });

      const result = await entitiesRepo.updateIssue("i1", {
        state: "closed",
        assignee: "new-user",
      });

      expect(result!.issue.state).toBe("closed");
      expect(result!.issue.assignee).toBe("new-user");
    });

    it("updates priority", async () => {
      createIssue(db, {
        entity: { id: "i1" },
        issue: { provider: "github", state: "open", priority: 0 },
      });

      const result = await entitiesRepo.updateIssue("i1", { priority: 3 });
      expect(result!.issue.priority).toBe(3);
    });
  });
});
