import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createAccount, createProject, createWorkspace } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";

let db: DatabaseInstance;
let cleanup: () => void;

vi.mock("../../db/client", () => ({ getDb: () => db }));

import { workspaceRepo } from "./workspace.repo";
import { workspaceService } from "./workspace.service";

describe("workspace sidebar organization", () => {
  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    createAccount(db, { id: "default" });
    createProject(db, { id: "project", accountId: "default" });
    createWorkspace(db, { id: "first", projectId: "project", sortOrder: 0 });
    createWorkspace(db, { id: "second", projectId: "project", sortOrder: 1 });
  });

  afterEach(() => cleanup());

  it("persists manual order and appends a newly created workspace", async () => {
    await workspaceService.reorder({
      accountId: "default",
      orderedIds: ["second", "first"],
    });
    expect((await workspaceRepo.findById("second"))?.sortOrder).toBe(0);
    expect((await workspaceRepo.findById("first"))?.sortOrder).toBe(1);

    await workspaceRepo.insert({
      id: "third",
      accountId: "default",
      projectId: "project",
      name: "Third",
      rootPath: "/tmp/third",
    });
    expect((await workspaceRepo.findById("third"))?.sortOrder).toBe(2);
  });

  it("pins without changing the original order and restores it on unpin", async () => {
    const pinned = await workspaceService.setPinned({
      id: "second", accountId: "default", pinned: true,
    });
    expect(pinned.pinnedAt).toBeInstanceOf(Date);
    expect(pinned.sortOrder).toBe(1);

    const unpinned = await workspaceService.setPinned({
      id: "second", accountId: "default", pinned: false,
    });
    expect(unpinned.pinnedAt).toBeNull();
    expect(unpinned.sortOrder).toBe(1);
  });

  it("rejects incomplete, duplicate, and cross-account changes", async () => {
    createAccount(db, { id: "other" });
    createProject(db, { id: "other-project", accountId: "other" });
    createWorkspace(db, {
      id: "other-workspace", accountId: "other", projectId: "other-project",
    });

    await expect(workspaceService.reorder({
      accountId: "default", orderedIds: ["first"],
    })).rejects.toThrow("every active workspace");
    await expect(workspaceService.reorder({
      accountId: "default", orderedIds: ["first", "first"],
    })).rejects.toThrow("Invalid workspace order");
    await expect(workspaceService.reorder({
      accountId: "default", orderedIds: ["first", "other-workspace"],
    })).rejects.toThrow("every active workspace");
    await expect(workspaceService.setPinned({
      id: "other-workspace", accountId: "default", pinned: true,
    })).rejects.toThrow("does not belong to this account");
  });
});
