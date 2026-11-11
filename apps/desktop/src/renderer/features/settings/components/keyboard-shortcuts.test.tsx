// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KeyboardShortcutsProvider } from "@/providers/keyboard-shortcuts-provider";
import { bindingsForKeyboardShortcuts } from "../../../../shared/keyboard-shortcuts";
import { toast } from "@/components/ui";
import KeyboardShortcutsSettings from "./keyboard-shortcuts";
vi.mock("@/lib/platform", async (original) => ({ ...await original<any>(), capabilities: { windowChrome: true, embeddedBrowser: false } }));
vi.mock("../../../../shared/runtime-platform", () => ({ getRuntimeOS: () => "darwin" }));
const status = { overrides: {}, bindings: bindingsForKeyboardShortcuts({}) };
const api = { get: vi.fn(), update: vi.fn(), resetAll: vi.fn() };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((finish) => { resolve = finish; }); return { promise, resolve }; }
function Wrapper({ children }: { children: ReactNode }) { return <StrictMode><KeyboardShortcutsProvider>{children}</KeyboardShortcutsProvider></StrictMode>; }
beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ success: true, data: status }); api.update.mockReset().mockResolvedValue({ success: true, data: status }); api.resetAll.mockReset().mockResolvedValue({ success: true, data: status });
  vi.stubGlobal("api", { keyboardShortcuts: api }); vi.spyOn(toast, "error").mockImplementation(() => ""); vi.spyOn(toast, "success").mockImplementation(() => "");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function record() { fireEvent.click(await screen.findByRole("button", { name: "Change Search Mains shortcut" })); return screen.getByRole("button", { name: "Press shortcut" }); }
it("admits only one binding write before a duplicate key event can rerender busy", async () => {
  const save = deferred<unknown>(); api.update.mockReturnValue(save.promise);
  render(<KeyboardShortcutsSettings />, { wrapper: Wrapper });
  const recorder = await record();
  try {
    await act(async () => {
      fireEvent.keyDown(recorder, { key: "k", code: "KeyK", metaKey: true, shiftKey: true });
      fireEvent.keyDown(recorder, { key: "l", code: "KeyL", metaKey: true, shiftKey: true });
    });
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith({ id: "app.commandMenu", binding: "Command+Shift+K" });
  } finally { await act(async () => { save.resolve({ success: true, data: status }); }); }
});

it.each([
  [{ key: "k", code: "KeyK" }, "Include a primary modifier"],
  [{ key: "q", code: "KeyQ", metaKey: true }, "reserved by the operating system"],
  [{ key: "n", code: "KeyN", metaKey: true }, "Already used by New item"],
])("keeps invalid or conflicting input in recording without persisting: %j", async (input, message) => {
  render(<KeyboardShortcutsSettings />, { wrapper: Wrapper }); const recorder = await record();
  fireEvent.keyDown(recorder, input);
  expect(screen.getByRole("alert").textContent).toContain(message); expect(api.update).not.toHaveBeenCalled();
});
it("ignores repeat/composition and Escape cancels without persisting", async () => {
  render(<KeyboardShortcutsSettings />, { wrapper: Wrapper }); const recorder = await record();
  fireEvent.keyDown(recorder, { key: "k", code: "KeyK", metaKey: true, shiftKey: true, repeat: true });
  fireEvent.keyDown(recorder, { key: "k", code: "KeyK", metaKey: true, shiftKey: true, isComposing: true });
  fireEvent.keyDown(recorder, { key: "Escape" });
  expect(api.update).not.toHaveBeenCalled(); expect(screen.queryByText("Press shortcut")).toBeNull();
});
it("deletes a binding once and keeps a failed save retryable in its original recorder", async () => {
  api.update.mockResolvedValueOnce({ success: false, error: "Disk unavailable" });
  render(<KeyboardShortcutsSettings />, { wrapper: Wrapper }); const recorder = await record();
  await act(async () => { fireEvent.keyDown(recorder, { key: "Delete" }); });
  expect(api.update).toHaveBeenCalledWith({ id: "app.commandMenu", binding: null });
  expect(screen.getByRole("alert").textContent).toBe("Disk unavailable");
  await act(async () => { fireEvent.keyDown(screen.getByRole("button", { name: "Press shortcut" }), { key: "k", code: "KeyK", metaKey: true, shiftKey: true }); });
  expect(api.update).toHaveBeenCalledTimes(2); expect(screen.queryByText("Press shortcut")).toBeNull();
});
it("admits one reset and retains confirmed bindings when reset fails", async () => {
  const configured = { overrides: { "app.commandMenu": null }, bindings: bindingsForKeyboardShortcuts({ "app.commandMenu": null }) };
  api.get.mockResolvedValue({ success: true, data: configured });
  const reset = deferred<unknown>(); api.resetAll.mockReturnValueOnce(reset.promise);
  render(<KeyboardShortcutsSettings />, { wrapper: Wrapper }); const button = await screen.findByRole("button", { name: "Reset all" });
  await act(async () => { fireEvent.click(button); fireEvent.click(button); }); expect(api.resetAll).toHaveBeenCalledOnce();
  await act(async () => { reset.resolve({ success: false, error: "Reset failed" }); });
  expect(toast.error).toHaveBeenCalledWith("Reset failed"); expect(screen.getByRole("button", { name: "Reset all" })).toBeDefined();
  await act(async () => { fireEvent.click(button); }); expect(toast.success).toHaveBeenCalledWith("Keyboard shortcuts reset");
});
it("does not publish a late binding-save error after the settings page unmounts", async () => {
  const save = deferred<unknown>(); api.update.mockReturnValueOnce(save.promise);
  const view = render(<KeyboardShortcutsSettings />, { wrapper: Wrapper }); const recorder = await record();
  await act(async () => { fireEvent.keyDown(recorder, { key: "k", code: "KeyK", metaKey: true, shiftKey: true }); });
  view.unmount(); await act(async () => { save.resolve({ success: false, error: "Old failure" }); });
  expect(toast.error).not.toHaveBeenCalled();
});
