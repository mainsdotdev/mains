import { afterEach, describe, expect, it, vi } from "vitest";
import { createBridgeConnectionLifecycle } from "./bridge.connection-lifecycle";

const page = { type: "records" as const, stream: "account" as const, records: [], next: 0, hasMore: false };
function fixture() {
  const dispose = vi.fn();
  const lifecycle = createBridgeConnectionLifecycle<object>({ isOpen: () => true, dispose, status: () => {} });
  const connect = (peer: object) => lifecycle.connect(async (scope) => { scope.bind(peer); scope.open(peer); return peer; });
  return { lifecycle, dispose, connect };
}
afterEach(() => vi.useRealTimers());

describe("Bridge connection RPC ownership", () => {
  it("retires every pending request and deadline when native send throws", async () => {
    vi.useFakeTimers(); const h = fixture(), peer = {};
    await h.connect(peer);
    const waiting = h.lifecycle.request(peer, "waiting", 1000, () => {});
    const throwing = h.lifecycle.request(peer, "throwing", 1000, () => { throw new Error("Partial native send"); });
    const result = await Promise.allSettled([waiting, throwing]);
    expect(result.map((entry) => entry.status)).toEqual(["rejected", "rejected"]);
    expect(h.dispose).toHaveBeenCalledExactlyOnceWith(peer);
    expect(vi.getTimerCount()).toBe(0);
    const replacement = {}; await h.connect(replacement);
    const response = h.lifecycle.request(replacement, "next", 1000, () => {});
    h.lifecycle.reply(replacement, "next", page);
    await expect(response).resolves.toEqual(page); h.lifecycle.close();
  });

  it("cannot settle or terminate replacement RPCs from old send callbacks or replies", async () => {
    vi.useFakeTimers(); const h = fixture(), old = {}, current = {};
    await h.connect(old);
    let sendFailed!: (error?: Error | null) => void;
    const previous = h.lifecycle.request(old, "same-id", 100, (callback) => { sendFailed = callback; });
    const rejected = expect(previous).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(100); await rejected;
    await h.connect(current);
    let settled = false;
    const replacement = h.lifecycle.request(current, "same-id", 1000, () => {}).then((reply) => { settled = true; return reply; });
    sendFailed(new Error("Old send failed late")); h.lifecycle.reply(old, "same-id", page);
    await Promise.resolve(); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(h.dispose.mock.calls.some(([peer]) => peer === current)).toBe(false);
    h.lifecycle.reply(current, "same-id", page);
    await expect(replacement).resolves.toEqual(page); h.lifecycle.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});
