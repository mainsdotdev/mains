// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAutoUpdate } from "./use-auto-update";

const idle = { status: "idle", info: null, progress: null, error: null };
const downloaded = { ...idle, status: "downloaded", info: { version: "0.23.0" } };
const listeners = new Set<(state: any) => void>();
const status = vi.fn(), check = vi.fn(), install = vi.fn();
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function Wrapper({ children }: { children: ReactNode }) { return <StrictMode>{children}</StrictMode>; }
beforeEach(() => {
  status.mockReset().mockResolvedValue({ success: true, data: idle });
  check.mockReset().mockResolvedValue({ success: true, data: idle });
  install.mockReset().mockResolvedValue({ success: true, data: null }); listeners.clear();
  vi.stubGlobal("api", { updates: { getStatus: status, checkForUpdates: check, quitAndInstall: install,
    onStatusChange: (callback: (state: any) => void) => { listeners.add(callback); return () => listeners.delete(callback); } } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("does not let a delayed startup read overwrite a newer ready push", async () => {
  const read = deferred<any>(); status.mockReturnValue(read.promise);
  const view = renderHook(() => useAutoUpdate(), { wrapper: Wrapper });
  act(() => { for (const callback of listeners) callback(downloaded); });
  await act(async () => { read.resolve({ success: true, data: idle }); });
  expect(view.result.current.state).toEqual(downloaded);
});

it("subscribes before reading and preserves a push emitted during the status invoke", async () => {
  status.mockImplementation(() => {
    for (const callback of listeners) callback(downloaded);
    return Promise.resolve({ success: true, data: idle });
  });
  const view = renderHook(() => useAutoUpdate(), { wrapper: Wrapper });
  await act(async () => {});
  expect(view.result.current.state).toEqual(downloaded);
});

it("does not let a delayed check response overwrite a newer ready push", async () => {
  const pending = deferred<any>(); check.mockReturnValueOnce(pending.promise);
  const view = renderHook(() => useAutoUpdate(), { wrapper: Wrapper });
  await act(async () => {});
  let checking!: Promise<void>; act(() => { checking = view.result.current.check(); });
  act(() => { for (const callback of listeners) callback(downloaded); });
  await act(async () => { pending.resolve({ success: true, data: idle }); await checking; });
  expect(view.result.current.state).toEqual(downloaded);
});

it("retires reads and captured push callbacks on unmount without affecting a replacement", async () => {
  const pending = deferred<any>(); status.mockReturnValue(pending.promise);
  const old = renderHook(() => useAutoUpdate(), { wrapper: Wrapper });
  const callback = [...listeners][0]; old.unmount();
  expect(listeners.size).toBe(0);
  status.mockResolvedValue({ success: true, data: downloaded });
  const current = renderHook(() => useAutoUpdate(), { wrapper: Wrapper });
  await act(async () => { pending.resolve({ success: true, data: idle }); callback(idle); });
  expect(current.result.current.state).toEqual(downloaded);
  expect(listeners.size).toBe(1);
});

it("reports a rejected status read and recovers through an explicit check", async () => {
  status.mockRejectedValue(new Error("Status unavailable"));
  const view = renderHook(() => useAutoUpdate(), { wrapper: Wrapper });
  await act(async () => {});
  expect(view.result.current.state).toMatchObject({ status: "error", error: "Status unavailable" });
  check.mockResolvedValueOnce({ success: true, data: { ...idle, status: "checking" } });
  await act(async () => { await view.result.current.check(); });
  expect(view.result.current.state).toMatchObject({ status: "checking", error: null });
});

it("consumes rejected install replies while retaining the ready package", async () => {
  status.mockResolvedValue({ success: true, data: downloaded });
  install.mockRejectedValueOnce(new Error("Restart blocked"));
  const view = renderHook(() => useAutoUpdate(), { wrapper: Wrapper });
  await act(async () => {});
  await act(async () => { view.result.current.install(); });
  expect(view.result.current.state).toMatchObject({ status: "downloaded", info: downloaded.info, error: "Restart blocked" });
  await act(async () => { view.result.current.install(); });
  expect(install).toHaveBeenCalledTimes(2);
});

it("reports failed command envelopes without leaving an unhandled rejection", async () => {
  check.mockResolvedValueOnce({ success: false, error: "Check unavailable" });
  const view = renderHook(() => useAutoUpdate(), { wrapper: Wrapper });
  await act(async () => {});
  await act(async () => { await view.result.current.check(); });
  expect(view.result.current.state).toMatchObject({ status: "error", error: "Check unavailable" });
});

it("keeps updates on the local shell when the active backend changes", async () => {
  const { getTransport, setTransport } = await import("@/lib/transport");
  const original = getTransport(), invoke = vi.fn();
  try {
    setTransport({ ...original, kind: "remote", invoke });
    status.mockResolvedValue({ success: true, data: downloaded });
    const view = renderHook(() => useAutoUpdate(), { wrapper: Wrapper });
    await act(async () => {});
    await act(async () => { await view.result.current.check(); view.result.current.install(); });
    expect(status).toHaveBeenCalled(); expect(check).toHaveBeenCalledOnce(); expect(install).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
  } finally { setTransport(original); }
});
