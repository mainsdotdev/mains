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

  it("drops evicted runs' cursors and loaded flag (no truncated re-fetch)", () => {
    const cache = createRunCache();
    cache.touch("r0");
    cache.markLoaded("r0");
    cache.advanceCursors("r0", { artifactMaxId: 99, toolMaxMs: 5000 });
    // Push r0 out of the LRU.
    for (let i = 1; i <= MAX_RETAINED_RUNS; i++) cache.touch(`r${i}`);
    const cursors = cache.getDeltaCursors("r0");
    expect(cursors.isIncremental).toBe(false); // re-opening r0 will full-fetch
    expect(cursors.artifactSince).toBeUndefined();
    expect(cursors.toolSinceMs).toBeUndefined();
  });
});

describe("run cache — cursors", () => {
  it("returns a full-fetch signal for a never-loaded run", () => {
    const cache = createRunCache();
    expect(cache.getDeltaCursors("x")).toEqual({
      isIncremental: false,
      artifactSince: undefined,
      toolSinceMs: undefined,
    });
  });

  it("returns the delta cursors once loaded", () => {
    const cache = createRunCache();
    cache.touch("x");
    cache.markLoaded("x");
    cache.advanceCursors("x", { artifactMaxId: 12, toolMaxMs: 3000 });
    expect(cache.getDeltaCursors("x")).toEqual({
      isIncremental: true,
      artifactSince: 12,
      toolSinceMs: 3000,
    });
  });

  it("advances cursors monotonically (never moves backward)", () => {
    const cache = createRunCache();
    cache.touch("x");
    cache.markLoaded("x");
    cache.advanceCursors("x", { artifactMaxId: 10, toolMaxMs: 1000 });
    cache.advanceCursors("x", { artifactMaxId: 5, toolMaxMs: 500 }); // lower → ignored
    expect(cache.getDeltaCursors("x")).toMatchObject({ artifactSince: 10, toolSinceMs: 1000 });
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
    cache.advanceCursors("r", { artifactMaxId: 7 });
    cache.forget("r");
    expect(cache.getDeltaCursors("r").isIncremental).toBe(false);
    expect(cache.touch("other").has("r")).toBe(false);
  });

  it("clear resets cursors, loaded, LRU and finalized", () => {
    const cache = createRunCache();
    cache.touch("r");
    cache.markLoaded("r");
    cache.advanceCursors("r", { artifactMaxId: 3 });
    cache.markFinalized("r");
    cache.clear();
    expect(cache.getDeltaCursors("r").isIncremental).toBe(false);
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
