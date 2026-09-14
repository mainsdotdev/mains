import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import {
  createAccount,
  createConnection,
  createConnectionResource,
  createIssue,
  createProject,
  createProjectResource,
  createRun,
  createWorkspace,
} from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type Database from "better-sqlite3";

let db: DatabaseInstance;
let _sqlite: Database.Database;
let cleanup: () => void;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

vi.mock("../git/git.service", () => ({
  gitService: {
    removeWorktree: vi.fn(),
  },
}));

vi.stubGlobal("crypto", {
  ...crypto,
  randomUUID: () => "mock-uuid-1234",
});

import { projectsService } from "./projects.service";
import { projectsRepo } from "./projects.repo";

describe("projectsService", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
    createAccount(db, { id: "default" });
  });

  afterEach(() => {
    cleanup();
  });

  describe("list", () => {
    it("returns empty list when no projects exist", async () => {
      const result = await projectsService.list();
      expect(result).toEqual([]);
    });

    it("returns all non-archived projects", async () => {
      createProject(db, { id: "p1", name: "Project A" });
      createProject(db, { id: "p2", name: "Project B" });

      const result = await projectsService.list();
      expect(result).toHaveLength(2);
    });
  });

  describe("get", () => {
    it("returns the project when found", async () => {
      createProject(db, { id: "p1", name: "Found" });

      const result = (await projectsService.get("p1"))!;
      expect(result.name).toBe("Found");
    });

    it("returns error when not found", async () => {
      expect(await projectsService.get("nonexistent")).toBeNull();
    });
  });

  describe("listByAccount", () => {
    it("returns projects for the account", async () => {
      createProject(db, { id: "p1", accountId: "default" });

      const result = await projectsService.listByAccount("default");
      expect(result).toHaveLength(1);
    });
  });

  describe("findByRemoteOrigin", () => {
    it("finds project by normalized origin", async () => {
      createProject(db, {
        id: "p1",
        accountId: "default",
        remoteOrigin: "github.com/user/repo",
      });

      const result = (await projectsService.findByRemoteOrigin(
        "default",
        "https://github.com/user/repo.git",
      ))!;
      expect(result.id).toBe("p1");
    });

    it("returns error when not found", async () => {
      expect(
        await projectsService.findByRemoteOrigin("default", "github.com/nope/nope"),
      ).toBeNull();
    });
  });

  describe("findOrCreate", () => {
    it("creates a new project if none exists", async () => {
      const result = await projectsService.findOrCreate({
        accountId: "default",
        name: "New",
        rootPath: "/tmp/new",
        remoteOrigin: "https://github.com/test/new.git",
      });
      expect(result.name).toBe("New");
      expect(result.remoteOrigin).toBe("github.com/test/new");
    });

    it("returns existing project if same origin exists", async () => {
      createProject(db, {
        id: "existing",
        accountId: "default",
        name: "Existing",
        remoteOrigin: "github.com/test/dup",
      });

      const result = await projectsService.findOrCreate({
        accountId: "default",
        name: "Duplicate",
        rootPath: "/tmp/dup",
        remoteOrigin: "https://github.com/test/dup.git",
      });
      expect(result.id).toBe("existing");
      expect(result.name).toBe("Existing");
    });
  });

  describe("create", () => {
    it("creates a project successfully", async () => {
      const result = await projectsService.create({
        accountId: "default",
        name: "Created",
        rootPath: "/tmp/created",
        remoteOrigin: "https://github.com/test/created.git",
      });
      expect(result.name).toBe("Created");
    });

    it("rejects duplicate remote origin", async () => {
      createProject(db, {
        accountId: "default",
        remoteOrigin: "github.com/test/unique",
      });

      await expect(
        projectsService.create({
          accountId: "default",
          name: "Dup",
          rootPath: "/tmp/dup",
          remoteOrigin: "https://github.com/test/unique.git",
        }),
      ).rejects.toThrow("Project with this remote origin already exists");
    });
  });

  describe("update", () => {
    it("updates project fields", async () => {
      createProject(db, { id: "u1", name: "Old" });

      const result = await projectsService.update("u1", { name: "New" });
      expect(result.name).toBe("New");
    });
  });

  describe("delete", () => {
    it("uses the same deep lifecycle as remove", async () => {
      createProject(db, { id: "d1", rootPath: "/tmp/project-delete" });
      createWorkspace(db, { id: "delete-ws", projectId: "d1" });
      createRun(db, { id: "delete-run", workspaceId: "delete-ws" });

      await projectsService.delete("d1");

      expect(await projectsService.get("d1")).toBeNull();
      expect(
        _sqlite.prepare("SELECT id FROM workspaces WHERE id = 'delete-ws'").get(),
      ).toBeUndefined();
      expect(
        _sqlite.prepare("SELECT id FROM runs WHERE id = 'delete-run'").get(),
      ).toBeUndefined();
    });
  });

  describe("archive", () => {
    it("archives a project", async () => {
      createProject(db, { id: "a1" });

      const result = await projectsService.archive("a1");
      expect(result.isArchived).toBe(true);
    });

    it("returns error when project not found", async () => {
      await expect(projectsService.archive("nonexistent")).rejects.toThrow();
    });
  });

  describe("remove", () => {
    it("returns error when project not found", async () => {
      await expect(projectsService.remove("nonexistent")).rejects.toThrow("Project not found");
    });

    it("removes project and associated workspaces/runs", async () => {
      createProject(db, { id: "p1", rootPath: "/tmp/project1" });
      createWorkspace(db, { id: "ws1", projectId: "p1", rootPath: "/tmp/ws1" });
      createRun(db, { id: "r1", workspaceId: "ws1" });

      await projectsService.remove("p1");

      expect(await projectsService.get("p1")).toBeNull();
      expect(
        _sqlite.prepare("SELECT id FROM workspaces WHERE id = 'ws1'").get(),
      ).toBeUndefined();
      expect(
        _sqlite.prepare("SELECT id FROM runs WHERE id = 'r1'").get(),
      ).toBeUndefined();
    });
  });

  describe("update - edge cases", () => {
    it("returns error when project not found", async () => {
      await expect(projectsService.update("nonexistent", { name: "X" })).rejects.toThrow("Project not found");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Project resources (formerly workspaceResources/)
  // ─────────────────────────────────────────────────────────────
  describe("listResources", () => {
    it("returns resources linked to the project", async () => {
      const project = createProject(db, { id: "proj-1" });
      const conn = createConnection(db, { id: "conn-1" });
      const resource = createConnectionResource(db, {
        id: "res-1",
        connectionId: conn.id,
        name: "my-repo",
      });
      createProjectResource(db, {
        projectId: project.id,
        resourceId: resource.id,
      });

      const result = await projectsService.listResources("proj-1");
      expect(result.resources).toHaveLength(1);
    });

    it("returns error when projectId is empty", async () => {
      await expect(projectsService.listResources("")).rejects.toThrow("projectId is required");
    });
  });

  describe("listAvailableResources", () => {
    it("returns linkable resources", async () => {
      createProject(db, { id: "proj-1" });
      const conn = createConnection(db, { id: "conn-1" });
      createConnectionResource(db, {
        id: "res-1",
        connectionId: conn.id,
        kind: "github_repo",
        selected: true,
      });

      const result = await projectsService.listAvailableResources("proj-1");
      expect(result.resources).toHaveLength(1);
    });

    it("returns error when projectId is empty", async () => {
      await expect(projectsService.listAvailableResources("")).rejects.toThrow();
    });
  });

  describe("addResource", () => {
    it("adds resource to project", async () => {
      createProject(db, { id: "proj-1" });
      const conn = createConnection(db, { id: "conn-1" });
      createConnectionResource(db, { id: "res-1", connectionId: conn.id });

      const result = await projectsService.addResource("proj-1", "res-1");
      expect(result.resource.projectId).toBe("proj-1");
    });

    it("rejects duplicate link", async () => {
      const project = createProject(db, { id: "proj-1" });
      const conn = createConnection(db, { id: "conn-1" });
      createConnectionResource(db, { id: "res-1", connectionId: conn.id });
      createProjectResource(db, {
        projectId: project.id,
        resourceId: "res-1",
      });

      await expect(projectsService.addResource("proj-1", "res-1")).rejects.toThrow("Resource is already linked to this project");
    });

    it("returns error when projectId is empty", async () => {
      await expect(projectsService.addResource("", "res-1")).rejects.toThrow();
    });

    it("returns error when resourceId is empty", async () => {
      await expect(projectsService.addResource("proj-1", "")).rejects.toThrow();
    });
  });

  describe("removeResource", () => {
    it("removes resource from project", async () => {
      const project = createProject(db, { id: "proj-1" });
      const conn = createConnection(db, { id: "conn-1" });
      createConnectionResource(db, { id: "res-1", connectionId: conn.id });
      createProjectResource(db, { projectId: project.id, resourceId: "res-1" });

      await projectsService.removeResource("proj-1", "res-1");
    });

    it("returns error when params are empty", async () => {
      await expect(projectsService.removeResource("", "")).rejects.toThrow();
    });
  });

  describe("listIssues", () => {
    it("returns error when projectId is empty", async () => {
      await expect(projectsService.listIssues("")).rejects.toThrow();
    });

    it("returns empty issues when no linked resources", async () => {
      createProject(db, { id: "proj-1" });
      const result = await projectsService.listIssues("proj-1");
      expect(result.issues).toEqual([]);
    });

    it("orchestrates: linked resourceIds → entities barrel → serialized rows", async () => {
      createProject(db, { id: "proj-1" });
      const conn = createConnection(db, { id: "conn-1" });
      const resource = createConnectionResource(db, {
        id: "res-1",
        connectionId: conn.id,
        kind: "github_repo",
      });
      createProjectResource(db, { projectId: "proj-1", resourceId: resource.id });

      createIssue(db, {
        entity: {
          accountId: "default",
          resourceId: resource.id,
          kind: "issue",
          title: "Bug",
        },
        issue: { provider: "github", state: "open" },
      });

      const result = await projectsService.listIssues("proj-1");
      expect(result.issues).toHaveLength(1);
      const first = result.issues[0] as { entity: { title: string } };
      expect(first.entity.title).toBe("Bug");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Error paths
  // ─────────────────────────────────────────────────────────────
  describe("error handling", () => {
    it("list returns error on failure", async () => {
      vi.spyOn(projectsRepo, "findAll").mockRejectedValueOnce(new Error("db"));
      await expect(projectsService.list()).rejects.toThrow("db");
    });

    it("get returns error on failure", async () => {
      vi.spyOn(projectsRepo, "findById").mockRejectedValueOnce(new Error("db"));
      await expect(projectsService.get("p1")).rejects.toThrow("db");
    });

    it("listByAccount returns error on failure", async () => {
      vi.spyOn(projectsRepo, "findByAccountId").mockRejectedValueOnce(new Error("db"));
      await expect(projectsService.listByAccount("default")).rejects.toThrow("db");
    });

    it("findByRemoteOrigin returns error on failure", async () => {
      vi.spyOn(projectsRepo, "findByRemoteOrigin").mockRejectedValueOnce(new Error("db"));
      await expect(projectsService.findByRemoteOrigin("default", "github.com/x/y")).rejects.toThrow("db");
    });

    it("create returns error on failure", async () => {
      vi.spyOn(projectsRepo, "findByRemoteOrigin").mockResolvedValueOnce(null);
      vi.spyOn(projectsRepo, "insert").mockRejectedValueOnce(new Error("db"));
      await expect(projectsService.create({ accountId: "default", name: "Fail", rootPath: "/fail", remoteOrigin: "github.com/fail/fail", })).rejects.toThrow("db");
    });

    it("delete returns error on failure", async () => {
      createProject(db, { id: "p1" });
      vi.spyOn(projectsRepo, "delete").mockRejectedValueOnce(new Error("db"));
      await expect(projectsService.delete("p1")).rejects.toThrow("db");
    });

    it("archive returns error on failure", async () => {
      vi.spyOn(projectsRepo, "archive").mockRejectedValueOnce(new Error("db"));
      await expect(projectsService.archive("p1")).rejects.toThrow("db");
    });

    it("listResources returns error on failure", async () => {
      vi.spyOn(projectsRepo, "listResourcesByProject").mockRejectedValueOnce(new Error("db"));
      await expect(projectsService.listResources("p1")).rejects.toThrow("db");
    });

    it("listAvailableResources returns error on failure", async () => {
      vi.spyOn(projectsRepo, "listAvailableResources").mockRejectedValueOnce(new Error("db"));
      await expect(projectsService.listAvailableResources("p1")).rejects.toThrow("db");
    });

    it("addResource returns error on failure", async () => {
      vi.spyOn(projectsRepo, "isResourceLinked").mockRejectedValueOnce(new Error("db"));
      await expect(projectsService.addResource("p1", "r1")).rejects.toThrow("db");
    });

    it("removeResource returns error on failure", async () => {
      vi.spyOn(projectsRepo, "removeResource").mockRejectedValueOnce(new Error("db"));
      await expect(projectsService.removeResource("p1", "r1")).rejects.toThrow("db");
    });

    it("listIssues returns error on failure", async () => {
      vi.spyOn(projectsRepo, "listLinkedResourceIds").mockRejectedValueOnce(new Error("db"));
      await expect(projectsService.listIssues("p1")).rejects.toThrow("db");
    });
  });
});
