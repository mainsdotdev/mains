import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createAccount, createConnection, createEntity } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type Database from "better-sqlite3";
import { entities, issues } from "../../db/schema";
import { eq } from "drizzle-orm";

let db: DatabaseInstance;
let _sqlite: Database.Database;
let cleanup: () => void;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

vi.mock("nanoid", () => ({
  nanoid: () => "generated-id-" + Math.random().toString(36).slice(2, 10),
}));

import { syncRepo } from "./sync.repo";
import type { EntityInput } from "./sync.dto";

function makeEntityInput(overrides: Partial<EntityInput> = {}): EntityInput {
  return {
    kind: "task",
    title: "Test Entity",
    url: `https://example.com/${Math.random().toString(36).slice(2)}`,
    body: "Test body",
    summary: "Test summary",
    occurredAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("syncRepo", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
    createAccount(db, { id: "default" });
  });

  afterEach(() => {
    cleanup();
  });

  describe("findEntityByUrl", () => {
    it("returns null when no entity exists", async () => {
      const result = await syncRepo.findEntityByUrl("https://none.com", null);
      expect(result).toBeNull();
    });

    it("finds entity by url with null connectionId", async () => {
      createEntity(db, { id: "e1", url: "https://example.com/1", connectionId: null });
      const result = await syncRepo.findEntityByUrl("https://example.com/1", null);
      expect(result).not.toBeNull();
      expect(result!.id).toBe("e1");
    });

    it("finds entity by url with specific connectionId", async () => {
      createConnection(db, { id: "conn-1" });
      createEntity(db, { id: "e2", url: "https://example.com/2", connectionId: "conn-1" });
      const result = await syncRepo.findEntityByUrl("https://example.com/2", "conn-1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("e2");
    });

    it("does not match different connectionId", async () => {
      createConnection(db, { id: "conn-1" });
      createEntity(db, { id: "e3", url: "https://example.com/3", connectionId: "conn-1" });
      const result = await syncRepo.findEntityByUrl("https://example.com/3", "conn-other");
      expect(result).toBeNull();
    });
  });

  describe("upsertEntity", () => {
    it("inserts a new entity", async () => {
      const input = makeEntityInput({ url: "https://test.com/new" });
      const result = await syncRepo.upsertEntity(input);
      expect(result.status).toBe("inserted");
      expect(result.entityId).toBeDefined();

      const rows = db.select().from(entities).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe("Test Entity");
    });

    it("updates an existing entity by url", async () => {
      const url = "https://test.com/existing";
      createEntity(db, { id: "existing-1", url, title: "Old Title" });

      const input = makeEntityInput({ url, title: "New Title" });
      const result = await syncRepo.upsertEntity(input);
      expect(result.status).toBe("updated");
      expect(result.entityId).toBe("existing-1");

      const row = db.select().from(entities).where(eq(entities.id, "existing-1")).get();
      expect(row!.title).toBe("New Title");
    });

    it("creates issue record for issue-kind entities", async () => {
      const input = makeEntityInput({
        kind: "issue",
        url: "https://github.com/test/1",
        metadata: {
          provider: "github",
          state: "open",
          number: 42,
          repo: "test/repo",
          assignee: "user1",
          labels: ["bug", "high"],
        },
      });
      const result = await syncRepo.upsertEntity(input);
      expect(result.status).toBe("inserted");

      const issueRows = db.select().from(issues).all();
      expect(issueRows).toHaveLength(1);
      expect(issueRows[0].provider).toBe("github");
      expect(issueRows[0].state).toBe("open");
      expect(issueRows[0].number).toBe(42);
    });

    it("handles metadata as JSON string", async () => {
      const input = makeEntityInput({
        metadata: { key: "value" },
      });
      const result = await syncRepo.upsertEntity(input);
      expect(result.status).toBe("inserted");

      const row = db.select().from(entities).where(eq(entities.id, result.entityId!)).get();
      expect(row!.metadata).toBe(JSON.stringify({ key: "value" }));
    });

    it("handles entity with connectionId", async () => {
      createConnection(db, { id: "conn-sync" });
      const input = makeEntityInput({ connectionId: "conn-sync" });
      const result = await syncRepo.upsertEntity(input);
      expect(result.status).toBe("inserted");

      const row = db.select().from(entities).where(eq(entities.id, result.entityId!)).get();
      expect(row!.connectionId).toBe("conn-sync");
    });
  });

  describe("upsertIssue", () => {
    it("inserts a new issue record", async () => {
      createEntity(db, { id: "ent-issue-1", kind: "issue" });
      await syncRepo.upsertIssue("ent-issue-1", {
        provider: "linear",
        state: "closed",
        number: 10,
        repo: "team/proj",
        assignee: "alice",
        labels: ["feature"],
        closedAt: "2025-06-01T00:00:00Z",
        priority: 3,
      });

      const row = db.select().from(issues).where(eq(issues.entityId, "ent-issue-1")).get();
      expect(row).toBeDefined();
      expect(row!.provider).toBe("linear");
      expect(row!.state).toBe("closed");
      expect(row!.number).toBe(10);
      expect(row!.priority).toBe(3);
      expect(row!.labels).toBe(JSON.stringify(["feature"]));
    });

    it("updates an existing issue record", async () => {
      createEntity(db, { id: "ent-issue-2", kind: "issue" });
      db.insert(issues).values({
        entityId: "ent-issue-2",
        provider: "github",
        state: "open",
      }).run();

      await syncRepo.upsertIssue("ent-issue-2", {
        provider: "github",
        state: "closed",
        closedAt: "2025-06-01T00:00:00Z",
      });

      const row = db.select().from(issues).where(eq(issues.entityId, "ent-issue-2")).get();
      expect(row!.state).toBe("closed");
    });

    it("handles Date object for closedAt", async () => {
      createEntity(db, { id: "ent-issue-3", kind: "issue" });
      const closedDate = new Date("2025-07-15T10:00:00Z");
      await syncRepo.upsertIssue("ent-issue-3", { closedAt: closedDate });

      const row = db.select().from(issues).where(eq(issues.entityId, "ent-issue-3")).get();
      expect(row!.closedAt).toBeInstanceOf(Date);
    });

    it("handles completedAt as alternative to closedAt", async () => {
      createEntity(db, { id: "ent-issue-4", kind: "issue" });
      await syncRepo.upsertIssue("ent-issue-4", { completedAt: "2025-08-01T00:00:00Z" });

      const row = db.select().from(issues).where(eq(issues.entityId, "ent-issue-4")).get();
      expect(row!.closedAt).toBeInstanceOf(Date);
    });

    it("defaults provider to unknown and state to open", async () => {
      createEntity(db, { id: "ent-issue-5", kind: "issue" });
      await syncRepo.upsertIssue("ent-issue-5", {});

      const row = db.select().from(issues).where(eq(issues.entityId, "ent-issue-5")).get();
      expect(row!.provider).toBe("unknown");
      expect(row!.state).toBe("open");
    });
  });

  describe("upsertEntities (batch/sync)", () => {
    it("returns stats for batch insert", () => {
      const items = [
        makeEntityInput({ url: "https://batch.com/1" }),
        makeEntityInput({ url: "https://batch.com/2" }),
        makeEntityInput({ url: "https://batch.com/3" }),
      ];
      const stats = syncRepo.upsertEntities(items);
      expect(stats.inserted).toBe(3);
      expect(stats.updated).toBe(0);
      expect(stats.errors).toBe(0);
    });

    it("updates existing entities in batch", () => {
      createEntity(db, { id: "batch-e1", url: "https://batch.com/existing" });
      const items = [
        makeEntityInput({ url: "https://batch.com/existing", title: "Updated" }),
        makeEntityInput({ url: "https://batch.com/new" }),
      ];
      const stats = syncRepo.upsertEntities(items);
      expect(stats.inserted).toBe(1);
      expect(stats.updated).toBe(1);
    });
  });

  describe("upsertEntitySync", () => {
    it("inserts a new entity synchronously", () => {
      const input = makeEntityInput({ url: "https://sync.com/1" });
      const result = syncRepo.upsertEntitySync(input);
      expect(result.status).toBe("inserted");
      expect(result.entityId).toBeDefined();
    });

    it("updates an existing entity synchronously", () => {
      createEntity(db, { id: "sync-e1", url: "https://sync.com/existing" });
      const input = makeEntityInput({ url: "https://sync.com/existing", title: "Updated" });
      const result = syncRepo.upsertEntitySync(input);
      expect(result.status).toBe("updated");
      expect(result.entityId).toBe("sync-e1");
    });

    it("creates issue record for issue kind (sync)", () => {
      const input = makeEntityInput({
        kind: "issue",
        url: "https://sync.com/issue",
        metadata: { provider: "jira", state: "open", number: 100 },
      });
      const result = syncRepo.upsertEntitySync(input);
      expect(result.status).toBe("inserted");

      const issueRows = db.select().from(issues).all();
      expect(issueRows).toHaveLength(1);
      expect(issueRows[0].provider).toBe("jira");
    });
  });

  describe("upsertIssueSync", () => {
    it("inserts a new issue record synchronously", () => {
      createEntity(db, { id: "sync-issue-1", kind: "issue" });
      syncRepo.upsertIssueSync("sync-issue-1", {
        provider: "github",
        state: "open",
        number: 5,
      });

      const row = db.select().from(issues).where(eq(issues.entityId, "sync-issue-1")).get();
      expect(row).toBeDefined();
      expect(row!.number).toBe(5);
    });

    it("updates an existing issue record synchronously", () => {
      createEntity(db, { id: "sync-issue-2", kind: "issue" });
      db.insert(issues).values({ entityId: "sync-issue-2", provider: "github", state: "open" }).run();

      syncRepo.upsertIssueSync("sync-issue-2", { state: "closed" });
      const row = db.select().from(issues).where(eq(issues.entityId, "sync-issue-2")).get();
      expect(row!.state).toBe("closed");
    });
  });
});
