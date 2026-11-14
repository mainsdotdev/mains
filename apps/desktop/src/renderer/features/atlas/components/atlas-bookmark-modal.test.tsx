// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Input } from "@/components/ui";
import { KeyboardShortcutsProvider } from "@/providers/keyboard-shortcuts-provider";
import { bindingsForKeyboardShortcuts } from "../../../../shared/keyboard-shortcuts";
import { openAtlasBookmark } from "../lib/bookmark-modal-bridge";
import { AtlasBookmarkModal } from "./atlas-bookmark-modal";

const mocks = vi.hoisted(() => ({
  accountId: "account" as string | null,
  save: vi.fn(), success: vi.fn(), getShortcuts: vi.fn(), suppress: vi.fn(),
  browserShortcut: undefined as undefined | ((payload: { action: string; shortcutId: string }) => void),
  transportListeners: new Set<() => void>(),
}));
vi.mock("../../../../shared/runtime-platform", () => ({ getRuntimeOS: () => "darwin" }));
vi.mock("@/lib/platform", () => ({ capabilities: { windowChrome: true, embeddedBrowser: true } }));
vi.mock("@/lib/redux/api", () => ({
  useGetAccountQuery: () => ({ currentData: mocks.accountId ? { id: mocks.accountId } : undefined }),
  useListCollectionsQuery: () => ({ data: [{ id: "project", name: "Research" }] }),
}));
vi.mock("@/lib/redux/api/atlasApi", () => ({
  useListAtlasTagsQuery: () => ({ data: [] }),
  useSaveAtlasBookmarkMutation: () => [mocks.save, { isLoading: false }],
}));
vi.mock("@/lib/transport", () => ({
  getTransport: () => "local",
  onTransportChange: (listener: () => void) => {
    mocks.transportListeners.add(listener);
    return () => mocks.transportListeners.delete(listener);
  },
}));
vi.mock("@/components/ui", async (original) => ({
  ...await original<typeof import("@/components/ui")>(), toast: { success: mocks.success },
}));

const chord = { code: "KeyB", key: "B", metaKey: true, shiftKey: true };
function Page() {
  const location = useLocation();
  return <><output data-testid="location">{location.pathname}{location.search}</output><Input aria-label="Composer" /></>;
}
async function setup(path = "/code") {
  const store = configureStore({ reducer: {
    backends: (state = { activeBackendId: "local" }, action) => action.type === "switch-backend" ? { activeBackendId: "remote" } : state,
  } });
  const content = () => <Provider store={store}><MemoryRouter initialEntries={[path]}>
    <KeyboardShortcutsProvider><AtlasBookmarkModal /><Page /></KeyboardShortcutsProvider>
  </MemoryRouter></Provider>;
  const view = render(content());
  await act(async () => {});
  return { store, refresh: () => view.rerender(content()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accountId = "account";
  mocks.transportListeners.clear();
  mocks.browserShortcut = undefined;
  mocks.save.mockReturnValue({ unwrap: async () => ({ id: "bookmark" }) });
  mocks.getShortcuts.mockResolvedValue({ success: true, data: { overrides: {}, bindings: bindingsForKeyboardShortcuts({}) } });
  vi.stubGlobal("api", {
    keyboardShortcuts: { get: mocks.getShortcuts },
    browser: {
      setSuppressed: mocks.suppress,
      onShortcut: (listener: typeof mocks.browserShortcut) => { mocks.browserShortcut = listener; return () => { mocks.browserShortcut = undefined; }; },
    },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("app-wide Atlas bookmark modal", () => {
  it.each(["/code/workspace", "/atlas", "/tasks", "/pulse", "/settings?section=atlas", "/plugins", "/bridge"])("opens from an editable field on %s without navigating", async (path) => {
    await setup(path);
    const composer = screen.getByRole("textbox", { name: "Composer" });
    composer.focus();
    fireEvent.keyDown(composer, chord);
    const url = screen.getByRole("textbox", { name: "URL" });
    await waitFor(() => expect(document.activeElement).toBe(url));
    expect(screen.getByTestId("location").textContent).toBe(path);
    fireEvent.keyDown(url, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(composer));
  });

  it("shares creation with library buttons and keeps the draft on repeated shortcuts", async () => {
    await setup("/atlas?project=project");
    act(() => openAtlasBookmark({ accountId: "account", collectionId: "project" }));
    const url = screen.getByRole("textbox", { name: "URL" });
    fireEvent.change(url, { target: { value: "https://example.com" } });
    fireEvent.keyDown(url, chord);
    act(() => openAtlasBookmark({ accountId: "account" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect((screen.getByRole("textbox", { name: "URL" }) as HTMLInputElement).value).toBe("https://example.com");
    fireEvent.submit(url.closest("form")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account", collectionId: "project", url: "https://example.com" }));
    expect(mocks.success).toHaveBeenCalledWith("Bookmark saved to Atlas");
    expect(screen.getByTestId("location").textContent).toBe("/atlas?project=project");
  });

  it("opens from the native browser shortcut and releases browser suppression on close", async () => {
    await setup();
    act(() => mocks.browserShortcut?.({ action: "app-shortcut", shortcutId: "app.saveBookmark" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mocks.suppress).toHaveBeenCalledWith(expect.any(String), true);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "URL" }), { key: "Escape" });
    expect(mocks.suppress).toHaveBeenLastCalledWith(expect.any(String), false);
  });

  it.each(["account", "backend", "transport"])("discards a draft when its %s changes", async (owner) => {
    const view = await setup();
    fireEvent.keyDown(window, chord);
    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), { target: { value: "https://example.com" } });
    act(() => {
      if (owner === "account") { mocks.accountId = "other"; view.refresh(); }
      if (owner === "backend") view.store.dispatch({ type: "switch-backend" });
      if (owner === "transport") mocks.transportListeners.forEach((listener) => listener());
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, chord);
    expect((screen.getByRole("textbox", { name: "URL" }) as HTMLInputElement).value).toBe("");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
