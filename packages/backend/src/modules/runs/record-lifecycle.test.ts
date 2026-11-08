import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestDb } from "../../../test/setup-db";
import { createAccount, createCollection, createProject, createRun, createWorkspace } from "../../../test/factories";
import { installTestBackendRuntime } from "../../../test/backend-runtime";
import type { DatabaseInstance } from "../../db/types";

let db: DatabaseInstance, cleanup: () => void, restore: () => void, root: string;
vi.mock("../../db/client", () => ({ getDb: () => db }));
const native = vi.hoisted(() => ({ adapter: {} as Record<string, unknown>, execFile: vi.fn() }));
vi.mock("child_process", async (original) => ({ ...await original<typeof import("child_process")>(), execFile: native.execFile }));
vi.mock("../providers/adapters", () => ({ createWorkAdapter: () => native.adapter }));
import { runsService } from "./runs.service";
import { runsRepo } from "./runs.repo";
import { managedRunDir, managedRunImageDir } from "./run-execution";
import { collectionsService } from "../collections";
import { collectionsRepo } from "../collections/collections.repo";
import { projectsService } from "../projects";
import { gitService } from "../git";
import { workspaceService } from "../workspace";
import { workspaceRepo } from "../workspace/workspace.repo";
import { runSessionRegistry } from "./run-session-registry";
import type { RunSession } from "./run-session";
import { claimRunResponse } from "./run-lifecycle";
import { openRecordLifecycles, shutdownRecordLifecycles } from "../../runtime/record-lifecycle";

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  openRecordLifecycles();
  ({ db, cleanup } = createTestDb());
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mains-record-lifecycle-"));
  restore = installTestBackendRuntime({ getPath: (name) => path.join(root, name) });
  createAccount(db, { id: "default" }); native.adapter = {};
});
afterEach(async () => { for (const session of [...runSessionRegistry.active()]) runSessionRegistry.unregister(session.runId); await shutdownRecordLifecycles(); vi.restoreAllMocks(); restore(); cleanup(); fs.rmSync(root, { recursive: true, force: true }); });

