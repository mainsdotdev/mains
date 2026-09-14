import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import {
  clearEventSinks,
  registerEventSink,
  type EventSink,
} from "../../ipc-kit";
import {
  cancelPendingRequest,
  cancelPendingRequests,
  clearAllPendingRequests,
  handleToolApprovalResponse,
  listPendingApprovals,
  requestToolApproval,
} from "./user-input-broker";

afterEach(() => {
  clearAllPendingRequests();
  clearEventSinks();
  vi.useRealTimers();
});

describe("resolution broadcast", () => {
  const request = (requestId: string, runId = "run-1") =>
    requestToolApproval({
      requestId,
      runId,
      toolName: "Bash",
      kind: "tool_approval",
      timestamp: Date.now(),
    });

  it("tells every client when a request is answered from one of them", async () => {
    const send = vi.fn();
    registerEventSink({ kind: "test", send });

    const promise = request("answered");
    handleToolApprovalResponse({ requestId: "answered", approved: true });

    await expect(promise).resolves.toMatchObject({ approved: true });
    expect(send).toHaveBeenCalledWith(
      CHANNELS.runs.toolApprovalResolved,
      { requestId: "answered" },
      { runId: "run-1" },
    );
  });

  it("tells every client when a run's requests are canceled on abort", async () => {
    const send = vi.fn();
    registerEventSink({ kind: "test", send });

    const a = request("a", "run-1");
    const b = request("b", "run-1");
    const other = request("other", "run-2");

    cancelPendingRequests("run-1");

    await expect(a).resolves.toMatchObject({ approved: false });
    await expect(b).resolves.toMatchObject({ approved: false });
    for (const requestId of ["a", "b"]) {
      expect(send).toHaveBeenCalledWith(
        CHANNELS.runs.toolApprovalResolved,
        { requestId },
        { runId: "run-1" },
      );
    }
    expect(listPendingApprovals().map((r) => r.requestId)).toEqual(["other"]);
    cancelPendingRequest("other");
    await other;
  });
});

describe("listPendingApprovals", () => {
  it("reports waiting requests with their expiry, oldest first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T10:00:00Z"));
    const now = Date.now();

    void requestToolApproval({
      requestId: "later",
      runId: "run-1",
      toolName: "Bash",
      kind: "tool_approval",
      timestamp: now + 5,
      autoResolutionMs: 1_000,
    });
    void requestToolApproval({
      requestId: "earlier",
      runId: "run-2",
      toolName: "AskUserQuestion",
      kind: "ask_user",
      question: "Which one?",
      timestamp: now,
    });

    const all = listPendingApprovals();
    expect(all.map((r) => r.requestId)).toEqual(["earlier", "later"]);
    expect(all[0]).toMatchObject({ kind: "ask_user", question: "Which one?" });
    expect(all[0].expiresAt).toBe(now + 5 * 60 * 1000); // broker default
    expect(all[1].expiresAt).toBe(now + 1_000); // provider-requested, under the cap

    expect(listPendingApprovals("run-1").map((r) => r.requestId)).toEqual(["later"]);
    expect(listPendingApprovals("run-none")).toEqual([]);
  });

  it("drops a request once it is answered, canceled, or times out", async () => {
    vi.useFakeTimers();
    const pending = (id: string, extra: Record<string, unknown> = {}) =>
      requestToolApproval({
        requestId: id,
        runId: "run-1",
        toolName: "Bash",
        kind: "tool_approval",
        timestamp: Date.now(),
        ...extra,
      });

    const answered = pending("answered");
    const canceled = pending("canceled");
    const expired = pending("expired", { autoResolutionMs: 500 });
    expect(listPendingApprovals()).toHaveLength(3);

    handleToolApprovalResponse({ requestId: "answered", approved: true });
    await expect(answered).resolves.toMatchObject({ approved: true });
    expect(listPendingApprovals().map((r) => r.requestId)).toEqual(["canceled", "expired"]);

    cancelPendingRequest("canceled");
    await expect(canceled).resolves.toMatchObject({ approved: false });
    expect(listPendingApprovals().map((r) => r.requestId)).toEqual(["expired"]);

    vi.advanceTimersByTime(500);
    await expect(expired).resolves.toMatchObject({ approved: false });
    expect(listPendingApprovals()).toEqual([]);
  });
});

describe("user-input-broker", () => {
  it("resolves and dismisses one provider-owned approval request", async () => {
    const send = vi.fn();
    const sink: EventSink = { kind: "test", send };
    registerEventSink(sink);

    const responsePromise = requestToolApproval({
      requestId: "request-1",
      runId: "run-1",
      toolName: "Bash",
      kind: "tool_approval",
      timestamp: Date.now(),
    });

    cancelPendingRequest("request-1");

    await expect(responsePromise).resolves.toEqual({
      requestId: "request-1",
      approved: false,
    });
    expect(send).toHaveBeenCalledWith(
      CHANNELS.runs.toolApprovalResolved,
      { requestId: "request-1" },
      { runId: "run-1" },
    );
  });
});
