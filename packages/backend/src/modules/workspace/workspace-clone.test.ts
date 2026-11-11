import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_CLONE_CANCELED } from "@mains/contracts/workspace-intake";
import { cloneWorkspaceRepository, cancelWorkspaceClone } from "./workspace-clone";
import { withWorkspaceIntake, openWorkspaceIntakes, shutdownWorkspaceIntakes } from "./workspace-intake-lifecycle";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ResourceCleanupError } from "../../runtime/resource-lifecycle";

const mocks = vi.hoisted(() => ({ cloneRepo: vi.fn() }));
vi.mock("../git", () => ({ gitService: { cloneRepo: mocks.cloneRepo } }));

const source = (cloneId: string) => ({ kind: "clone" as const, cloneId, url: "https://github.com/org/repo.git", targetPath: "/tmp" });
const result = { clonedPath: "/tmp/repo", defaultBranch: "main", originUrl: "https://github.com/org/repo.git" };
beforeEach(() => { openWorkspaceIntakes(); mocks.cloneRepo.mockReset(); });

describe("cancelable workspace clone acquisition", () => {
  it("also aborts legacy acquisitions without a clone ID during shutdown", async () => {
    let rejectClone!: (error: Error) => void;
    mocks.cloneRepo.mockImplementation(() => new Promise((_resolve, reject) => { rejectClone = reject; }));
    const clone = cloneWorkspaceRepository("account", { kind: "clone", url: result.originUrl, targetPath: "/tmp" });
    const failed = expect(clone).rejects.toThrow(WORKSPACE_CLONE_CANCELED);
    const stop = shutdownWorkspaceIntakes();
    try { expect(mocks.cloneRepo.mock.calls[0][2]?.aborted).toBe(true); }
    finally { rejectClone(new Error(WORKSPACE_CLONE_CANCELED)); await failed; await stop; openWorkspaceIntakes(); }
  });

  it("fences shutdown, aborts acquisition, and waits for accepted registration before reopening", async () => {
    let rejectClone!: (error: Error) => void, finishRegistration!: () => void;
    mocks.cloneRepo.mockImplementation((_url, _target, signal: AbortSignal) => new Promise((_resolve, reject) => {
      rejectClone = reject; signal.addEventListener("abort", () => rejectClone(new Error(WORKSPACE_CLONE_CANCELED)), { once: true });
    }));
    const clone = cloneWorkspaceRepository("account", source("shutdown"));
    const failed = expect(clone).rejects.toThrow(WORKSPACE_CLONE_CANCELED);
    const registration = withWorkspaceIntake({ accountId: "account", source: { kind: "folder", path: "/tmp/intake-registering" } },
      () => new Promise<void>((resolve) => { finishRegistration = resolve; }));
    const stop = shutdownWorkspaceIntakes(); let stopped = false; void stop.then(() => { stopped = true; });
    await failed;
    try {
      expect(stopped).toBe(false);
      expect(openWorkspaceIntakes).toThrow("cleanup is still pending");
      await expect(cloneWorkspaceRepository("account", source("after-close"))).rejects.toThrow("shutting down");
    } finally { finishRegistration(); await registration; await stop; }
    openWorkspaceIntakes();
    mocks.cloneRepo.mockResolvedValue(result);
    await expect(cloneWorkspaceRepository("account", source("reopened"))).resolves.toEqual(result);
  });

  it("reports that completion won when Git succeeds despite a concurrent cancel request", async () => {
    let finish!: (value: typeof result) => void;
    mocks.cloneRepo.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = cloneWorkspaceRepository("account", source("race"));
    const canceled = cancelWorkspaceClone({ accountId: "account", cloneId: "race" });
    finish(result);
    await expect(pending).resolves.toEqual(result);
    await expect(canceled).resolves.toBe(false);
  });

  it("aborts only its own process and acknowledges after it settles", async () => {
    const pending: Array<{ signal: AbortSignal; resolve: (value: typeof result) => void; reject: (error: Error) => void }> = [];
    mocks.cloneRepo.mockImplementation((_url, _path, signal) => new Promise((resolve, reject) => pending.push({ signal, resolve, reject })));
    const first = cloneWorkspaceRepository("account", source("first"));
    const firstRejection = expect(first).rejects.toThrow(WORKSPACE_CLONE_CANCELED);
    const second = cloneWorkspaceRepository("account", { ...source("second"), url: "https://github.com/org/second.git" });
    const canceled = cancelWorkspaceClone({ accountId: "account", cloneId: "first" });
    const acknowledged = vi.fn(); void canceled.then(acknowledged);
    await Promise.resolve();
    expect(pending[0].signal.aborted).toBe(true);
    expect(pending[1].signal.aborted).toBe(false);
    expect(acknowledged).not.toHaveBeenCalled();
    pending[0].reject(new Error(WORKSPACE_CLONE_CANCELED));
    await firstRejection;
    await expect(canceled).resolves.toBe(true);
    pending[1].resolve(result);
    await expect(second).resolves.toEqual(result);
    await expect(cancelWorkspaceClone({ accountId: "account", cloneId: "first" })).resolves.toBe(false);
  });

  it("rejects duplicate clone identities and cancellation from another account", async () => {
    let finish!: (value: typeof result) => void;
    mocks.cloneRepo.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = cloneWorkspaceRepository("account", source("owned"));
    await expect(cloneWorkspaceRepository("account", source("owned"))).rejects.toThrow("already in progress");
    await expect(cancelWorkspaceClone({ accountId: "other", cloneId: "owned" })).rejects.toThrow("not found");
    expect(mocks.cloneRepo.mock.calls[0][2].aborted).toBe(false);
    finish(result);
    await pending;
  });

  it("rejects another identity and URL claiming the same destination before starting Git", async () => {
    let finish!: (value: typeof result) => void;
    mocks.cloneRepo.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(result);
    const first = cloneWorkspaceRepository("account", source("destination-owner"));
    try {
      await expect(cloneWorkspaceRepository("other-account", {
        ...source("competing"), url: "https://example.com/different/repo.git", targetPath: "/tmp/child/..",
      })).rejects.toThrow("already in progress");
      expect(mocks.cloneRepo).toHaveBeenCalledTimes(1);
    } finally { finish(result); await first; }
  });

  it("releases failed identities for retry and preserves callers without cancellation IDs", async () => {
    mocks.cloneRepo.mockRejectedValueOnce(new Error("Network failure")).mockResolvedValue(result);
    await expect(cloneWorkspaceRepository("account", source("retry"))).rejects.toThrow("Network failure");
    await expect(cloneWorkspaceRepository("account", source("retry"))).resolves.toEqual(result);
    await expect(cloneWorkspaceRepository("account", { kind: "clone", url: result.originUrl, targetPath: "/tmp" })).resolves.toEqual(result);
    expect(mocks.cloneRepo).toHaveBeenLastCalledWith(result.originUrl, "/tmp", expect.any(AbortSignal));
  });

  it("retains destination ownership through registration while cancellation reports completion won", async () => {
    mocks.cloneRepo.mockResolvedValue(result);
    let entered!: () => void, finish!: () => void;
    const importing = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { finish = resolve; });
    const payload = { accountId: "account", source: source("registering") };
    const intake = withWorkspaceIntake(payload, async (scope) => { await scope.acquireClone(); entered(); await blocked; return "workspace"; });
    await importing;
    try {
      await expect(cancelWorkspaceClone({ accountId: "account", cloneId: "registering" })).resolves.toBe(false);
      await expect(cloneWorkspaceRepository("account", source("other-identity"))).rejects.toThrow("already in progress");
      expect(mocks.cloneRepo).toHaveBeenCalledTimes(1);
    } finally { finish(); }
    await expect(intake).resolves.toBe("workspace");
  });

  it("ignores cancellation from an earlier attempt of the same logical clone", async () => {
    const current = { ...source("attempt-owned"), attemptId: "current-attempt" };
    let finish!: (value: typeof result) => void;
    mocks.cloneRepo.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = cloneWorkspaceRepository("account", current);
    const canceled = cancelWorkspaceClone({ accountId: "account", cloneId: current.cloneId, attemptId: "retired-attempt" });
    try {
      expect(mocks.cloneRepo.mock.calls[0][2].aborted).toBe(false);
    } finally { finish(result); await pending; }
    await expect(canceled).resolves.toBe(false);
  });

  it("finishes a failed acquisition's pending cleanup before retrying Git", async () => {
    let release!: () => void;
    const cleanup = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const payload = { ...source("cleanup-retry"), targetPath: "/tmp/intake-cleanup-retry" };
    mocks.cloneRepo.mockRejectedValueOnce(new ResourceCleanupError([], "Cleanup blocked", cleanup)).mockResolvedValue(result);
    await expect(cloneWorkspaceRepository("account", payload)).rejects.toThrow("Cleanup blocked");
    const retry = cloneWorkspaceRepository("account", payload);
    await Promise.resolve();
    try {
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(mocks.cloneRepo).toHaveBeenCalledTimes(1);
    } finally { release?.(); await retry; }
    expect(mocks.cloneRepo).toHaveBeenCalledTimes(2);
  });

  it("retries failed registration from its acquired checkout without cloning over it", async () => {
    const acquiredPath = await fs.mkdtemp(path.join(os.tmpdir(), "mains-intake-retry-"));
    const acquired = { ...result, clonedPath: acquiredPath };
    mocks.cloneRepo.mockResolvedValue(acquired);
    const payload = { accountId: "account", source: source("registration-retry") };
    try {
      await expect(withWorkspaceIntake(payload, async (scope) => {
        await scope.acquireClone(); throw new Error("Database unavailable");
      })).rejects.toThrow("Database unavailable");
      await fs.writeFile(path.join(acquiredPath, "user.txt"), "keep");
      const read = await withWorkspaceIntake(payload, async (scope) => scope.acquireClone());
      expect(read).toEqual(acquired);
      expect(mocks.cloneRepo).toHaveBeenCalledTimes(1);
      expect(await fs.readFile(path.join(acquiredPath, "user.txt"), "utf8")).toBe("keep");
    } finally { await fs.rm(acquiredPath, { recursive: true, force: true }); }
  });

  it("rejects account/source changes and a replacement checkout when resuming a checkpoint", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mains-intake-checkpoint-"));
    const checkout = path.join(directory, "checkout"); await fs.mkdir(checkout);
    const acquired = { ...result, clonedPath: checkout };
    mocks.cloneRepo.mockResolvedValue(acquired);
    const payload = { accountId: "account", source: source("protected-checkpoint") };
    try {
      await expect(withWorkspaceIntake(payload, async (scope) => { await scope.acquireClone(); throw new Error("Registration failed"); })).rejects.toThrow("Registration failed");
      await expect(withWorkspaceIntake({ ...payload, accountId: "other" }, (scope) => scope.acquireClone())).rejects.toThrow("another intake");
      await expect(withWorkspaceIntake({ ...payload, source: { ...payload.source, url: "https://example.test/other/repo.git" } }, (scope) => scope.acquireClone())).rejects.toThrow("another intake");
      await fs.rename(checkout, path.join(directory, "original")); await fs.mkdir(checkout); await fs.writeFile(path.join(checkout, "keep.txt"), "Replacement data");
      await expect(withWorkspaceIntake(payload, (scope) => scope.acquireClone())).rejects.toThrow("directory changed");
      expect(mocks.cloneRepo).toHaveBeenCalledTimes(1);
      expect(await fs.readFile(path.join(checkout, "keep.txt"), "utf8")).toBe("Replacement data");
      await fs.rm(checkout, { recursive: true }); await fs.rename(path.join(directory, "original"), checkout);
      await withWorkspaceIntake(payload, (scope) => scope.acquireClone());
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });

  it.each(["", "x".repeat(129)])("rejects invalid clone identity before native work (%s)", async (cloneId) => {
    await expect(cloneWorkspaceRepository("account", source(cloneId))).rejects.toThrow("Invalid clone ID");
    expect(mocks.cloneRepo).not.toHaveBeenCalled();
  });
});
