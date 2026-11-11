import { describe, expect, it, vi } from "vitest";
import { createBridgeServiceLifecycle, type BridgeServiceScope } from "./bridge.service-lifecycle";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("Bridge service resource ownership", () => {
  it("retires callbacks before joining late startup and refuses a replacement until cleanup finishes", async () => {
    const lifecycle = createBridgeServiceLifecycle(), entered = deferred(), gate = deferred();
    let scope!: BridgeServiceScope;
    const release = vi.fn();
    const opening = lifecycle.start(async (lease) => { scope = lease; lease.defer(release); entered.resolve(); await gate.promise; });
    const cancelled = expect(opening).rejects.toThrow(/cancelled|canceled/);
    await entered.promise;
    const stopping = lifecycle.stop();
    expect(scope.current()).toBe(false);
    await expect(lifecycle.start(async () => {})).rejects.toThrow(/closing/);
    gate.resolve(); await cancelled; await stopping;
    expect(release).toHaveBeenCalledOnce();
    await lifecycle.start(async () => {});
    expect(scope.current()).toBe(false); await lifecycle.stop();
  });

  it("keeps failed release owned for retry and cannot reactivate through start", async () => {
    const lifecycle = createBridgeServiceLifecycle();
    const release = vi.fn().mockRejectedValueOnce(new Error("Native cleanup failed")).mockResolvedValue(undefined);
    await lifecycle.start(async (scope) => { scope.defer(release); });
    await expect(lifecycle.stop()).rejects.toThrow("Native cleanup failed");
    await expect(lifecycle.start(async () => {})).rejects.toThrow(/closing/);
    await lifecycle.stop(); expect(release).toHaveBeenCalledTimes(2);
    await lifecycle.start(async () => {}); await lifecycle.stop();
  });

  it("drains an admitted mutation while canceling queued and newly submitted work", async () => {
    const lifecycle = createBridgeServiceLifecycle(), gate = deferred(), entered = deferred();
    let released = false;
    await lifecycle.start(async (scope) => {
      scope.defer(() => { released = true; }); scope.defer(lifecycle.drain);
    });
    const admitted = lifecycle.run(async () => { entered.resolve(); await gate.promise; return "saved"; });
    await entered.promise;
    const queued = lifecycle.run(async () => "should not run");
    const rejected = expect(queued).rejects.toThrow(/closing|unavailable/);
    const closing = lifecycle.stop();
    await expect(lifecycle.run(async () => {})).rejects.toThrow(/closing|unavailable/);
    expect(released).toBe(false);
    gate.resolve(); expect(await admitted).toBe("saved"); await rejected; await closing;
    expect(released).toBe(true);
  });
});
