import { afterEach, describe, expect, it, vi } from "vitest";
import { createApprovalLifecycle, type ApprovalLease } from "./user-input-lifecycle";

afterEach(() => vi.useRealTimers());

describe("approval presentation revisions", () => {
  it("retires old notification leases before publishing a changed patch", async () => {
    const leases: ApprovalLease[] = [];
    const lifecycle = createApprovalLifecycle({ pending: (lease) => { leases.push(lease); }, settled: vi.fn() });
    const pending = lifecycle.request({ requestId: "patch", runId: "run", kind: "tool_approval", toolName: "Edit", timestamp: 1 });
    const oldNote = { close: vi.fn() };
    leases[0].attach(oldNote);
    lifecycle.update("patch", { toolInput: { diff: "updated" } });
    expect(oldNote.close).toHaveBeenCalledOnce();
    expect(leases[0].current()).toBe(false);
    expect(leases[1].current()).toBe(true);
    const newNote = { close: vi.fn() };
    leases[1].attach(newNote);
    const lateOldNote = { close: vi.fn() };
    leases[0].attach(lateOldNote);
    expect(lateOldNote.close).toHaveBeenCalledOnce();
    expect(newNote.close).not.toHaveBeenCalled();
    lifecycle.cancel("patch");
    await expect(pending).resolves.toMatchObject({ approved: false });
    expect(newNote.close).toHaveBeenCalledOnce();
  });

  it("does not refresh an expired request or extend its original timer", async () => {
    vi.useFakeTimers();
    const shown = vi.fn();
    const lifecycle = createApprovalLifecycle({ pending: shown, settled: vi.fn() });
    const pending = lifecycle.request({ requestId: "patch", runId: "run", kind: "tool_approval", toolName: "Edit", timestamp: Date.now(), autoResolutionMs: 100 });
    vi.advanceTimersByTime(70);
    lifecycle.update("patch", { toolInput: { diff: "updated" } });
    vi.advanceTimersByTime(30);
    await expect(pending).resolves.toMatchObject({ approved: false });
    expect(lifecycle.update("patch", { toolInput: { diff: "late" } })).toBe(false);
    expect(shown).toHaveBeenCalledTimes(2);
  });
});
