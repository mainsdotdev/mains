import { describe, expect, it, vi } from "vitest";
import { createCodexGoalLifecycle } from "./codex-goal-lifecycle";

const goal = { threadId: "thread-1", objective: "Original objective", status: "active", updatedAt: 1 };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function harness() {
  const goals = new Map<string, any>([[goal.threadId, goal]]);
  const send = vi.fn(async (method: string, params: any): Promise<any> => {
    if (method === "thread/goal/get") return { goal: goals.get(params.threadId) ?? null };
    if (method === "thread/goal/set") { const next = { ...goal, ...goals.get(params.threadId), ...params }; goals.set(params.threadId, next); return { goal: next }; }
    const cleared = goals.delete(params.threadId); return { cleared };
  });
  const server = { sendRequest: send } as any;
  let running: any = server;
  const resolveThread = vi.fn(async (_run: string) => "thread-1" as string | undefined);
  const publish = vi.fn();
  const effects = { ensureServer: vi.fn(async () => running), getRunningServer: () => running, resolveThread,
    findRunId: (_thread: string) => "run-1" as string | null, publish, warn: vi.fn(), error: vi.fn(), unavailable: () => false };
  const life = createCodexGoalLifecycle(effects);
  return { life, server, send, goals, publish, effects, replace(next: any) { running = next; } };
}

