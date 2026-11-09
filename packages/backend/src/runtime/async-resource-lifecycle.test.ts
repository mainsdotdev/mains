import { afterEach, expect, it, vi } from "vitest";
import { createAsyncResourceLifecycle } from "./async-resource-lifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
afterEach(() => vi.useRealTimers());

it("claims a key before a reentrant load and keeps other keys independent", async () => {
  let repeated: Promise<unknown> | undefined;
  const load = vi.fn(async (key: string) => { if (key === "first") repeated = cache.read(key); return key; });
  const cache = createAsyncResourceLifecycle({ ttlMs: 1000, load });
  const result = await cache.read("first"); expect(await repeated).toEqual(result);
  await cache.read("second"); expect(load.mock.calls.map(([key]) => key)).toEqual(["first", "second"]);
});

it("reuses a fresh value, expires it at its boundary, and shares forced refreshes", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); const now = Date.now(); const refreshed = deferred<number>();
  const load = vi.fn().mockResolvedValueOnce(1).mockReturnValueOnce(refreshed.promise).mockResolvedValue(3);
  const cache = createAsyncResourceLifecycle<number>({ ttlMs: 1000, load });
  await cache.read(); await cache.read(); expect(load).toHaveBeenCalledOnce();
  const first = cache.read("", { force: true }), second = cache.read("", { force: true });
  await flush(); refreshed.resolve(2); await Promise.all([first, second]); expect(load).toHaveBeenCalledTimes(2);
  vi.setSystemTime(now + 1000); expect((await cache.read()).value).toBe(3); expect(load).toHaveBeenCalledTimes(3);
});

it("retains a stale value and measures retry cooldown from failed completion", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); const now = Date.now(); const failure = deferred<number>();
  const load = vi.fn().mockResolvedValueOnce(1).mockReturnValueOnce(failure.promise).mockResolvedValue(2);
  const cache = createAsyncResourceLifecycle<number>({ ttlMs: 1000, retryMs: 1000, load });
  const saved = await cache.read(); vi.setSystemTime(now + 1000);
  const pending = expect(cache.read()).rejects.toThrow("offline"); await flush();
  vi.setSystemTime(now + 5000); failure.reject(new Error("offline")); await pending;
  await expect(cache.read()).rejects.toThrow("offline"); expect(load).toHaveBeenCalledTimes(2); expect(cache.peek()).toBe(saved);
  expect((await cache.read("", { force: true })).value).toBe(2); expect(load).toHaveBeenCalledTimes(3);
});

it("returns a provider error DTO without replacing the last good snapshot or making it fresh", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); const now = Date.now();
  const load = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
  const publish = vi.fn();
  const cache = createAsyncResourceLifecycle<{ ok: boolean }>({ ttlMs: 1000, cacheIf: (value) => value.ok, load, publish });
  const good = await cache.read(); vi.setSystemTime(now + 1000);
  expect((await cache.read()).value.ok).toBe(false); expect(cache.peek()).toBe(good);
  expect((await cache.read()).value.ok).toBe(true); expect(load).toHaveBeenCalledTimes(3); expect(publish).toHaveBeenCalledTimes(2);
});

it("retires an old read immediately and cannot let its late completion replace the next flight", async () => {
  const old = deferred<number>(), next = deferred<number>();
  const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const cache = createAsyncResourceLifecycle<number>({ load });
  const retired = expect(cache.read()).rejects.toMatchObject({ name: "AbortError" }); await flush(); cache.invalidate(); await retired;
  const current = cache.read(); await flush(); old.resolve(1); await flush();
  const joined = cache.read(); next.resolve(2);
  expect((await current).value).toBe(2); expect((await joined).value).toBe(2); expect(load).toHaveBeenCalledTimes(2); expect(cache.peek()?.value).toBe(2);
});

it("does not cancel another consumer when one reader leaves", async () => {
  const native = deferred<number>(); const load = vi.fn(() => native.promise); const controller = new AbortController();
  const cache = createAsyncResourceLifecycle({ load });
  const left = expect(cache.read("", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  const remaining = cache.read(); await flush(); controller.abort(); await left;
  native.resolve(1); expect((await remaining).value).toBe(1); expect(load).toHaveBeenCalledOnce();
});

it("cancels unused preparation before native dispatch and permits a new reader", async () => {
  const load = vi.fn().mockResolvedValue(1); const cache = createAsyncResourceLifecycle<number>({ load });
  const controller = new AbortController(); const left = expect(cache.read("", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  controller.abort(); await left; await flush(); expect(load).not.toHaveBeenCalled();
  expect((await cache.read()).value).toBe(1); expect(load).toHaveBeenCalledOnce();
});

it("retains an explicitly admitted uncancellable request for a returning consumer", async () => {
  const native = deferred<number>(); const load = vi.fn((_key, context) => { context.retainUntilSettled(); return native.promise; });
  const cache = createAsyncResourceLifecycle<number>({ load }); const controller = new AbortController();
  const left = expect(cache.read("", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  await flush(); controller.abort(); await left;
  const returning = cache.read(); native.resolve(1); expect((await returning).value).toBe(1); expect(load).toHaveBeenCalledOnce();
});

it("orders publication after an older admitted write while retiring that write's memory result", async () => {
  const written = deferred<void>(); const effects: number[] = []; let value = 0;
  const publish = vi.fn(async (_key, snapshot) => { if (snapshot.value === 1) await written.promise; effects.push(snapshot.value); });
  const cache = createAsyncResourceLifecycle<number>({ load: async () => ++value, publish });
  const first = expect(cache.read()).rejects.toMatchObject({ name: "AbortError" }); await flush();
  cache.invalidate(); await first; const next = cache.read(); await flush(); expect(publish).toHaveBeenCalledOnce();
  written.resolve(); expect((await next).value).toBe(2); expect(effects).toEqual([1, 2]); expect(cache.peek()?.value).toBe(2);
});

it("disposes permanently, aborting readers without waiting for a non-cooperative source", async () => {
  const native = deferred<number>(); const publish = vi.fn(); const load = vi.fn(() => native.promise);
  const cache = createAsyncResourceLifecycle<number>({ ttlMs: 1000, load, publish });
  const retired = expect(cache.read()).rejects.toMatchObject({ name: "AbortError" }); await flush(); cache.dispose(); await retired;
  await expect(cache.read()).rejects.toMatchObject({ name: "AbortError" }); native.resolve(1); await flush();
  expect(publish).not.toHaveBeenCalled(); expect(cache.peek()).toBeUndefined(); expect(load).toHaveBeenCalledOnce();
});

it("uses a valid fresh seed once and rejects a future-dated seed", async () => {
  const prepare = vi.fn(async (key: string) => ({ value: 1, fetchedAt: Date.now() + (key === "future" ? 60_000 : 0) }));
  const load = vi.fn(async () => 2); const cache = createAsyncResourceLifecycle({ ttlMs: 1000, prepare, load });
  expect((await cache.read()).value).toBe(1); await cache.read(); expect(prepare).toHaveBeenCalledTimes(1); expect(load).not.toHaveBeenCalled();
  expect((await cache.read("future")).value).toBe(2); expect(load).toHaveBeenCalledOnce();
});
