import { configureStore } from "@reduxjs/toolkit";
import { describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import type { Transport } from "@/lib/transport/types";
import runQueueReducer, {
  enqueueRunMessage, pauseRunQueue, beginRunMessageEdit, finishRunMessageEdit, reorderRunMessages, markRunMessageSending,
  type QueuedRunMessage,
} from "@/lib/redux/slices/runQueueSlice";
import { createRunQueueController } from "./run-queue-controller";
import { runOwnerKey } from "../../../../shared/ui-state-keys";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const state = { status: "running", backendId: null as string | null, accepted: false, connection: "connected" as ReturnType<Transport["status"]> };
  const store = configureStore({ reducer: {
    runQueue: runQueueReducer,
    backends: (_value = { activeBackendId: null as string | null }) => ({ activeBackendId: state.backendId }),
  } });
  const invoke = vi.fn(async (channel: string, _args?: unknown[]) => {
    if (channel === CHANNELS.runs.getById) return { success: true as const, data: { status: state.status } };
    if (channel === CHANNELS.account.get) return { success: true as const, data: { id: "account" } };
    if (channel === CHANNELS.runs.inputStatus) return { success: true as const, data: { accepted: state.accepted } };
    state.status = "running";
    return { success: true as const, data: { runId: "run", turnId: "active-turn" } };
  });
  const transport: Transport = { kind: "test", status: () => state.connection, invoke,
    subscribe: () => () => {}, onStatusChange: () => () => {} };
  const serializeUploads = vi.fn(async () => [{ name: "image.png", data: "pixels", type: "image", mimeType: "image/png" }]);
  const clearUploads = vi.fn();
  const controller = createRunQueueController({ getState: store.getState, dispatch: store.dispatch,
    getTransport: () => transport, serializeUploads, clearUploads });
  const ownerKey = runOwnerKey("local", "run");
  const add = (id: string, backendId = "local") => {
    const owner = runOwnerKey(backendId, "run");
    const message: QueuedRunMessage = { id, text: id, status: "queued", contextItems: [],
      uploadOwnerKey: `${owner}:${id}`, attachmentNames: ["image.png"], model: "chosen-model", additionalDirectories: ["/folder"] };
    store.dispatch(enqueueRunMessage({ ownerKey: owner, backendId, runId: "run", runStatus: "running", message }));
    return message;
  };
  const messages = () => store.getState().runQueue.byOwner[ownerKey]?.messages ?? [];
  const sends = () => invoke.mock.calls.filter(([channel]) => channel === CHANNELS.runs.continue || channel === CHANNELS.runs.steer);
  return { state, store, invoke, controller, ownerKey, add, messages, sends, serializeUploads, clearUploads };
}

