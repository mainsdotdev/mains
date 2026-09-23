import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import {
  createAccount,
  createConnection,
  createConnectionResource,
  createProject,
  createProjectResource,
} from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type Database from "better-sqlite3";

let db: DatabaseInstance;
let _sqlite: Database.Database;
let cleanup: () => void;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

import { projectsRepo } from "./projects.repo";

describe("projectsRepo", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
    createAccount(db, { id: "default" });
  });

  afterEach(() => {
    cleanup();
  });

  describe("findAll", () => {
    it("returns empty array when no projects exist", async () => {
      const result = await projectsRepo.findAll();
      expect(result).toEqual([]);
    });

    it("returns only non-archived projects by default", async () => {
      createProject(db, { id: "p1", name: "Active", isArchived: false });
      createProject(db, { id: "p2", name: "Archived", isArchived: true });

      const result = await projectsRepo.findAll();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Active");
    });

    it("includes archived when flag is true", async () => {
      createProject(db, { id: "p1", isArchived: false });
      createProject(db, { id: "p2", isArchived: true });

      const result = await projectsRepo.findAll(true);
      expect(result).toHaveLength(2);
    });
  });

  describe("findById", () => {
    it("returns null for non-existent id", async () => {
      const result = await projectsRepo.findById("nope");
      expect(result).toBeNull();
    });

    it("returns the project with parsed branches JSON", async () => {
      createProject(db, {
        id: "p1",
        name: "My Project",
        branches: JSON.stringify(["main", "dev"]),
      });

      const result = await projectsRepo.findById("p1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("My Project");
      expect(result!.branches).toEqual(["main", "dev"]);
    });
  });

  describe("findByAccountId", () => {
    it("returns projects for the given account", async () => {
      createProject(db, { id: "p1", accountId: "default" });

      const result = await projectsRepo.findByAccountId("default");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("p1");
    });

    it("excludes archived by default", async () => {
      createProject(db, { id: "p1", accountId: "default", isArchived: false });
      createProject(db, { id: "p2", accountId: "default", isArchived: true });

      const result = await projectsRepo.findByAccountId("default");
      expect(result).toHaveLength(1);
    });
  });

  describe("findByRemoteOrigin", () => {
    it("finds project by accountId + remoteOrigin", async () => {
      createProject(db, {
        id: "p1",
        accountId: "default",
        remoteOrigin: "github.com/user/repo",
      });

      const result = await projectsRepo.findByRemoteOrigin("default", "github.com/user/repo");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("p1");
    });

    it("returns null when origin does not match", async () => {
      createProject(db, {
        id: "p1",
        accountId: "default",
        remoteOrigin: "github.com/user/repo",
      });

      const result = await projectsRepo.findByRemoteOrigin("default", "github.com/other/repo");
      expect(result).toBeNull();
    });
  });

  describe("insert", () => {
    it("inserts a project and returns the id", async () => {
      const id = await projectsRepo.insert({
        id: "new-1",
        accountId: "default",
        name: "New Project",
        rootPath: "/tmp/new",
        remoteOrigin: "github.com/test/new",
      });

      expect(id).toBe("new-1");
      const found = await projectsRepo.findById("new-1");
      expect(found).not.toBeNull();
      expect(found!.name).toBe("New Project");
    });

    it("stores branches as JSON string", async () => {
      await projectsRepo.insert({
        id: "branch-1",
        accountId: "default",
        name: "Branch Test",
        rootPath: "/tmp/branch",
        remoteOrigin: "github.com/test/branch",
        branches: ["main", "feature"],
      });

      const found = await projectsRepo.findById("branch-1");
      expect(found!.branches).toEqual(["main", "feature"]);
    });
  });

  describe("update", () => {
    it("updates specified fields", async () => {
      createProject(db, { id: "u1", name: "Old" });

      const result = await projectsRepo.update("u1", { name: "New" });
      expect(result).not.toBeNull();
      expect(result!.name).toBe("New");
    });

    it("returns null when project does not exist", async () => {
      const result = await projectsRepo.update("nonexistent", { name: "X" });
      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("removes the project", async () => {
      createProject(db, { id: "d1" });

      await projectsRepo.delete("d1");
      const result = await projectsRepo.findById("d1");
      expect(result).toBeNull();
    });
  });

  describe("archive", () => {
    it("sets isArchived to true", async () => {
      createProject(db, { id: "a1", isArchived: false });

      const result = await projectsRepo.archive("a1");
      expect(result).not.toBeNull();
      expect(result!.isArchived).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // project_resources (formerly workspaceResources/)
  // ─────────────────────────────────────────────────────────────
  describe("listResourcesByProject", () => {
    it("returns empty array when no resources linked", async () => {
      const project = createProject(db, { id: "proj-1" });
      const result = await projectsRepo.listResourcesByProject(project.id);
      expect(result).toEqual([]);
    });

    it("returns linked resources with details", async () => {
      const project = createProject(db, { id: "proj-1" });
      const conn = createConnection(db, { id: "conn-1" });
      const resource = createConnectionResource(db, {
        id: "res-1",
        connectionId: conn.id,
        externalId: "ext-1",
        kind: "github_repo",
        name: "my-repo",
      });
      createProjectResource(db, {
        projectId: project.id,
        resourceId: resource.id,
      });

      const result = await projectsRepo.listResourcesByProject("proj-1");
      expect(result).toHaveLength(1);
      expect(result[0].resource.name).toBe("my-repo");
      expect(result[0].resource.kind).toBe("github_repo");
    });
  });

  describe("listAvailableResources", () => {
    it("returns resources with isLinked flag", async () => {
      const project = createProject(db, { id: "proj-1" });
      const conn = createConnection(db, { id: "conn-1" });

      const res1 = createConnectionResource(db, {
        id: "res-1",
        connectionId: conn.id,
        kind: "github_repo",
        selected: true,
      });
      createConnectionResource(db, {
        id: "res-2",
        connectionId: conn.id,
        kind: "github_repo",
        selected: true,
      });

      createProjectResource(db, {
        projectId: project.id,
        resourceId: res1.id,
      });

      const result = await projectsRepo.listAvailableResources("proj-1", ["github_repo"]);
      expect(result).toHaveLength(2);

      const linked = result.find((r) => r.id === "res-1");
      const unlinked = result.find((r) => r.id === "res-2");
      expect(linked!.isLinked).toBe(true);
      expect(unlinked!.isLinked).toBe(false);
    });

    it("filters by kind", async () => {
      const conn = createConnection(db, { id: "conn-1" });
      createConnectionResource(db, {
        id: "res-gh",
        connectionId: conn.id,
        kind: "github_repo",
        selected: true,
      });
      createConnectionResource(db, {
        id: "res-lr",
        connectionId: conn.id,
        kind: "linear_team",
        selected: true,
      });

      const result = await projectsRepo.listAvailableResources("proj-1", ["github_repo"]);
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe("github_repo");
    });

    it("excludes non-selected resources", async () => {
      const conn = createConnection(db, { id: "conn-1" });
      createConnectionResource(db, {
        id: "res-sel",
        connectionId: conn.id,
        kind: "github_repo",
        selected: true,
      });
      createConnectionResource(db, {
        id: "res-not",
        connectionId: conn.id,
        kind: "github_repo",
        selected: false,
      });

      const result = await projectsRepo.listAvailableResources("proj-1", ["github_repo"]);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("res-sel");
    });
  });

  describe("addResource", () => {
    it("adds a resource to project", async () => {
      const project = createProject(db, { id: "proj-1" });
      const conn = createConnection(db, { id: "conn-1" });
      const resource = createConnectionResource(db, {
        id: "res-1",
        connectionId: conn.id,
      });

      const result = await projectsRepo.addResource("pr-1", project.id, resource.id);
      expect(result.projectId).toBe("proj-1");
      expect(result.resourceId).toBe("res-1");
    });
  });

  describe("removeResource", () => {
    it("removes a linked resource", async () => {
      const project = createProject(db, { id: "proj-1" });
      const conn = createConnection(db, { id: "conn-1" });
      const resource = createConnectionResource(db, {
        id: "res-1",
        connectionId: conn.id,
      });
      createProjectResource(db, {
        projectId: project.id,
        resourceId: resource.id,
      });

      await projectsRepo.removeResource("proj-1", "res-1");

      const linked = await projectsRepo.isResourceLinked("proj-1", "res-1");
      expect(linked).toBe(false);
    });
  });

  describe("isResourceLinked", () => {
    it("returns true when linked", async () => {
      const project = createProject(db, { id: "proj-1" });
      const conn = createConnection(db, { id: "conn-1" });
      const resource = createConnectionResource(db, {
        id: "res-1",
        connectionId: conn.id,
      });
      createProjectResource(db, {
        projectId: project.id,
        resourceId: resource.id,
      });

      const result = await projectsRepo.isResourceLinked("proj-1", "res-1");
      expect(result).toBe(true);
    });

    it("returns false when not linked", async () => {
      const result = await projectsRepo.isResourceLinked("proj-1", "res-1");
      expect(result).toBe(false);
    });
  });

  describe("listLinkedResourceIds", () => {
    it("returns ids of resources linked to the project", async () => {
      const project = createProject(db, { id: "proj-1" });
      const conn = createConnection(db, { id: "conn-1" });
      const r1 = createConnectionResource(db, { id: "res-1", connectionId: conn.id });
      const r2 = createConnectionResource(db, { id: "res-2", connectionId: conn.id });
      createProjectResource(db, { projectId: project.id, resourceId: r1.id });
      createProjectResource(db, { projectId: project.id, resourceId: r2.id });

      const ids = await projectsRepo.listLinkedResourceIds("proj-1");
      expect(ids.sort()).toEqual(["res-1", "res-2"]);
    });

    it("returns empty array when no resources linked", async () => {
      createProject(db, { id: "proj-1" });
      const ids = await projectsRepo.listLinkedResourceIds("proj-1");
      expect(ids).toEqual([]);
    });
  });
});
