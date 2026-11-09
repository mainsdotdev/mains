// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MemoryRouter, useLocation } from "react-router-dom";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import workspaceReducer from "@/lib/redux/slices/workspaceSlice";
import { toast } from "@/components/ui";
import type { AppshotCapture } from "../../shared/appshots";
import type { ServiceResponse } from "@mains/contracts/service-response";
import { useAppshots } from "./use-appshots";
vi.mock("@/lib/platform", () => ({ useCapabilities: () => ({ appshots: true }) }));
const capture: AppshotCapture = { id: "capture-one", appName: "Safari", bundleIdentifier: "com.apple.Safari", windowTitle: "Docs", timestamp: "2026-11-09T00:00:00Z", screenshotPath: "/tmp/fake/appshot-one.png", screenshotCaptureName: "appshot-one.png", screenshotMimeType: "image/png", accessibilityText: "", accessibilityStatus: "permission-denied", accessibilityTruncated: false };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((finish) => { resolve = finish; }); return { promise, resolve }; }
const api = { consumePending: vi.fn(), acknowledge: vi.fn(), onCaptured: vi.fn(), onError: vi.fn() };
const captureListeners = new Set<(value: AppshotCapture) => void>();
const emitCapture = (value: AppshotCapture) => { for (const callback of [...captureListeners]) callback(value); };
let store: ReturnType<typeof createStore>;
function createStore() { return configureStore({ reducer: { workspace: workspaceReducer } }); }
function Wrapper({ children }: { children: ReactNode }) { return <StrictMode><Provider store={store}><MemoryRouter initialEntries={["/settings"]}>{children}</MemoryRouter></Provider></StrictMode>; }
beforeEach(() => {
  store = createStore(); api.consumePending.mockReset().mockResolvedValue({ success: true, data: [] }); api.acknowledge.mockReset().mockResolvedValue({ success: true, data: null });
  captureListeners.clear();
  api.onCaptured.mockReset().mockImplementation((callback: (value: AppshotCapture) => void) => { captureListeners.add(callback); return () => { captureListeners.delete(callback); }; }); api.onError.mockReset().mockReturnValue(() => {});
  vi.stubGlobal("api", { appshots: api }); vi.spyOn(toast, "success").mockImplementation(() => ""); vi.spyOn(toast, "error").mockImplementation(() => "");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("ignores a pending catch-up response after its receiver unmounts", async () => {
  const pending = deferred<ServiceResponse<AppshotCapture[]>>(); api.consumePending.mockReturnValue(pending.promise);
  const view = renderHook(() => { useAppshots(); return useLocation().pathname; }, { wrapper: Wrapper });
  view.unmount();
  await act(async () => { pending.resolve({ success: true, data: [capture] }); });
  expect(store.getState().workspace.contextItems).toEqual([]);
  expect(api.acknowledge).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
});

it("attaches once across live event and catch-up delivery and acknowledges both receipts", async () => {
  const pending = deferred<ServiceResponse<AppshotCapture[]>>(); api.consumePending.mockReturnValue(pending.promise);
  const view = renderHook(() => { useAppshots(); return useLocation().pathname; }, { wrapper: Wrapper });
  const receive = api.onCaptured.mock.calls.at(-1)![0] as (value: AppshotCapture) => void;
  await act(async () => { receive(capture); pending.resolve({ success: true, data: [capture] }); });
  expect(store.getState().workspace.contextItems).toHaveLength(1); expect(view.result.current).toBe("/code");
  expect(toast.success).toHaveBeenCalledOnce(); expect(api.acknowledge.mock.calls.every(([id]) => id === capture.id)).toBe(true);
});
it("leaves a retired mount's catch-up read unconsumed until a live receiver reads it", async () => {
  const old = deferred<ServiceResponse<AppshotCapture[]>>(), current = deferred<ServiceResponse<AppshotCapture[]>>();
  api.consumePending.mockReturnValue(old.promise);
  const previous = renderHook(useAppshots, { wrapper: Wrapper }); previous.unmount();
  api.consumePending.mockReturnValue(current.promise);
  renderHook(useAppshots, { wrapper: Wrapper });
  await act(async () => { old.resolve({ success: true, data: [capture] }); });
  expect(store.getState().workspace.contextItems).toEqual([]); expect(api.acknowledge).not.toHaveBeenCalled();
  await act(async () => { current.resolve({ success: true, data: [capture] }); });
  expect(store.getState().workspace.contextItems).toHaveLength(1); expect(api.acknowledge).toHaveBeenCalledWith(capture.id);
});
it("retries a failed acknowledgement without appending or presenting the capture twice", async () => {
  api.acknowledge.mockRejectedValueOnce(new Error("IPC disconnected"));
  renderHook(useAppshots, { wrapper: Wrapper });
  await act(async () => { emitCapture(capture); }); await act(async () => { emitCapture(capture); });
  expect(store.getState().workspace.contextItems).toHaveLength(1); expect(toast.success).toHaveBeenCalledOnce();
  expect(api.acknowledge).toHaveBeenCalledTimes(2);
});
it("retires already queued capture and error callbacks when their receiver unmounts", async () => {
  const view = renderHook(useAppshots, { wrapper: Wrapper });
  const receive = api.onCaptured.mock.calls.at(-1)![0] as (value: AppshotCapture) => void;
  const error = api.onError.mock.calls.at(-1)![0] as (value: string) => void;
  view.unmount(); act(() => { receive(capture); error("Obsolete error"); });
  expect(store.getState().workspace.contextItems).toEqual([]); expect(api.acknowledge).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled();
});
