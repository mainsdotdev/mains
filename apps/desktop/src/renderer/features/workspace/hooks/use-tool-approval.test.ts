// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import type { PendingApproval } from "@mains/contracts/runs";
import type { ServiceResponse } from "@mains/contracts/service-response";
import { resetTransport, setTransport } from "@/lib/transport/registry";
import type { Transport, TransportStatus } from "@/lib/transport/types";
import { useToolApproval } from "./use-tool-approval";

function request(requestId = "approval-1", runId = "run-1"): PendingApproval {
  return { requestId, runId, kind: "tool_approval", toolName: "Bash", timestamp: 1, expiresAt: Date.now() + 300_000 };
}

function backend() {
  let status: TransportStatus = "connected";
  const events = new Map<string, Set<(payload: unknown) => void>>();
  const statusListeners = new Set<(status: TransportStatus) => void>();
  const read = vi.fn(async (): Promise<PendingApproval[]> => []);
  const respond = vi.fn(async (_response: unknown): Promise<ServiceResponse<undefined>> => ({ success: true, data: undefined }));
  const transport: Transport = {
    kind: "test",
    invoke: vi.fn(async (channel: string, args?: unknown[]): Promise<ServiceResponse<unknown>> => {
      if (channel === CHANNELS.runs.listPendingApprovals) return { success: true, data: await read() };
      if (channel === CHANNELS.runs.toolApprovalResponse) return respond(args?.[0]);
      throw new Error(`Unexpected channel: ${channel}`);
    }),
    subscribe(channel, listener) {
      const listeners = events.get(channel) ?? new Set();
      events.set(channel, listeners);
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    status: () => status,
    onStatusChange(listener) {
      statusListeners.add(listener);
      return () => { statusListeners.delete(listener); };
    },
  };
  return {
    transport, read, respond,
    emit(channel: string, payload: unknown) { for (const listener of events.get(channel) ?? []) listener(payload); },
    connection(next: TransportStatus) { status = next; for (const listener of statusListeners) listener(next); },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const running = [{ id: "run-1", status: "running" }];
let source: ReturnType<typeof backend>;
beforeEach(() => { source = backend(); setTransport(source.transport); });
afterEach(() => { cleanup(); resetTransport(); vi.restoreAllMocks(); });

describe("pending tool approvals across navigation", () => {
  it("restores a still-pending card after leaving and reopening the page without a new push", async () => {
    source.read.mockResolvedValue([request()]);
    const first = renderHook(() => useToolApproval(running));
    await act(async () => {});
    expect(first.result.current.pendingApprovals.map((item) => item.requestId)).toEqual(["approval-1"]);
    first.unmount();

    const reopened = renderHook(() => useToolApproval(running));
    await act(async () => {});
    expect(reopened.result.current.pendingApprovals.map((item) => item.requestId)).toEqual(["approval-1"]);
  });

  it("keeps a pushed request while another workspace or an unloaded run list is visible", async () => {
    const view = renderHook(({ runs }) => useToolApproval(runs), { initialProps: { runs: running } });
    await act(async () => {});
    act(() => source.emit(CHANNELS.runs.toolApprovalRequest, request()));
    expect(view.result.current.pendingApprovals).toHaveLength(1);

    view.rerender({ runs: [{ id: "run-2", status: "running" }] });
    await act(async () => {});
    expect(view.result.current.pendingApprovals).toEqual([]);
    view.rerender({ runs: [] });
    await act(async () => {});
    view.rerender({ runs: running });
    expect(view.result.current.pendingApprovals.map((item) => item.requestId)).toEqual(["approval-1"]);
  });

  it("restores requests received before the run list finishes loading and hides finished runs", async () => {
    source.read.mockResolvedValue([request()]);
    const view = renderHook(({ runs }) => useToolApproval(runs), { initialProps: { runs: [] as typeof running } });
    await act(async () => {});
    expect(view.result.current.pendingApprovals).toEqual([]);
    view.rerender({ runs: running });
    expect(view.result.current.pendingApprovals).toHaveLength(1);
    for (const status of ["succeeded", "failed", "canceled"]) {
      view.rerender({ runs: [{ id: "run-1", status }] });
      expect(view.result.current.pendingApprovals).toEqual([]);
    }
  });

  it("merges live requests with an in-flight snapshot without duplicates or resurrecting resolved cards", async () => {
    const snapshot = deferred<PendingApproval[]>();
    source.read.mockReturnValueOnce(snapshot.promise);
    const view = renderHook(() => useToolApproval(running));
    const live = { ...request("live"), timestamp: 3 };
    act(() => {
      source.emit(CHANNELS.runs.toolApprovalRequest, live);
      source.emit(CHANNELS.runs.toolApprovalRequest, live);
      source.emit(CHANNELS.runs.toolApprovalRequest, { ...request("pushed-after-read"), timestamp: 2 });
      source.emit(CHANNELS.runs.toolApprovalResolved, { requestId: "resolved" });
    });
    await act(async () => { snapshot.resolve([request("oldest"), request("resolved"), live]); });
    expect(view.result.current.pendingApprovals.map((item) => item.requestId)).toEqual(["oldest", "pushed-after-read", "live"]);
  });

  it("does not restore a card answered while its snapshot was in flight", async () => {
    const snapshot = deferred<PendingApproval[]>();
    source.read.mockReturnValueOnce(snapshot.promise);
    const view = renderHook(() => useToolApproval(running));
    act(() => source.emit(CHANNELS.runs.toolApprovalRequest, request()));
    await act(async () => { view.result.current.respond("approval-1", true, "acceptForSession"); });
    await act(async () => { snapshot.resolve([request()]); });
    expect(view.result.current.pendingApprovals).toEqual([]);
    expect(source.transport.invoke).toHaveBeenCalledWith(CHANNELS.runs.toolApprovalResponse,
      [{ requestId: "approval-1", approved: true, answer: "acceptForSession" }]);
  });

  it("reconciles requests and resolutions missed during disconnection", async () => {
    source.read.mockResolvedValue([request("old")]);
    const view = renderHook(() => useToolApproval(running));
    await act(async () => {});
    act(() => source.connection("reconnecting"));
    source.read.mockResolvedValue([request("new")]);
    await act(async () => source.connection("connected"));
    expect(view.result.current.pendingApprovals.map((item) => item.requestId)).toEqual(["new"]);
  });

  it("isolates backend changes and ignores the old backend's delayed snapshot", async () => {
    const oldSnapshot = deferred<PendingApproval[]>();
    source.read.mockReturnValueOnce(oldSnapshot.promise);
    const view = renderHook(() => useToolApproval(running));
    act(() => source.emit(CHANNELS.runs.toolApprovalRequest, request("old-live")));
    const remote = backend();
    remote.read.mockResolvedValue([request("remote")]);
    await act(async () => setTransport(remote.transport));
    await act(async () => oldSnapshot.resolve([request("old-snapshot")]));
    act(() => source.emit(CHANNELS.runs.toolApprovalRequest, request("old-late")));
    expect(view.result.current.pendingApprovals.map((item) => item.requestId)).toEqual(["remote"]);
  });

  it("retries a failed read on window focus and still accepts live requests", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    source.read.mockRejectedValueOnce(new Error("Disconnected"));
    const view = renderHook(() => useToolApproval(running));
    await act(async () => {});
    act(() => source.emit(CHANNELS.runs.toolApprovalRequest, request("live")));
    expect(view.result.current.pendingApprovals.map((item) => item.requestId)).toEqual(["live"]);
    source.read.mockResolvedValue([request("live"), request("missed")]);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(view.result.current.pendingApprovals.map((item) => item.requestId)).toEqual(["live", "missed"]);
    expect(warning).toHaveBeenCalledOnce();
  });

  it.each(["rejected", "failed response"])("keeps the card when answering fails with a %s", async (failure) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    source.read.mockResolvedValue([request()]);
    if (failure === "rejected") source.respond.mockRejectedValueOnce(new Error("Disconnected"));
    else source.respond.mockResolvedValueOnce({ success: false, error: "Disconnected" });
    const view = renderHook(() => useToolApproval(running));
    await act(async () => {});
    await act(async () => { view.result.current.respond("approval-1", true); });
    expect(view.result.current.pendingApprovals.map((item) => item.requestId)).toEqual(["approval-1"]);
    await act(async () => { view.result.current.respond("approval-1", false); });
    expect(view.result.current.pendingApprovals).toEqual([]);
  });

  it("ignores an older refresh finishing after a newer snapshot", async () => {
    const oldSnapshot = deferred<PendingApproval[]>();
    source.read.mockReturnValueOnce(oldSnapshot.promise);
    const view = renderHook(() => useToolApproval(running));
    source.read.mockResolvedValue([request("latest")]);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await act(async () => oldSnapshot.resolve([request("old")]));
    expect(view.result.current.pendingApprovals.map((item) => item.requestId)).toEqual(["latest"]);
  });

  it("unsubscribes on page exit and does not apply that page's delayed read", async () => {
    const oldSnapshot = deferred<PendingApproval[]>();
    source.read.mockReturnValueOnce(oldSnapshot.promise);
    const first = renderHook(() => useToolApproval(running));
    first.unmount();
    source.read.mockResolvedValue([request("current")]);
    const reopened = renderHook(() => useToolApproval(running));
    await act(async () => {});
    await act(async () => oldSnapshot.resolve([request("old")]));
    act(() => source.emit(CHANNELS.runs.toolApprovalResolved, { requestId: "current" }));
    expect(reopened.result.current.pendingApprovals).toEqual([]);
    expect(source.read).toHaveBeenCalledTimes(2);
  });
});
