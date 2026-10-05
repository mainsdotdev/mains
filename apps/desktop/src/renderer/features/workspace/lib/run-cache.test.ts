import { describe, it, expect } from "vitest";
import { createRunCache, pruneRunMap, MAX_RETAINED_RUNS } from "./run-cache";

describe("run cache — LRU", () => {
  it("retains at most MAX_RETAINED_RUNS, evicting the oldest", () => {
    const cache = createRunCache();
    const ids = Array.from({ length: MAX_RETAINED_RUNS + 2 }, (_, i) => `r${i}`);
    let allowed = new Set<string>();
    for (const id of ids) allowed = cache.touch(id);
    expect(allowed.size).toBe(MAX_RETAINED_RUNS);
    expect(allowed.has("r0")).toBe(false); // oldest evicted
    expect(allowed.has(ids[ids.length - 1])).toBe(true); // newest kept
  });

  it("bumps an existing run to most-recent instead of duplicating it", () => {
    const cache = createRunCache();
    cache.touch("a");
    cache.touch("b");
    cache.touch("c");
    cache.touch("d");
    cache.touch("a"); // re-touch a → b is now the oldest
    const allowed = cache.touch("e"); // evict the oldest (b)
    expect(allowed.has("a")).toBe(true);
    expect(allowed.has("b")).toBe(false);
  });

  it("drops evicted runs' loaded flag so reopening fetches a new page", () => {
    const cache = createRunCache();
    cache.touch("r0");
    cache.markLoaded("r0");
    for (let i = 1; i <= MAX_RETAINED_RUNS; i++) cache.touch(`r${i}`);
    expect(cache.isLoaded("r0")).toBe(false);
  });
});

describe("run cache — completion", () => {
  it("allows another completion after delegation without dropping the loaded page", () => {
    const cache = createRunCache();
    cache.touch("voice");
    cache.markLoaded("voice");
    expect(cache.markFinalized("voice")).toBe(true);
    cache.markRunning("voice");
    expect(cache.isFinalized("voice")).toBe(false);
    expect(cache.isLoaded("voice")).toBe(true);
    expect(cache.markFinalized("voice")).toBe(true);
    expect(cache.markFinalized("voice")).toBe(false);
  });
});

describe("run cache — in-flight dedup", () => {
  it("admits one load and coalesces a concurrent request into a pending reload", () => {
    const cache = createRunCache();
    expect(cache.tryAcquireLoad("r")).toBe(true); // acquired
    expect(cache.tryAcquireLoad("r")).toBe(false); // already running → queued
    expect(cache.hasPending("r")).toBe(true);
    cache.clearPending("r");
    expect(cache.hasPending("r")).toBe(false);
    cache.releaseLoad("r");
    expect(cache.tryAcquireLoad("r")).toBe(true); // free again
  });
});

describe("run cache — finalized + forget + clear", () => {
  it("marks a run finalized exactly once", () => {
    const cache = createRunCache();
    expect(cache.isFinalized("r")).toBe(false);
    expect(cache.markFinalized("r")).toBe(true); // first
    expect(cache.isFinalized("r")).toBe(true);
    expect(cache.markFinalized("r")).toBe(false); // already
  });

  it("forget drops a run from the LRU and its bookkeeping", () => {
    const cache = createRunCache();
    cache.touch("r");
    cache.markLoaded("r");
    cache.forget("r");
    expect(cache.isLoaded("r")).toBe(false);
    expect(cache.touch("other").has("r")).toBe(false);
  });

  it("clear resets loaded, LRU and finalized", () => {
    const cache = createRunCache();
    cache.touch("r");
    cache.markLoaded("r");
    cache.markFinalized("r");
    cache.clear();
    expect(cache.isLoaded("r")).toBe(false);
    expect(cache.isFinalized("r")).toBe(false);
    expect(cache.touch("r2").has("r")).toBe(false);
  });
});

describe("pruneRunMap", () => {
  it("keeps allowed keys and returns the same ref when nothing changed", () => {
    const map = { a: 1, b: 2 };
    const same = pruneRunMap(map, new Set(["a", "b"]));
    expect(same).toBe(map);
    const pruned = pruneRunMap(map, new Set(["a"]));
    expect(pruned).toEqual({ a: 1 });
    expect(pruned).not.toBe(map);
  });
});
