import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceIntakeController } from "./workspace-intake-controller";
import { setTransport, resetTransport, type Transport } from "./transport";
import type { Workspace } from "./redux/api/workspaceApi";
import { WORKSPACE_CLONE_CANCELED, type WorkspaceIntakePayload, type CancelWorkspaceClonePayload } from "@mains/contracts/workspace-intake";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const workspace = { id: "workspace", accountId: "account" } as Workspace;
const transport = (): Transport => ({ kind: "fixture", invoke: vi.fn(), subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {} });
let owner: ReturnType<typeof createWorkspaceIntakeController>;
let creates: Array<{ payload: WorkspaceIntakePayload; result: ReturnType<typeof deferred<Workspace>> }>;
let cancels: Array<{ payload: CancelWorkspaceClonePayload; result: ReturnType<typeof deferred<boolean>> }>;
let picks: Array<ReturnType<typeof deferred<string | null>>>;
const notifications = { succeeded: vi.fn(), failed: vi.fn(), openWorkspace: vi.fn() };
const view = () => owner.getSnapshot().view!;
const row = () => owner.getSnapshot().rows[0];
function activate(accountId = "account", backendId = "local", next = transport()) { setTransport(next); owner.activate(accountId, backendId, next); return view(); }
beforeEach(() => {
  vi.clearAllMocks(); creates = []; cancels = []; picks = [];
  owner = createWorkspaceIntakeController({ ...notifications,
    create(payload) { const result = deferred<Workspace>(); creates.push({ payload, result }); return result.promise; },
    cancel(payload) { const result = deferred<boolean>(); cancels.push({ payload, result }); return result.promise; },
    selectDirectory() { const result = deferred<string | null>(); picks.push(result); return result.promise; },
  });
  activate();
});
afterEach(() => { owner.retire(); for (const request of creates) request.result.resolve(workspace); for (const request of cancels) request.result.resolve(false); for (const request of picks) request.resolve(null); resetTransport(); });

