import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import {
  createConnection,
  createConnectionResource,
  createConnectionState,
} from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type Database from "better-sqlite3";

let db: DatabaseInstance;
let _sqlite: Database.Database;
let cleanup: () => void;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

import { connectionsRepo } from "./connections.repo";

describe("connectionsRepo", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
  });

  afterEach(() => {
    cleanup();
  });

  // ─────────────────────────────────────────────────────────────
  // Connection queries
  // ─────────────────────────────────────────────────────────────
  describe("findById", () => {
    it("returns undefined when not found", async () => {
      const result = await connectionsRepo.findById("nonexistent");
      expect(result).toBeUndefined();
    });

    it("returns connection when found", async () => {
      createConnection(db, { id: "c1", provider: "github" });

      const result = await connectionsRepo.findById("c1");
      expect(result).toBeDefined();
      expect(result!.id).toBe("c1");
      expect(result!.provider).toBe("github");
    });
  });

  describe("findByProvider", () => {
    it("returns undefined when no match", async () => {
      const result = await connectionsRepo.findByProvider("github");
      expect(result).toBeUndefined();
    });

    it("returns connection for provider", async () => {
      createConnection(db, { id: "c1", provider: "github" });

      const result = await connectionsRepo.findByProvider("github");
      expect(result).toBeDefined();
      expect(result!.provider).toBe("github");
    });
  });

  describe("updateStatus", () => {
    it("updates connection status and metadata", async () => {
      createConnection(db, { id: "c1", provider: "github", status: "active" });

      await connectionsRepo.updateStatus("c1", "revoked", '{"reason":"user"}');

      const result = await connectionsRepo.findById("c1");
      expect(result!.status).toBe("revoked");
      expect(result!.metadata).toBe('{"reason":"user"}');
    });
  });

  describe("insert", () => {
    it("inserts and returns connection", async () => {
      const result = await connectionsRepo.insert({
        id: "c1",
        provider: "linear",
        type: "api_key",
        status: "active",
        metadata: "{}",
      });

      expect(result).toBeDefined();
      expect(result.id).toBe("c1");
      expect(result.provider).toBe("linear");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Token queries
  // ─────────────────────────────────────────────────────────────
  describe("findCurrentToken", () => {
    it("returns undefined when no tokens", async () => {
      createConnection(db, { id: "c1" });

      const result = await connectionsRepo.findCurrentToken("c1");
      expect(result).toBeUndefined();
    });

    it("returns current token", async () => {
      createConnection(db, { id: "c1" });
      _sqlite.exec(`
        INSERT INTO connection_tokens (connection_id, access_token_enc, is_current)
        VALUES ('c1', X'deadbeef', 1)
      `);

      const result = await connectionsRepo.findCurrentToken("c1");
      expect(result).toBeDefined();
      expect(result!.isCurrent).toBe(true);
    });
  });

  describe("markTokensNotCurrent", () => {
    it("marks all tokens as not current", async () => {
      createConnection(db, { id: "c1" });
      _sqlite.exec(`
        INSERT INTO connection_tokens (connection_id, access_token_enc, is_current)
        VALUES ('c1', X'deadbeef', 1)
      `);

      await connectionsRepo.markTokensNotCurrent("c1");

      const result = await connectionsRepo.findCurrentToken("c1");
      expect(result).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Resource queries
  // ─────────────────────────────────────────────────────────────
  describe("findResourcesByConnectionId", () => {
    it("returns empty array when none", async () => {
      const result = await connectionsRepo.findResourcesByConnectionId("c1");
      expect(result).toEqual([]);
    });

    it("returns resources for connection", async () => {
      createConnection(db, { id: "c1" });
      createConnectionResource(db, { connectionId: "c1", externalId: "repo1", kind: "github_repo", name: "test/repo" });
      createConnectionResource(db, { connectionId: "c1", externalId: "repo2", kind: "github_repo", name: "test/repo2" });

      const result = await connectionsRepo.findResourcesByConnectionId("c1");
      expect(result).toHaveLength(2);
    });
  });

  describe("findResourcesByConnectionAndKind", () => {
    it("filters by kind", async () => {
      createConnection(db, { id: "c1" });
      createConnectionResource(db, { connectionId: "c1", externalId: "repo1", kind: "github_repo", name: "repo" });
      createConnectionResource(db, { connectionId: "c1", externalId: "team1", kind: "linear_team", name: "team" });

      const result = await connectionsRepo.findResourcesByConnectionAndKind("c1", "github_repo");
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe("github_repo");
    });

    it("filters by selected", async () => {
      createConnection(db, { id: "c1" });
      createConnectionResource(db, { connectionId: "c1", externalId: "r1", kind: "github_repo", name: "r1", selected: true });
      createConnectionResource(db, { connectionId: "c1", externalId: "r2", kind: "github_repo", name: "r2", selected: false });

      const result = await connectionsRepo.findResourcesByConnectionAndKind("c1", "github_repo", true);
      expect(result).toHaveLength(1);
      expect(result[0].externalId).toBe("r1");
    });
  });

  describe("findSelectedResourcesByConnection", () => {
    it("returns only selected resources", async () => {
      createConnection(db, { id: "c1" });
      createConnectionResource(db, { connectionId: "c1", externalId: "r1", kind: "github_repo", name: "r1", selected: true });
      createConnectionResource(db, { connectionId: "c1", externalId: "r2", kind: "github_repo", name: "r2", selected: false });

      const result = await connectionsRepo.findSelectedResourcesByConnection("c1");
      expect(result).toHaveLength(1);
      expect(result[0].selected).toBe(true);
    });
  });

  describe("findResourceByExternalId", () => {
    it("returns undefined when not found", async () => {
      const result = await connectionsRepo.findResourceByExternalId("c1", "nope");
      expect(result).toBeUndefined();
    });

    it("returns resource by externalId", async () => {
      createConnection(db, { id: "c1" });
      createConnectionResource(db, { connectionId: "c1", externalId: "repo1", kind: "github_repo", name: "test/repo" });

      const result = await connectionsRepo.findResourceByExternalId("c1", "repo1");
      expect(result).toBeDefined();
      expect(result!.externalId).toBe("repo1");
    });
  });

  describe("insertResource", () => {
    it("inserts a resource", async () => {
      createConnection(db, { id: "c1" });

      await connectionsRepo.insertResource({
        id: "res1",
        connectionId: "c1",
        externalId: "ext1",
        kind: "github_repo",
        name: "test/repo",
        selected: true,
        metadata: null,
        lastSeenAt: new Date(),
      });

      const result = await connectionsRepo.findResourcesByConnectionId("c1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("res1");
    });
  });

  describe("insertResources", () => {
    it("inserts multiple resources", async () => {
      createConnection(db, { id: "c1" });

      await connectionsRepo.insertResources([
        { id: "res1", connectionId: "c1", externalId: "e1", kind: "github_repo", name: "r1", selected: true, metadata: null, lastSeenAt: new Date() },
        { id: "res2", connectionId: "c1", externalId: "e2", kind: "github_repo", name: "r2", selected: false, metadata: null, lastSeenAt: new Date() },
      ]);

      const result = await connectionsRepo.findResourcesByConnectionId("c1");
      expect(result).toHaveLength(2);
    });

    it("no-ops on empty array", async () => {
      await connectionsRepo.insertResources([]);
      // Should not throw
    });
  });

  describe("updateResource", () => {
    it("updates resource fields", async () => {
      createConnection(db, { id: "c1" });
      createConnectionResource(db, { id: "res1", connectionId: "c1", externalId: "e1", kind: "github_repo", name: "old", selected: false });

      await connectionsRepo.updateResource("res1", { selected: true, name: "new-name" });

      const result = await connectionsRepo.findResourceByExternalId("c1", "e1");
      expect(result!.selected).toBe(true);
      expect(result!.name).toBe("new-name");
    });
  });

  describe("deleteResource", () => {
    it("deletes resource and returns deleted rows", async () => {
      createConnection(db, { id: "c1" });
      createConnectionResource(db, { id: "res1", connectionId: "c1", externalId: "e1", kind: "github_repo", name: "r1" });

      const result = await connectionsRepo.deleteResource("res1");
      expect(result).toHaveLength(1);

      const check = await connectionsRepo.findResourcesByConnectionId("c1");
      expect(check).toHaveLength(0);
    });
  });

  describe("deleteResourcesByConnectionId", () => {
    it("deletes all resources for connection", async () => {
      createConnection(db, { id: "c1" });
      createConnectionResource(db, { connectionId: "c1", externalId: "e1", kind: "github_repo", name: "r1" });
      createConnectionResource(db, { connectionId: "c1", externalId: "e2", kind: "github_repo", name: "r2" });

      await connectionsRepo.deleteResourcesByConnectionId("c1");

      const result = await connectionsRepo.findResourcesByConnectionId("c1");
      expect(result).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Connection State queries
  // ─────────────────────────────────────────────────────────────
  describe("findConnectionState", () => {
    it("returns undefined when not found", async () => {
      const result = await connectionsRepo.findConnectionState("nonexistent");
      expect(result).toBeUndefined();
    });

    it("returns connection states", async () => {
      createConnectionState(db, { id: "github", isConnected: true });

      const result = await connectionsRepo.findConnectionState("github");
      expect(result).toBeDefined();
      expect(result!.isConnected).toBe(true);
    });
  });

  describe("updateConnectionStates", () => {
    it("updates connection state", async () => {
      createConnection(db, { id: "c1", provider: "github" });
      createConnectionState(db, { id: "github", isConnected: true, connectionId: "c1" });

      await connectionsRepo.updateConnectionState("github", false, null);

      const result = await connectionsRepo.findConnectionState("github");
      expect(result!.isConnected).toBe(false);
      expect(result!.connectionId).toBeNull();
    });
  });

  describe("upsertConnectionState", () => {
    it("inserts when not existing", async () => {
      createConnection(db, { id: "c2", provider: "linear" });

      await connectionsRepo.upsertConnectionState("linear", true, "c2");

      const result = await connectionsRepo.findConnectionState("linear");
      expect(result).toBeDefined();
      expect(result!.isConnected).toBe(true);
      expect(result!.connectionId).toBe("c2");
    });

    it("updates when already existing", async () => {
      createConnection(db, { id: "c1", provider: "github" });
      createConnectionState(db, { id: "github", isConnected: false });

      await connectionsRepo.updateConnectionState("github", true, "c1");

      const result = await connectionsRepo.findConnectionState("github");
      expect(result!.isConnected).toBe(true);
      expect(result!.connectionId).toBe("c1");
    });
  });
});