describe("local run queue delivery", () => {
  it("delivers the reordered FIFO head with its own attachments", async () => {
    const h = harness(); h.add("first"); const second = h.add("second"); h.add("third");
    h.store.dispatch(reorderRunMessages({ ownerKey: h.ownerKey, orderedIds: ["second", "third", "first"] }));
    expect(h.messages().map((entry) => entry.id)).toEqual(["second", "third", "first"]);
    h.state.status = "succeeded";
    await h.controller.pump();
    expect(h.sends()[0][1]).toEqual([expect.objectContaining({ message: "second", clientUserMessageId: "second" })]);
    expect(h.serializeUploads).toHaveBeenCalledWith(second.uploadOwnerKey);
    expect(h.messages().map((entry) => entry.id)).toEqual(["third", "first"]);
  });

  it("uses the new FIFO head when reordered during a pending status read", async () => {
    const h = harness(); h.add("first"); h.add("second");
    const read = deferred<{ success: true; data: { status: string } }>();
    const normal = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation((channel, args) => channel === CHANNELS.runs.getById ? read.promise as any : normal(channel, args));
    const pending = h.controller.pump();
    h.store.dispatch(reorderRunMessages({ ownerKey: h.ownerKey, orderedIds: ["second", "first"] }));
    read.resolve({ success: true, data: { status: "succeeded" } });
    await pending;
    expect(h.sends()[0][1]).toEqual([expect.objectContaining({ message: "second" })]);
    expect(h.messages().map((entry) => entry.id)).toEqual(["first"]);
  });

  it("rejects stale, incomplete, and duplicate drops, and locks order during sending or editing", () => {
    const h = harness(); h.add("first"); h.add("second");
    for (const orderedIds of [["second"], ["second", "second"], ["second", "missing"]]) {
      h.store.dispatch(reorderRunMessages({ ownerKey: h.ownerKey, orderedIds }));
      expect(h.messages().map((entry) => entry.id)).toEqual(["first", "second"]);
    }
    h.add("third");
    h.store.dispatch(reorderRunMessages({ ownerKey: h.ownerKey, orderedIds: ["second", "first"] }));
    expect(h.messages().map((entry) => entry.id)).toEqual(["first", "second", "third"]);
    h.store.dispatch(markRunMessageSending({ ownerKey: h.ownerKey, id: "first", delivery: "queue" }));
    h.store.dispatch(reorderRunMessages({ ownerKey: h.ownerKey, orderedIds: ["third", "second", "first"] }));
    expect(h.messages().map((entry) => entry.id)).toEqual(["first", "second", "third"]);
    const editing = harness(); editing.add("first"); editing.add("second");
    editing.store.dispatch(beginRunMessageEdit({ ownerKey: editing.ownerKey, id: "first", backup: { text: "draft", contextItems: [], uploadOwnerKey: "backup", model: "", additionalDirectories: [] } }));
    editing.store.dispatch(reorderRunMessages({ ownerKey: editing.ownerKey, orderedIds: ["second", "first"] }));
    expect(editing.messages().map((entry) => entry.id)).toEqual(["first", "second"]);
  });

  it("waits for normal completion and sends FIFO once despite concurrent pushes/polls", async () => {
    const h = harness(); h.add("first"); h.add("second");
    await h.controller.pump();
    expect(h.sends()).toHaveLength(0);
    expect(h.serializeUploads).not.toHaveBeenCalled();
    h.state.status = "succeeded";
    h.controller.onStatus("local", "run", "succeeded");
    await Promise.all([h.controller.pump(), h.controller.pump(), h.controller.pump()]);
    expect(h.sends()).toHaveLength(1);
    expect(h.sends()[0][1]).toEqual([expect.objectContaining({ message: "first", clientUserMessageId: "first", model: "chosen-model" })]);
    expect(h.messages().map((message) => message.id)).toEqual(["second"]);
    await h.controller.pump();
    expect(h.sends()).toHaveLength(1);
    h.state.status = "succeeded";
    h.controller.onStatus("local", "run", "succeeded");
    await h.controller.pump();
    expect(h.sends()).toHaveLength(2);
    expect(h.messages()).toEqual([]);
  });

  it("steers a selected entry and keeps it plus its files until acceptance", async () => {
    const h = harness(); h.add("first"); const second = h.add("second");
    const ack = deferred<{ success: true; data: { turnId: string } }>();
    const normal = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation((channel, args) => channel === CHANNELS.runs.steer ? ack.promise as any : normal(channel, args));
    const sending = h.controller.send(h.ownerKey, "second", "steer");
    await vi.waitFor(() => expect(h.sends()).toHaveLength(1));
    expect(h.messages()[1]?.status).toBe("sending");
    expect(h.clearUploads).not.toHaveBeenCalled();
    const payload = h.sends()[0][1]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("model");
    expect(payload).not.toHaveProperty("additionalDirectories");
    await h.controller.send(h.ownerKey, "second", "steer");
    h.controller.remove(h.ownerKey, second);
    expect(h.messages()).toHaveLength(2);
    ack.resolve({ success: true, data: { turnId: "active-turn" } });
    await sending;
    expect(h.messages().map((message) => message.id)).toEqual(["first"]);
    expect(h.clearUploads).toHaveBeenCalledWith(second.uploadOwnerKey);
  });

  it("holds the FIFO head while it is edited without moving its position", async () => {
    const h = harness(); const first = h.add("first"); h.add("second");
    h.store.dispatch(beginRunMessageEdit({ ownerKey: h.ownerKey, id: "first", backup: { text: "draft", contextItems: [], uploadOwnerKey: "backup", model: "", additionalDirectories: [] } }));
    h.state.status = "succeeded";
    await h.controller.pump();
    expect(h.sends()).toHaveLength(0);
    h.store.dispatch(finishRunMessageEdit({ ownerKey: h.ownerKey, message: { ...first, text: "edited" } }));
    await h.controller.pump();
    expect(h.sends()[0][1]).toEqual([expect.objectContaining({ message: "edited", clientUserMessageId: "first" })]);
    expect(h.messages().map((message) => message.id)).toEqual(["second"]);
  });

  it("uses edits saved while the status preflight is waiting", async () => {
    const h = harness(); const first = h.add("first"); h.state.status = "succeeded";
    const read = deferred<{ success: true; data: { status: string } }>();
    const normal = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation((channel, args) => channel === CHANNELS.runs.getById ? read.promise as any : normal(channel, args));
    const pending = h.controller.pump();
    h.store.dispatch(beginRunMessageEdit({ ownerKey: h.ownerKey, id: "first", backup: { text: "draft", contextItems: [], uploadOwnerKey: "backup", model: "", additionalDirectories: [] } }));
    h.store.dispatch(finishRunMessageEdit({ ownerKey: h.ownerKey, message: { ...first, text: "latest edit" } }));
    read.resolve({ success: true, data: { status: "succeeded" } });
    await pending;
    expect(h.sends()[0][1]).toEqual([expect.objectContaining({ message: "latest edit" })]);
  });

  it("waits for session finalization when polling sees its terminal row early", async () => {
    const h = harness(); h.add("first"); h.state.status = "succeeded";
    const normal = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementationOnce(normal).mockImplementationOnce(normal)
      .mockImplementationOnce(async () => ({ success: false, error: "This conversation already has an active response." }) as any);
    await h.controller.pump();
    expect(h.messages()[0]?.status).toBe("queued");
    expect(h.store.getState().runQueue.byOwner[h.ownerKey].pauseReason).toBeUndefined();
    await h.controller.pump();
    expect(h.sends()).toHaveLength(1);
    h.controller.onStatus("local", "run", "succeeded");
    await h.controller.pump();
    expect(h.sends()).toHaveLength(2);
    expect(h.messages()).toEqual([]);
  });

  it("keeps Stop and failed runs paused until an explicit resume", async () => {
    const h = harness(); h.add("first"); h.add("second");
    h.store.dispatch(pauseRunQueue({ ownerKey: h.ownerKey, reason: "Stopped" }));
    h.state.status = "canceled";
    h.controller.onStatus("local", "run", "canceled");
    await h.controller.pump();
    expect(h.sends()).toHaveLength(0);
    await h.controller.resume(h.ownerKey);
    expect(h.sends()).toHaveLength(1);
    expect(h.store.getState().runQueue.byOwner[h.ownerKey].pauseReason).toBeUndefined();
    h.state.status = "failed";
    h.controller.onStatus("local", "run", "failed");
    await h.controller.pump();
    expect(h.sends()).toHaveLength(1);
    expect(h.messages()).toHaveLength(1);
  });

  it("does not deliver another backend's queue or switch transports mid-preparation", async () => {
    const h = harness(); h.add("remote-input", "remote");
    h.state.status = "succeeded";
    await h.controller.pump();
    expect(h.sends()).toHaveLength(0);
    h.add("local-input");
    h.serializeUploads.mockImplementation(async () => {
      h.state.backendId = "remote";
      h.store.dispatch({ type: "test/changeBackend" });
      return [];
    });
    await h.controller.pump();
    expect(h.sends()).toHaveLength(0);
    expect(h.messages()[0]?.status).toBe("error");
  });

  it("pauses inputs created offline and waits for an explicit resume after reconnection", async () => {
    const h = harness(); h.add("input"); h.state.status = "succeeded"; h.state.connection = "offline";
    await h.controller.pump();
    expect(h.store.getState().runQueue.byOwner[h.ownerKey].pauseReason).toContain("disconnected");
    h.state.connection = "connected";
    await h.controller.pump();
    expect(h.sends()).toHaveLength(0);
    await h.controller.resume(h.ownerKey);
    expect(h.messages()).toEqual([]);
  });

  it("reconciles uncertain delivery without retrying or discarding its input", async () => {
    const h = harness(); h.add("input");
    const normal = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation((channel, args) => channel === CHANNELS.runs.steer
      ? Promise.reject(new Error("RPC timeout: turn/steer")) : normal(channel, args));
    await h.controller.send(h.ownerKey, "input", "steer");
    expect(h.messages()[0]?.status).toBe("unknown");
    await h.controller.pump();
    await h.controller.resume(h.ownerKey);
    expect(h.sends()).toHaveLength(1);
    expect(h.messages()[0]?.status).toBe("unknown");
    h.state.accepted = true;
    await h.controller.resume(h.ownerKey);
    expect(h.messages()).toEqual([]);
    expect(h.sends()).toHaveLength(1);
  });
});
