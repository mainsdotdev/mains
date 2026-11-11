import { afterEach, describe, expect, it, vi } from "vitest";
import { createClaudeQueryLifecycle, createClaudeQueryPool } from "./claude-query-lifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(() => vi.useRealTimers());

describe("Claude query ownership", () => {
  it("shares SDK loading and retries a failed import", async () => {
    const lifecycle = createClaudeQueryLifecycle<string>();
    const failed = deferred<string>();
    const load = vi.fn(() => failed.promise);
    const first = lifecycle.load(load), second = lifecycle.load(load);
    const results = Promise.allSettled([first, second]);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    failed.reject(new Error("import failed"));
    expect((await results).map((result) => result.status)).toEqual(["rejected", "rejected"]);
    await expect(lifecycle.load(async () => "working SDK")).resolves.toBe("working SDK");
  });

  it("fences a late SDK load without overwriting the next generation", async () => {
    const lifecycle = createClaudeQueryLifecycle<string>();
    const sdk = deferred<string>();
    const old = expect(lifecycle.load(() => sdk.promise)).rejects.toThrow("shutdown");
    await lifecycle.shutdown();
    await expect(lifecycle.load(async () => "new SDK")).resolves.toBe("new SDK");
    sdk.resolve("old SDK"); await old;
    await expect(lifecycle.load(async () => "unused")).resolves.toBe("new SDK");
  });

  it("joins repeated release requests until the SDK confirms close", async () => {
    const lifecycle = createClaudeQueryLifecycle();
    const closed = deferred<void>();
    const close = vi.fn(() => closed.promise);
    const scope = lifecycle.open();
    scope.acquire(() => ({ close }));
    const closing = scope.close();
    expect(scope.close()).toBe(closing);
    expect(() => scope.acquire(() => ({ close }))).toThrow("closed");
    let released = false; void closing.then(() => { released = true; });
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
    expect(released).toBe(false);
    closed.resolve(); await closing;
    await scope.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("retains failed close ownership and blocks startup until shutdown is retried", async () => {
    const lifecycle = createClaudeQueryLifecycle();
    const close = vi.fn().mockRejectedValueOnce(new Error("close failed")).mockResolvedValue(undefined);
    const scope = lifecycle.open(); scope.acquire(() => ({ close }));
    const first = lifecycle.shutdown();
    expect(lifecycle.shutdown()).toBe(first);
    await expect(first).rejects.toThrow("retry shutdown");
    expect(() => lifecycle.open()).toThrow("shutting down");
    await lifecycle.shutdown();
    expect(close).toHaveBeenCalledTimes(2);
    await lifecycle.open().close();
  });

  it("retries failed resource cleanup without closing a released SDK query again", async () => {
    const lifecycle = createClaudeQueryLifecycle();
    const close = vi.fn();
    const release = vi.fn().mockImplementationOnce(() => { throw new Error("cleanup failed"); }).mockImplementation(() => {});
    const scope = lifecycle.open({ release }); scope.acquire(() => ({ close }));
    await expect(scope.close()).rejects.toThrow("cleanup failed");
    await lifecycle.shutdown();
    expect(close).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("settles pending control work on cancellation even if the SDK never answers", async () => {
    const lifecycle = createClaudeQueryLifecycle();
    const scope = lifecycle.open();
    const close = vi.fn(); scope.acquire(() => ({ close }));
    const response = scope.run(() => new Promise<never>(() => {}));
    const rejected = expect(response).rejects.toThrow("canceled");
    await Promise.resolve();
    await scope.cancel(); await rejected;
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("pins active MCP readers beyond idle expiry and starts expiry after the last reader", async () => {
    vi.useFakeTimers();
    const lifecycle = createClaudeQueryLifecycle();
    const close = vi.fn();
    const pool = createClaudeQueryPool({ open: lifecycle.open, capacity: 1, idleMs: 100,
      acquire: async (_key, scope) => scope.acquire(() => ({ close })),
    });
    const first = deferred<string>(), second = deferred<string>();
    const a = pool.use("cwd", () => first.promise);
    const b = pool.use("cwd", () => second.promise);
    await vi.advanceTimersByTimeAsync(1000);
    expect(close).toHaveBeenCalledTimes(0);
    first.resolve("a"); await a;
    await vi.advanceTimersByTimeAsync(1000);
    expect(close).toHaveBeenCalledTimes(0);
    second.resolve("b"); await b;
    await vi.advanceTimersByTimeAsync(99);
    expect(close).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(close).toHaveBeenCalledTimes(1);
    await lifecycle.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not evict an active MCP reader to open a different directory", async () => {
    const lifecycle = createClaudeQueryLifecycle();
    const close = vi.fn();
    const pool = createClaudeQueryPool({ open: lifecycle.open, capacity: 1, idleMs: 100,
      acquire: async (_key, scope) => scope.acquire(() => ({ close })),
    });
    const waiting = deferred<string>();
    const pending = pool.use("busy", () => waiting.promise);
    await Promise.resolve(); await Promise.resolve();
    await expect(pool.use("other", async () => "unused")).rejects.toThrow("busy");
    expect(close).toHaveBeenCalledTimes(0);
    waiting.resolve("done"); await pending;
    await expect(pool.use("other", async () => "opened")).resolves.toBe("opened");
    expect(close).toHaveBeenCalledTimes(1);
    await lifecycle.shutdown();
  });
});