describe("native provider goal ownership", () => {
  it.each(["active", "paused", "blocked", "usageLimited", "budgetLimited", "futureProviderStatus"])("preserves the provider's %s goal across automatic continuation/fork setup", async (status) => {
    const h = harness(); h.goals.set("thread-1", { ...goal, status });
    await h.life.establish(h.server, "thread-1", true, "Follow-up", undefined, false);
    expect(h.send.mock.calls.map(([method]) => method)).toEqual(["thread/goal/get"]);
    expect(h.goals.get("thread-1")).toMatchObject({ status, objective: goal.objective });
  });
  it("establishes a verified missing goal and keeps origin and path mentions intact", async () => {
    const h = harness(); h.goals.clear();
    await h.life.establish(h.server, "thread-1", true, "Fix @/work tree/src/file.ts", "/work tree", false);
    expect(h.send).toHaveBeenCalledWith("thread/goal/set", { threadId: "thread-1", objective: "Fix @src/file.ts", origin: "automatic" });
  });
  it("does not infer absence from a failed or malformed goal read", async () => {
    const h = harness(); h.send.mockRejectedValueOnce(new Error("Offline"));
    await h.life.establish(h.server, "thread-1", true, "Follow-up", undefined, false);
    h.send.mockResolvedValueOnce({});
    await h.life.establish(h.server, "thread-1", true, "Follow-up", undefined, false);
    expect(h.send.mock.calls.filter(([method]) => method === "thread/goal/set")).toHaveLength(0);
  });
  it("does not touch goals with mode off, a blank objective or a missing thread", async () => {
    const h = harness();
    await h.life.establish(h.server, "thread-1", false, "Goal", undefined, true);
    await h.life.establish(h.server, "thread-1", true, " \n", undefined, true);
    await h.life.establish(h.server, undefined, true, "Goal", undefined, true);
    expect(h.send).not.toHaveBeenCalled();
  });
  it.each(["run-1", "another-run"])("serializes writes and clear for the same thread through %s", async (secondRun) => {
    const h = harness(); const receipt = deferred<any>(); h.send.mockImplementationOnce(() => receipt.promise);
    const first = h.life.set("run-1", { objective: "First" });
    await vi.waitFor(() => expect(h.send).toHaveBeenCalledOnce());
    const second = h.life.clear(secondRun);
    expect(h.send.mock.calls.some(([method]) => method === "thread/goal/clear")).toBe(false);
    receipt.resolve({ goal: { ...goal, objective: "First" } }); await first; await second;
    expect(h.send.mock.calls.map(([method]) => method)).toEqual(["thread/goal/set", "thread/goal/clear"]);
  });
  it("preserves admission order through a slow persisted-thread lookup", async () => {
    const h = harness(); const lookup = deferred<string>(); h.effects.resolveThread.mockImplementationOnce(() => lookup.promise);
    const first = h.life.set("run-1", { objective: "First" });
    await vi.waitFor(() => expect(h.effects.resolveThread).toHaveBeenCalledOnce());
    const second = h.life.set("run-1", { objective: "Second" });
    lookup.resolve("thread-1"); await Promise.all([first, second]);
    expect(h.send.mock.calls.filter(([method]) => method === "thread/goal/set").map(([, params]) => params.objective)).toEqual(["First", "Second"]);
  });
  it("permits independent threads while another goal write is pending", async () => {
    const h = harness(); const receipt = deferred<any>(); h.effects.resolveThread.mockImplementation(async (run) => run === "run-1" ? "thread-1" : "thread-2");
    h.send.mockImplementationOnce(() => receipt.promise);
    const first = h.life.set("run-1", { objective: "Waiting" }); await vi.waitFor(() => expect(h.send).toHaveBeenCalledOnce());
    await expect(h.life.set("run-2", { objective: "Independent" })).resolves.toMatchObject({ objective: "Independent" });
    receipt.resolve({ goal }); await first;
  });
  it("keeps omitted goal fields untouched and distinguishes explicit and automatic origin", async () => {
    const h = harness(); h.goals.set("thread-1", { ...goal, tokenBudget: 500 });
    await expect(h.life.set("run-1", { status: "paused" })).resolves.toMatchObject({ status: "paused", objective: goal.objective, tokenBudget: 500 });
    expect(h.send).toHaveBeenCalledWith("thread/goal/set", { threadId: "thread-1", status: "paused", origin: "user" });
    await h.life.set("run-1", { tokenBudget: 0, origin: "automatic" });
    expect(h.send).toHaveBeenLastCalledWith("thread/goal/set", { threadId: "thread-1", tokenBudget: 0, origin: "automatic" });
  });
  it("rejects malformed commands before acquiring a server", async () => {
    const h = harness();
    for (const params of [{ objective: " " }, { tokenBudget: -1 }, { tokenBudget: NaN }, { tokenBudget: 1.5 }, { origin: "wrong" }]) {
      await expect(h.life.set("run-1", params as any)).resolves.toBeNull();
    }
    expect(h.effects.ensureServer).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });
  it("does not start a server for a missing thread or a read-only offline probe", async () => {
    const h = harness(); h.effects.resolveThread.mockResolvedValue(undefined);
    await expect(h.life.set("missing", { objective: "Goal" })).resolves.toBeNull();
    await expect(h.life.clear("missing")).resolves.toBe(false);
    h.effects.resolveThread.mockResolvedValue("thread-1"); h.replace(null);
    await expect(h.life.get("run-1")).resolves.toBeNull(); expect(h.effects.ensureServer).not.toHaveBeenCalled();
  });
  it("retires queued and in-flight work before acquiring a replacement server", async () => {
    const h = harness(); const receipt = deferred<any>(); h.send.mockImplementationOnce(() => receipt.promise);
    const writing = h.life.set("run-1", { objective: "Old scope" }); await vi.waitFor(() => expect(h.send).toHaveBeenCalledOnce());
    const queued = h.life.clear("run-1"); h.life.serverClosed();
    const replacement = { sendRequest: vi.fn(async () => ({ goal: { ...goal, objective: "New scope" } })) }; h.replace(replacement);
    await expect(h.life.set("run-1", { objective: "New scope" })).resolves.toMatchObject({ objective: "New scope" });
    receipt.resolve({ goal: { ...goal, objective: "Old scope" } });
    await expect(writing).resolves.toBeNull(); await expect(queued).resolves.toBe(false);
    expect(h.publish.mock.calls.map(([, value]) => value?.objective)).toEqual(["New scope"]);
  });
  it("does not restart the provider after shutdown during a thread lookup", async () => {
    const h = harness(); const lookup = deferred<string>(); h.effects.resolveThread.mockImplementationOnce(() => lookup.promise);
    const pending = h.life.set("run-1", { objective: "Goal" }); await vi.waitFor(() => expect(h.effects.resolveThread).toHaveBeenCalledOnce());
    h.life.shutdown(); lookup.resolve("thread-1");
    await expect(pending).resolves.toBeNull(); expect(h.effects.ensureServer).not.toHaveBeenCalled();
  });
  it("does not publish a reply into a run whose thread was replaced", async () => {
    const h = harness(); const receipt = deferred<any>(); h.send.mockImplementationOnce(() => receipt.promise);
    const pending = h.life.set("run-1", { objective: "Old thread" }); await vi.waitFor(() => expect(h.send).toHaveBeenCalledOnce());
    h.effects.resolveThread.mockResolvedValue("thread-2"); receipt.resolve({ goal });
    await expect(pending).resolves.toBeNull(); expect(h.publish).not.toHaveBeenCalled();
  });
  it("rejects uncorrelated, malformed and retired-server notifications", () => {
    const h = harness();
    h.life.notification({ sendRequest: vi.fn() }, "thread/goal/updated", { threadId: "thread-1", goal });
    h.life.notification(h.server, "thread/goal/updated", { threadId: "thread-1", goal: {} });
    h.life.notification(h.server, "thread/goal/updated", { threadId: "wrong", goal });
    h.effects.findRunId = () => null;
    h.life.notification(h.server, "thread/goal/cleared", { threadId: "thread-1" });
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("renews a completed goal as active without carrying completion into the next turn", async () => {
    const h = harness(); h.goals.set("thread-1", { ...goal, status: "complete" });
    await h.life.establish(h.server, "thread-1", true, "Next objective", undefined, false);
    expect(h.goals.get("thread-1")).toMatchObject({ objective: "Next objective", status: "active" });
  });
  it.each(["active", "paused", "blocked", "usageLimited", "budgetLimited", "futureStatus"])("does not automatically clear a provider %s goal", async (status) => {
    const h = harness(); h.goals.set("thread-1", { ...goal, status });
    await expect(h.life.clear("run-1", "automatic")).resolves.toBe(false);
    expect(h.send.mock.calls.map(([method]) => method)).toEqual(["thread/goal/get"]);
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("preserves the goal on a failed automatic-clear read and permits explicit clear afterwards", async () => {
    const h = harness(); h.send.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(h.life.clear("run-1", "automatic")).resolves.toBe(false);
    expect(h.goals.get("thread-1")).toEqual(goal);
    await expect(h.life.clear("run-1")).resolves.toBe(true);
    expect(h.publish).toHaveBeenLastCalledWith("run-1", null);
  });
  it("does not echo an old clear over a newer provider goal notification", async () => {
    const h = harness(); const receipt = deferred<any>();
    h.send.mockImplementationOnce(() => receipt.promise);
    const clearing = h.life.clear("run-1");
    await vi.waitFor(() => expect(h.send).toHaveBeenCalledOnce());
    const newer = { ...goal, objective: "New provider objective", updatedAt: 2 };
    h.goals.set("thread-1", newer);
    h.life.notification(h.server, "thread/goal/updated", { threadId: "thread-1", goal: newer });
    receipt.resolve({ cleared: true }); await clearing;
    expect(h.publish).toHaveBeenLastCalledWith("run-1", expect.objectContaining({ objective: "New provider objective" }));
  });
  it("keeps the live provider fact when causal reconciliation fails", async () => {
    const h = harness(); const receipt = deferred<any>(); h.send.mockImplementationOnce(() => receipt.promise);
    const writing = h.life.set("run-1", { objective: "Old edit" }); await vi.waitFor(() => expect(h.send).toHaveBeenCalledOnce());
    const newer = { ...goal, objective: "Live provider objective" };
    h.life.notification(h.server, "thread/goal/updated", { goal: newer });
    h.send.mockRejectedValueOnce(new Error("Snapshot unavailable")); receipt.resolve({ goal: { ...goal, objective: "Old edit" } });
    await expect(writing).resolves.toMatchObject({ objective: "Live provider objective" });
    expect(h.publish).toHaveBeenLastCalledWith("run-1", expect.objectContaining({ objective: "Live provider objective" }));
  });
  it("bounds causal reads and keeps the last live event when each read races", async () => {
    const h = harness(); const receipt = deferred<any>(); h.send.mockImplementationOnce(() => receipt.promise);
    const writing = h.life.set("run-1", { objective: "Edit" }); await vi.waitFor(() => expect(h.send).toHaveBeenCalledOnce());
    h.life.notification(h.server, "thread/goal/updated", { goal });
    let reads = 0;
    h.send.mockImplementation(async () => {
      const current = { ...goal, objective: `Live ${++reads}` };
      h.life.notification(h.server, "thread/goal/updated", { goal: current });
      return { goal: { ...goal, objective: "Preceding snapshot" } };
    });
    receipt.resolve({ goal: { ...goal, objective: "Edit" } });
    await expect(writing).resolves.toMatchObject({ objective: "Live 2" }); expect(reads).toBe(2);
  });
});