describe("record retirement through domain services", () => {
  it("orders restore after an accepted archive and coalesces duplicate archives", async () => {
    createWorkspace(db, { id: "workspace" });
    createRun(db, { id: "run", workspaceId: "workspace", providerId: "codex", sessionId: "thread", status: "succeeded" });
    const gate = deferred(), entered = deferred();
    const archiveSession = vi.fn(async () => { entered.resolve(); await gate.promise; });
    const unarchiveSession = vi.fn(); native.adapter = { archiveSession, unarchiveSession };
    const archive = runsService.archiveRun("run"); await entered.promise;
    const duplicate = runsService.archiveRun("run"), restore = runsService.unarchiveRun("run");
    await new Promise<void>((resolve) => setImmediate(resolve));
    try { expect(archiveSession).toHaveBeenCalledTimes(1); expect(unarchiveSession).not.toHaveBeenCalled(); }
    finally { gate.resolve(); await Promise.all([archive, duplicate, restore]); }
    expect((await runsService.getRunById("run"))?.isArchived).toBe(false);
  });

  it("keeps managed outputs when deleting the database row fails", async () => {
    createRun(db, { id: "preserved", mode: "chat", status: "succeeded" });
    const directory = managedRunDir("preserved", "chat"), images = managedRunImageDir("preserved");
    for (const location of [directory, images]) { fs.mkdirSync(location, { recursive: true }); fs.writeFileSync(path.join(location, "keep.txt"), "User output"); }
    vi.spyOn(runsRepo, "deleteRun").mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(runsService.deleteRun("preserved")).rejects.toThrow("Database unavailable");
    expect(await runsService.getRunById("preserved")).not.toBeNull();
    for (const location of [directory, images]) expect(fs.readFileSync(path.join(location, "keep.txt"), "utf8")).toBe("User output");
  });

  it.each(["run", "collection"] as const)("retries %s storage purge after the row is already deleted", async (kind) => {
    const id = `purge-${kind}`;
    if (kind === "run") createRun(db, { id, mode: "chat" });
    else createCollection(db, { id });
    const directory = kind === "run" ? managedRunDir(id, "chat") : path.join(root, "userData", "collections", id, "sources");
    fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, "output.txt"), "Output");
    const remove = fs.rmSync.bind(fs); let fail = true;
    const purge = vi.spyOn(fs, "rmSync").mockImplementation((location, options) => {
      if (String(location).includes(`${path.sep}.trash${path.sep}`) && fail) { fail = false; throw new Error("Storage busy"); }
      return remove(location, options);
    });
    const deletion = () => kind === "run" ? runsService.deleteRun(id) : collectionsService.remove({ id, accountId: "default" });
    try {
      await expect(deletion()).rejects.toThrow();
      const row = kind === "run" ? await runsService.getRunById(id) : await collectionsService.get({ id, accountId: "default" });
      expect(row).toBeNull();
      await expect(deletion()).resolves.toBeUndefined();
      const trash = path.join(root, "userData", kind === "run" ? "runs" : "collections", ".trash");
      expect(fs.readdirSync(trash)).toEqual([]);
    } finally { purge.mockRestore(); }
  });

  it("keeps an archive script's ownership until close before restoring the workspace", async () => {
    const entered = deferred(); let complete!: () => void;
    native.execFile.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      complete = () => callback(null, "", ""); entered.resolve(); return {};
    });
    createProject(db, { id: "project", archiveScript: "archive-test", rootPath: root });
    createWorkspace(db, { id: "scripted", projectId: "project", rootPath: root });
    await workspaceService.archive("scripted"); await entered.promise;
    const restoring = workspaceService.unarchive("scripted");
    await new Promise<void>((resolve) => setImmediate(resolve));
    try { expect((await workspaceService.get("scripted"))?.isArchived).toBe(true); }
    finally { complete(); await restoring; }
    expect((await workspaceService.get("scripted"))?.isArchived).toBe(false);
  });

  it.each(["archive", "delete"] as const)("refuses %s while a terminal run still owns finalization", async (action) => {
    createRun(db, { id: "live", status: "succeeded", providerId: "codex", sessionId: "thread" });
    runSessionRegistry.register("live", { runId: "live", phase: "finalizing" } as RunSession);
    const archiveSession = vi.fn(), deleteSession = vi.fn(); native.adapter = { archiveSession, deleteSession };
    await expect(action === "archive" ? runsService.archiveRun("live") : runsService.deleteRun("live")).rejects.toThrow("Stop");
    expect(archiveSession).not.toHaveBeenCalled(); expect(deleteSession).not.toHaveBeenCalled();
    expect((await runsService.getRunById("live"))?.isArchived).toBe(false);
  });

  it.each(["archive", "delete"] as const)("refuses workspace %s while a response is still preparing", async (action) => {
    createWorkspace(db, { id: "preparing-workspace" });
    createRun(db, { id: "preparing-run", workspaceId: "preparing-workspace", status: "succeeded" });
    const release = claimRunResponse("preparing-run");
    try { await expect(action === "archive" ? workspaceService.archive("preparing-workspace") : workspaceService.delete("preparing-workspace")).rejects.toThrow("Stop"); }
    finally { release(); }
    expect((await workspaceService.get("preparing-workspace"))?.isArchived).toBe(false);
  });

  it("project deletion preserves an ordinary checkout even when its path matches the worktree prefix", async () => {
    const checkout = path.join(root, "checkout"); fs.mkdirSync(checkout); fs.writeFileSync(path.join(checkout, "keep.txt"), "User checkout");
    createProject(db, { id: "project-delete", rootPath: checkout, workspacesPath: checkout });
    createWorkspace(db, { id: "ordinary", projectId: "project-delete", rootPath: checkout });
    const remove = vi.spyOn(gitService, "removeWorktree").mockRejectedValue(new Error("Not a worktree"));
    await projectsService.remove("project-delete");
    expect(fs.readFileSync(path.join(checkout, "keep.txt"), "utf8")).toBe("User checkout");
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not reorder an already active collection when restore is repeated", async () => {
    createCollection(db, { id: "first", sortOrder: 0 }); createCollection(db, { id: "second", sortOrder: 1 });
    await collectionsService.unarchive({ id: "first", accountId: "default" });
    expect((await collectionsService.list({ accountId: "default" })).map((row) => row.id)).toEqual(["first", "second"]);
  });

  it("does not remove a worktree when the workspace row cannot be deleted", async () => {
    const location = path.join(root, "worktree"); fs.mkdirSync(location);
    createWorkspace(db, { id: "worktree-db-failure", rootPath: location, metadata: JSON.stringify({ worktree: { enabled: true, path: location, sourcePath: root, name: "branch" } }) });
    const remove = vi.spyOn(gitService, "removeWorktree").mockResolvedValue(undefined);
    vi.spyOn(workspaceRepo, "delete").mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(workspaceService.delete("worktree-db-failure", { removeWorktree: true })).rejects.toThrow("Database unavailable");
    expect(remove).not.toHaveBeenCalled();
    expect(await workspaceService.get("worktree-db-failure")).not.toBeNull();
  });

  it("retains failed worktree cleanup and refuses to remove a replacement directory on retry", async () => {
    const location = path.join(root, "owned-worktree"); fs.mkdirSync(location);
    createWorkspace(db, { id: "worktree-purge", rootPath: location, metadata: JSON.stringify({ worktree: { enabled: true, path: location, sourcePath: root, name: "branch" } }) });
    const remove = vi.spyOn(gitService, "removeWorktree").mockRejectedValueOnce(new Error("Worktree busy")).mockImplementation(async () => { fs.rmSync(location, { recursive: true }); });
    const deletion = () => workspaceService.delete("worktree-purge", { removeWorktree: true });
    await expect(deletion()).rejects.toThrow("cleanup is pending");
    expect(await workspaceService.get("worktree-purge")).toBeNull();
    const original = `${location}.original`; fs.renameSync(location, original); fs.mkdirSync(location); fs.writeFileSync(path.join(location, "keep.txt"), "Replacement");
    try {
      await expect(deletion()).rejects.toThrow("replacement");
      expect(fs.readFileSync(path.join(location, "keep.txt"), "utf8")).toBe("Replacement");
      expect(remove).toHaveBeenCalledTimes(1);
    } finally { fs.rmSync(location, { recursive: true }); fs.renameSync(original, location); await deletion(); }
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it.each(["run", "collection", "workspace"] as const)("finishes %s deletion when the database committed but its reply failed", async (kind) => {
    const id = `committed-${kind}`;
    if (kind === "run") {
      createRun(db, { id, mode: "chat" });
      const remove = runsRepo.deleteRun.bind(runsRepo);
      vi.spyOn(runsRepo, "deleteRun").mockImplementationOnce(async (value) => { await remove(value); throw new Error("Lost database reply"); });
    } else if (kind === "collection") {
      createCollection(db, { id });
      const remove = collectionsRepo.remove.bind(collectionsRepo);
      vi.spyOn(collectionsRepo, "remove").mockImplementationOnce(async (...args) => { await remove(...args); throw new Error("Lost database reply"); });
    } else {
      createWorkspace(db, { id });
      const remove = workspaceRepo.delete.bind(workspaceRepo);
      vi.spyOn(workspaceRepo, "delete").mockImplementationOnce(async (value) => { await remove(value); throw new Error("Lost database reply"); });
    }
    const deletion = kind === "run" ? runsService.deleteRun(id) : kind === "collection" ? collectionsService.remove({ id, accountId: "default" }) : workspaceService.delete(id);
    await expect(deletion).resolves.toBeUndefined();
    const row = kind === "run" ? await runsService.getRunById(id) : kind === "collection" ? await collectionsService.get({ id, accountId: "default" }) : await workspaceService.get(id);
    expect(row).toBeNull();
  });

  it("coalesces child cleanup inherited by a failed project deletion during shutdown", async () => {
    const location = path.join(root, "project-worktree"); fs.mkdirSync(location);
    createProject(db, { id: "aggregate", rootPath: root });
    createWorkspace(db, { id: "aggregate-child", projectId: "aggregate", rootPath: location, metadata: JSON.stringify({ worktree: { enabled: true, path: location, sourcePath: root, name: "branch" } }) });
    const gate = deferred(), entered = deferred();
    const remove = vi.spyOn(gitService, "removeWorktree").mockRejectedValueOnce(new Error("Worktree busy")).mockImplementation(async () => { entered.resolve(); await gate.promise; fs.rmSync(location, { recursive: true, force: true }); });
    await expect(projectsService.remove("aggregate")).rejects.toThrow("cleanup is pending");
    const closing = shutdownRecordLifecycles(); await entered.promise;
    try { expect(remove).toHaveBeenCalledTimes(2); }
    finally { gate.resolve(); await closing; }
    openRecordLifecycles(); await projectsService.remove("aggregate");
    expect(await projectsService.get("aggregate")).toBeNull();
  });

  it("keeps collection membership if restoring an archived run fails", async () => {
    createCollection(db, { id: "archived-parent", isArchived: true });
    createRun(db, { id: "restore-failed", collectionId: "archived-parent", mode: "chat", isArchived: true });
    vi.spyOn(runsRepo, "unarchiveRun").mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(runsService.unarchiveRun("restore-failed")).rejects.toThrow("Database unavailable");
    expect(await runsService.getRunById("restore-failed")).toMatchObject({ isArchived: true, collectionId: "archived-parent" });
  });

  it("retains a failed storage rollback and restores every independent tree before retrying deletion", async () => {
    createRun(db, { id: "rollback", mode: "chat" });
    const directory = managedRunDir("rollback", "chat"), images = managedRunImageDir("rollback");
    for (const location of [directory, images]) { fs.mkdirSync(location, { recursive: true }); fs.writeFileSync(path.join(location, "output.txt"), "Output"); }
    vi.spyOn(runsRepo, "deleteRun").mockRejectedValueOnce(new Error("Database unavailable"));
    const rename = fs.renameSync.bind(fs); let fail = true;
    const fault = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(from).includes(`${path.sep}.trash${path.sep}`) && String(to) === path.dirname(directory) && fail) { fail = false; throw new Error("Rollback busy"); }
      return rename(from, to);
    });
    try {
      await expect(runsService.deleteRun("rollback")).rejects.toThrow("rollback is pending");
      expect(fs.readFileSync(path.join(images, "output.txt"), "utf8")).toBe("Output");
      await expect(runsService.deleteRun("rollback")).resolves.toBeUndefined();
      expect(await runsService.getRunById("rollback")).toBeNull();
    } finally { fault.mockRestore(); }
  });

  it("fences continuation and voice admission while archiving is accepted", async () => {
    createRun(db, { id: "fenced", providerId: "codex", mode: "chat", sessionId: "thread", status: "succeeded" });
    const entered = deferred(), gate = deferred();
    const continueRun = vi.fn(), startRealtime = vi.fn();
    native.adapter = { archiveSession: async () => { entered.resolve(); await gate.promise; }, continueRun, startRealtime };
    const archiving = runsService.archiveRun("fenced"); await entered.promise;
    try {
      await expect(runsService.continueRun({ runId: "fenced", accountId: "default", message: "Continue" })).rejects.toThrow("being archived");
      await expect(runsService.startRealtime({ runId: "fenced", accountId: "default", connectionId: "voice", sdp: "v=0\r\n" })).rejects.toThrow("being archived");
      expect(continueRun).not.toHaveBeenCalled(); expect(startRealtime).not.toHaveBeenCalled();
    } finally { gate.resolve(); await archiving; }
  });

  it("does not archive a workspace during a child's native restore", async () => {
    createWorkspace(db, { id: "restore-parent" });
    createRun(db, { id: "restoring-child", workspaceId: "restore-parent", providerId: "codex", sessionId: "thread", isArchived: true });
    const entered = deferred(), gate = deferred(); native.adapter = { unarchiveSession: async () => { entered.resolve(); await gate.promise; } };
    const restoring = runsService.unarchiveRun("restoring-child"); await entered.promise;
    try { await expect(workspaceService.archive("restore-parent")).rejects.toThrow("Wait"); }
    finally { gate.resolve(); await restoring; }
    expect((await workspaceService.get("restore-parent"))?.isArchived).toBe(false);
  });

  it("serializes source writes before deleting their collection without leaving orphan files", async () => {
    createCollection(db, { id: "writing" });
    const entered = deferred(), gate = deferred(), insert = collectionsRepo.insertSource.bind(collectionsRepo);
    vi.spyOn(collectionsRepo, "insertSource").mockImplementationOnce(async (input) => { entered.resolve(); await gate.promise; return insert(input); });
    const adding = collectionsService.addSource({ collectionId: "writing", accountId: "default", kind: "text", name: "Brief", text: "Canonical source" });
    await entered.promise;
    const deleting = collectionsService.remove({ id: "writing", accountId: "default" });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(await collectionsService.get({ id: "writing", accountId: "default" })).not.toBeNull();
    } finally { gate.resolve(); await Promise.all([adding, deleting]); }
    expect(fs.existsSync(path.join(root, "userData", "collections", "writing"))).toBe(false);
    expect(await collectionsService.get({ id: "writing", accountId: "default" })).toBeNull();
  });

  it("does not let another account join an accepted collection mutation", async () => {
    createCollection(db, { id: "private" }); createAccount(db, { id: "other" });
    const entered = deferred(), gate = deferred(), archive = collectionsRepo.setArchived.bind(collectionsRepo);
    vi.spyOn(collectionsRepo, "setArchived").mockImplementationOnce(async (...input) => { entered.resolve(); await gate.promise; return archive(...input); });
    const accepted = collectionsService.archive({ id: "private", accountId: "default" }); await entered.promise;
    let rejected = false;
    const denied = collectionsService.archive({ id: "private", accountId: "other" }).catch((error: Error) => { rejected = error.message.includes("does not belong"); });
    try { await new Promise<void>((resolve) => setImmediate(resolve)); expect(rejected).toBe(true); }
    finally { gate.resolve(); await Promise.all([accepted, denied]); }
  });

  it("retries source cleanup even after its row has disappeared", async () => {
    createCollection(db, { id: "source-cleanup" });
    const source = await collectionsService.addSource({ collectionId: "source-cleanup", accountId: "default", kind: "text", name: "Brief", text: "Source" });
    const remove = fs.rmSync.bind(fs); let fail = true;
    const fault = vi.spyOn(fs, "rmSync").mockImplementation((location, options) => {
      if (String(location).includes(`${path.sep}.trash${path.sep}`) && fail) { fail = false; throw new Error("Storage busy"); }
      return remove(location, options);
    });
    try {
      await expect(collectionsService.removeSource({ id: source.id, accountId: "default" })).rejects.toThrow("cleanup is pending");
      await expect(collectionsService.removeSource({ id: source.id, accountId: "default" })).resolves.toBeUndefined();
    } finally { fault.mockRestore(); }
  });
});
