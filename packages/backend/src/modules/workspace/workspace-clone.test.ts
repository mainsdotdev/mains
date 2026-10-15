import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_CLONE_CANCELED } from "@mains/contracts/workspace-intake";
import { cloneWorkspaceRepository, cancelWorkspaceClone } from "./workspace-clone";

const mocks = vi.hoisted(() => ({ cloneRepo: vi.fn() }));
vi.mock("../git", () => ({ gitService: { cloneRepo: mocks.cloneRepo } }));

const source = (cloneId: string) => ({ kind: "clone" as const, cloneId, url: "https://github.com/org/repo.git", targetPath: "/tmp" });
const result = { clonedPath: "/tmp/repo", defaultBranch: "main", originUrl: "https://github.com/org/repo.git" };
beforeEach(() => { mocks.cloneRepo.mockReset(); });

describe("cancelable workspace clone acquisition", () => {
  it("aborts only its own process and acknowledges after it settles", async () => {
    const pending: Array<{ signal: AbortSignal; resolve: (value: typeof result) => void; reject: (error: Error) => void }> = [];
    mocks.cloneRepo.mockImplementation((_url, _path, signal) => new Promise((resolve, reject) => pending.push({ signal, resolve, reject })));
    const first = cloneWorkspaceRepository("account", source("first"));
    const firstRejection = expect(first).rejects.toThrow(WORKSPACE_CLONE_CANCELED);
    const second = cloneWorkspaceRepository("account", source("second"));
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

  it("releases failed identities for retry and preserves callers without cancellation IDs", async () => {
    mocks.cloneRepo.mockRejectedValueOnce(new Error("Network failure")).mockResolvedValue(result);
    await expect(cloneWorkspaceRepository("account", source("retry"))).rejects.toThrow("Network failure");
    await expect(cloneWorkspaceRepository("account", source("retry"))).resolves.toEqual(result);
    await expect(cloneWorkspaceRepository("account", { kind: "clone", url: result.originUrl, targetPath: "/tmp" })).resolves.toEqual(result);
    expect(mocks.cloneRepo).toHaveBeenLastCalledWith(result.originUrl, "/tmp");
  });
});