describe("workspace intake view ownership", () => {
  it("claims clone submissions synchronously and waits for visible-list acknowledgement", async () => {
    owner.clone(view(), " https://example.test/repo.git ", " /repos ");
    owner.clone(view(), "https://example.test/repo.git", "/repos");
    expect(creates).toHaveLength(1);
    creates[0].result.resolve(workspace); await Promise.resolve();
    expect(row().status).toBe("completing");
    await owner.cancelClone(view(), row().id); expect(cancels).toEqual([]);
    owner.acknowledge(view(), ["another-workspace"]); expect(row().status).toBe("completing");
    owner.acknowledge(view(), [workspace.id]); expect(owner.getSnapshot().rows).toEqual([]);
  });

  it("keeps concurrent clones independent while one finishes", async () => {
    owner.clone(view(), "https://example.test/first.git", "/repos");
    owner.clone(view(), "https://example.test/second.git", "/repos");
    creates[0].result.resolve(workspace); await Promise.resolve();
    owner.acknowledge(view(), [workspace.id]);
    expect(owner.getSnapshot().rows.map((row) => [row.name, row.status])).toEqual([["second", "cloning"]]);
  });

  it("coalesces cancellation and keeps its row until the original intake confirms cancellation", async () => {
    owner.clone(view(), "https://example.test/repo.git", "/repos");
    const first = owner.cancelClone(view(), row().id); await owner.cancelClone(view(), row().id);
    expect(cancels).toHaveLength(1);
    expect(cancels[0].payload.attemptId).toBe((creates[0].payload.source as { attemptId: string }).attemptId);
    cancels[0].result.resolve(true); await first;
    expect(row().status).toBe("canceling");
    creates[0].result.reject(new Error(WORKSPACE_CLONE_CANCELED)); await Promise.resolve();
    expect(owner.getSnapshot().rows).toEqual([]);
    expect(notifications.failed).not.toHaveBeenCalled();
  });

  it.each(["accepted", "too-late", "error"])("ignores an old cancellation's %s result after an explicit retry", async (result) => {
    owner.clone(view(), "https://example.test/repo.git", "/repos");
    const id = row().id, canceling = owner.cancelClone(view(), id);
    creates[0].result.reject(new Error("First intake failed")); await Promise.resolve();
    expect(row().status).toBe("failed"); owner.retry(view(), id);
    const first = creates[0].payload.source as { cloneId: string; attemptId: string };
    const retry = creates[1].payload.source as { cloneId: string; attemptId: string };
    expect(retry.cloneId).toBe(first.cloneId); expect(retry.attemptId).not.toBe(first.attemptId);
    if (result === "error") cancels[0].result.reject(new Error("Old cancel failed"));
    else cancels[0].result.resolve(result === "accepted");
    await canceling;
    expect(row().status).toBe("cloning");
    expect(notifications.failed).toHaveBeenCalledExactlyOnceWith("First intake failed");
  });

  it("restores cancel eligibility after a current cancellation failure", async () => {
    owner.clone(view(), "https://example.test/repo.git", "/repos");
    const canceling = owner.cancelClone(view(), row().id);
    cancels[0].result.reject(new Error("Cannot cancel")); await canceling;
    expect(row().status).toBe("cloning");
    expect(notifications.failed).toHaveBeenCalledExactlyOnceWith("Cannot cancel");
  });

  it("retires an Open action across a backend round trip without losing unfinished rows", async () => {
    const original = view();
    owner.clone(original, "https://example.test/repo.git", "/repos");
    creates[0].result.resolve(workspace); await Promise.resolve();
    const open = notifications.succeeded.mock.calls[0][1] as () => void;
    activate("account", "other"); activate("account", "local", original.transport);
    open(); expect(notifications.openWorkspace).not.toHaveBeenCalled();
    owner.clone(original, "https://example.test/retired.git", "/repos");
    expect(creates).toHaveLength(1);
  });

  it("drops a stale folder picker result before it can issue a backend mutation", async () => {
    const pending = owner.addFolder(view()); activate("other-account", "local", view().transport);
    picks[0].resolve("/selected-folder");
    expect(await pending).toBeNull(); expect(creates).toEqual([]);
  });

  it("does not let an old picker clear the replacement's foreground ownership", async () => {
    const first = owner.addFolder(view()); activate("other-account");
    const current = view(), second = owner.addFolder(current);
    picks[0].resolve("/old-folder"); expect(await first).toBeNull();
    expect(owner.getSnapshot().folder).toBe(current);
    picks[1].resolve("/new-folder"); await Promise.resolve();
    expect(creates[0].payload).toEqual({ accountId: "other-account", source: { kind: "folder", path: "/new-folder" } });
    creates[0].result.resolve(workspace); const accepted = await second;
    expect(accepted?.current()).toBe(true);
    activate(); expect(accepted?.current()).toBe(false);
  });

  it.each(["success", "failure"])("suppresses a retired foreground %s and permits a fresh request", async (outcome) => {
    const oldView = view(), pending = owner.init(oldView, "old", "/repos");
    activate(); const current = view(), replacement = owner.init(current, "new", "/repos");
    if (outcome === "success") creates[0].result.resolve(workspace); else creates[0].result.reject(new Error("Old init failed"));
    expect(await pending).toBeNull(); expect(owner.getSnapshot().init).toBe(current);
    expect(notifications.failed).not.toHaveBeenCalled();
    creates[1].result.resolve(workspace); expect((await replacement)?.current()).toBe(true);
    owner.clone(oldView, "https://example.test/retired.git", "/repos"); expect(creates).toHaveLength(2);
  });

  it("coalesces foreground starts and releases failure for an explicit retry", async () => {
    const pending = owner.init(view(), "first", "/repos");
    expect(await owner.init(view(), "duplicate", "/repos")).toBeNull(); expect(creates).toHaveLength(1);
    creates[0].result.reject(new Error("Init failed")); expect(await pending).toBeNull();
    expect(owner.getSnapshot().init).toBeNull();
    const retry = owner.init(view(), "first", "/repos"); expect(creates).toHaveLength(2);
    creates[1].result.resolve(workspace); expect((await retry)?.current()).toBe(true);
  });

  it("keeps accepted clone work through effect replay while fencing its old notifications", async () => {
    owner.clone(view(), "https://example.test/repo.git", "/repos"); const original = view();
    owner.retire(); owner.activate("account", "local", original.transport);
    owner.clone(view(), "https://example.test/repo.git", "/repos"); expect(creates).toHaveLength(1);
    creates[0].result.resolve(workspace); await Promise.resolve();
    expect(owner.getSnapshot().rows).toEqual([]); expect(notifications.succeeded).not.toHaveBeenCalled();
  });
});
