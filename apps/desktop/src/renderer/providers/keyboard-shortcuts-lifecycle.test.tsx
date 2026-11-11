// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bindingsForKeyboardShortcuts, type KeyboardShortcutOverrides } from "../../shared/keyboard-shortcuts";
import { KeyboardShortcutsProvider, useKeyboardShortcuts, type KeyboardShortcutsStatus } from "./keyboard-shortcuts-provider";
import type { ServiceResponse } from "@mains/contracts/service-response";
vi.mock("@/lib/platform", () => ({ capabilities: { windowChrome: true, embeddedBrowser: false } }));
function status(overrides: KeyboardShortcutOverrides = {}): KeyboardShortcutsStatus { return { overrides, bindings: bindingsForKeyboardShortcuts(overrides) }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((finish) => { resolve = finish; }); return { promise, resolve }; }
const api = { get: vi.fn(), update: vi.fn(), resetAll: vi.fn() };
function Wrapper({ children }: { children: ReactNode }) { return <StrictMode><KeyboardShortcutsProvider>{children}</KeyboardShortcutsProvider></StrictMode>; }
beforeEach(() => { api.get.mockReset().mockResolvedValue({ success: true, data: status() }); api.update.mockReset().mockResolvedValue({ success: true, data: status({ "app.newItem": null }) }); api.resetAll.mockReset().mockResolvedValue({ success: true, data: status() }); vi.stubGlobal("api", { keyboardShortcuts: api }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("does not overwrite a confirmed edit with a late initial read", async () => {
  const initial = deferred<ServiceResponse<KeyboardShortcutsStatus>>(); api.get.mockReturnValue(initial.promise);
  const view = renderHook(useKeyboardShortcuts, { wrapper: Wrapper });
  await act(async () => { await view.result.current.update("app.newItem", null); });
  await act(async () => { initial.resolve({ success: true, data: status() }); });
  expect(view.result.current.overrides).toEqual({ "app.newItem": null });
  expect(view.result.current.isLoading).toBe(false);
});

it("serializes renderer writes and reset before publishing their confirmed snapshots", async () => {
  const write = deferred<ServiceResponse<KeyboardShortcutsStatus>>(); api.update.mockReturnValueOnce(write.promise);
  const view = renderHook(useKeyboardShortcuts, { wrapper: Wrapper }); await act(async () => {});
  let editing!: Promise<void>, resetting!: Promise<void>;
  await act(async () => { editing = view.result.current.update("app.newItem", null); resetting = view.result.current.resetAll(); });
  expect(api.update).toHaveBeenCalledOnce(); expect(api.resetAll).not.toHaveBeenCalled();
  await act(async () => { write.resolve({ success: true, data: status({ "app.newItem": null }) }); await Promise.all([editing, resetting]); });
  expect(view.result.current.overrides).toEqual({}); expect(api.resetAll).toHaveBeenCalledOnce();
});
it("does not send a queued renderer mutation after its provider has unmounted", async () => {
  const write = deferred<ServiceResponse<KeyboardShortcutsStatus>>(); api.update.mockReturnValueOnce(write.promise);
  const view = renderHook(useKeyboardShortcuts, { wrapper: Wrapper }); await act(async () => {});
  let editing!: Promise<unknown>, resetting!: Promise<unknown>;
  await act(async () => { editing = view.result.current.update("app.newItem", null).catch((error: unknown) => error); resetting = view.result.current.resetAll().catch((error: unknown) => error); });
  view.unmount(); await act(async () => { write.resolve({ success: true, data: status({ "app.newItem": null }) }); });
  expect(await editing).toBeInstanceOf(Error); expect(await resetting).toBeInstanceOf(Error); expect(api.resetAll).not.toHaveBeenCalled();
});
