import { configureStore } from "@reduxjs/toolkit";
import { describe, expect, it, vi } from "vitest";
import type { Transport } from "@/lib/transport/types";
import runQueueReducer, { enqueueRunMessage, removeRunMessage } from "@/lib/redux/slices/runQueueSlice";
import { createRunQueuePublisher } from "./run-queue-publisher";

function harness() {
  const store = configureStore({ reducer: { runQueue: runQueueReducer, backends: () => ({ activeBackendId: null }) } });
  const invoke = vi.fn<Transport["invoke"]>().mockResolvedValue({ success: true, data: null });
  let connection: ReturnType<Transport["status"]> = "connected";
  let transport: Transport = { kind: "test", status: () => connection, invoke, subscribe: () => () => {}, onStatusChange: () => () => {} };
  const publisher = createRunQueuePublisher({ getState: store.getState, getTransport: () => transport });
  const add = (id: string, backendId = "local") => store.dispatch(enqueueRunMessage({ ownerKey: backendId, backendId, runId: "run", runStatus: "running",
    message: { id, text: id, status: "queued", attachmentNames: ["/private/folder/photo.png"], contextItems: [], uploadOwnerKey: "private-upload", model: "private-model" } }));
  return { store, invoke, publisher, add, disconnect: () => { connection = "offline"; }, connect: () => { connection = "connected"; },
    replace: (next: Transport) => { transport = next; } };
}

describe("leased desktop queue metadata", () => {
  it("heartbeats unchanged queues, skips other backends and retries failed publications", async () => {
    const h = harness(); h.add("one"); h.add("another", "other-computer");
    h.invoke.mockResolvedValueOnce({ success: false, error: "Temporarily unavailable" });
    h.publisher.sync(); await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    h.publisher.sync(); await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(2));
    h.publisher.sync(); expect(h.invoke).toHaveBeenCalledTimes(2);
    h.publisher.sync(true); await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(3));
    const payloads = h.invoke.mock.calls.map(([, args]) => args![0] as any);
    expect(payloads.map(payload => payload.messages[0].id)).toEqual(["one", "one", "one"]);
    expect(payloads[0].messages[0]).toEqual({ id: "one", text: "one", status: "queued", attachmentNames: ["photo.png"] });
    expect(payloads[2].revision).toBeGreaterThan(payloads[1].revision);
    expect(new Set(payloads.map(payload => payload.producerId)).size).toBe(1);
    h.publisher.dispose();
  });

  it("publishes a removal after an in-flight write without republishing offline metadata", async () => {
    const h = harness(); h.add("one");
    let release!: (result: { success: true; data: null }) => void;
    h.invoke.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    h.publisher.sync();
    h.store.dispatch(removeRunMessage({ ownerKey: "local", id: "one" })); h.publisher.sync();
    expect(h.invoke).toHaveBeenCalledTimes(1);
    release({ success: true, data: null });
    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(2));
    expect(h.invoke.mock.calls[1][1]).toEqual([expect.objectContaining({ messages: [] })]);
    h.disconnect(); h.add("two"); h.publisher.sync(true);
    expect(h.invoke).toHaveBeenCalledTimes(2);
    h.connect(); h.publisher.sync(true);
    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(3));
    h.publisher.dispose();
  });

  it("retires the old transport's flush when the connection is replaced", async () => {
    const h = harness(); h.add("one");
    let release!: (result: { success: true; data: null }) => void;
    h.invoke.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    h.publisher.sync(); h.add("two"); h.publisher.sync();
    const nextInvoke = vi.fn<Transport["invoke"]>().mockResolvedValue({ success: true, data: null });
    h.replace({ kind: "replacement", status: () => "connected", invoke: nextInvoke, subscribe: () => () => {}, onStatusChange: () => () => {} });
    h.publisher.sync(); release({ success: true, data: null });
    await vi.waitFor(() => expect(nextInvoke).toHaveBeenCalledTimes(1));
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect((nextInvoke.mock.calls[0][1]![0] as any).messages.map((message: any) => message.id)).toEqual(["one", "two"]);
    h.publisher.dispose();
  });
});
