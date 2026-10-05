// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  panel: {
    document: { id: "document-1", app: { name: "MagicPath", tool: "magicpath.open_canvas" } },
    scope: { mode: "developer", workspaceId: "ws-1", collectionId: null },
    runId: "run-1", isOpen: true, isExpanded: false, width: 608,
    chatMode: "input", chatVisible: true,
    setWidth: vi.fn(), setChatMode: vi.fn(), setChatVisible: vi.fn(), setChatHost: vi.fn(),
    toggleExpanded: vi.fn(), newChat: vi.fn(), close: vi.fn(),
  },
  mounts: 0,
  teardown: null as (() => Promise<void>) | null,
}));
vi.mock("@/hooks/use-mcp-app-panel", () => ({ useMcpAppPanel: () => mocks.panel }));
vi.mock("@/hooks/use-suppress-browser-view", () => ({ useSuppressBrowserView: vi.fn() }));
vi.mock("@/hooks/use-is-dark-mode", () => ({ useIsDarkMode: () => false }));
vi.mock("@/lib/redux/hooks", () => ({ useAppSelector: (selector: (state: unknown) => unknown) => selector({ appSettings: { sidebarCollapsed: false } }) }));
vi.mock("@/lib/redux/api", () => ({
  useListWorkspacesQuery: () => ({ data: [{ id: "ws-1", name: "website", rootPath: "/project/website" }] }),
  useGetAccountQuery: () => ({ data: { id: "account-1" } }),
  useGetCollectionQuery: () => ({ data: undefined }),
}));
vi.mock("@/components/layout/sidebar/mcp-app-icon", () => ({ McpAppIcon: () => <svg aria-hidden /> }));
vi.mock("./mcp-app-workspace", () => ({ McpAppWorkspace: ({ registerBeforeSuspend }: { registerBeforeSuspend: (callback: () => Promise<void>) => () => void }) => {
  useEffect(() => { mocks.mounts++; return mocks.teardown ? registerBeforeSuspend(mocks.teardown) : undefined; }, [registerBeforeSuspend]);
  return <><iframe title="App canvas" /><div data-floating-chat-surface="">Floating chat</div></>;
} }));
import { McpAppPanel, MCP_APP_IDLE_MS } from "./mcp-app-panel";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.mounts = 0;
  mocks.teardown = null;
  Object.assign(mocks.panel.document.app, { name: "MagicPath", tool: "magicpath.open_canvas" });
  Object.assign(mocks.panel, { isOpen: true, isExpanded: false, chatVisible: true, chatMode: "input", width: 608 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("MCP app panel interactions", () => {
  it("allows the app to save state before dropping its iframe", async () => {
    let saved!: () => void;
    mocks.teardown = vi.fn(() => new Promise<void>((resolve) => { saved = resolve; }));
    const view = render(<McpAppPanel />);
    act(() => vi.advanceTimersByTime(50));
    mocks.panel.isOpen = false;
    view.rerender(<McpAppPanel />);
    act(() => vi.advanceTimersByTime(MCP_APP_IDLE_MS));
    expect(mocks.teardown).toHaveBeenCalledOnce();
    expect(document.querySelector("iframe")).not.toBeNull();
    await act(async () => { saved(); });
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("releases a long-hidden app and reopens the same conversation", () => {
    const view = render(<McpAppPanel />);
    act(() => vi.advanceTimersByTime(50));
    const frame = screen.getByTitle("App canvas");
    mocks.panel.isOpen = false;
    view.rerender(<McpAppPanel />);
    act(() => vi.advanceTimersByTime(MCP_APP_IDLE_MS - 1));
    expect(document.querySelector("iframe")).toBe(frame);
    act(() => vi.advanceTimersByTime(1));
    expect(document.querySelector("iframe")).toBeNull();
    mocks.panel.isOpen = true;
    view.rerender(<McpAppPanel />);
    act(() => vi.advanceTimersByTime(50));
    expect(screen.getByTitle("App canvas")).not.toBe(frame);
    expect(mocks.panel.runId).toBe("run-1");
    expect(mocks.panel.newChat).not.toHaveBeenCalled();
  });

  it("cancels hibernation when reopened during the grace period", () => {
    const view = render(<McpAppPanel />);
    act(() => vi.advanceTimersByTime(50));
    const frame = screen.getByTitle("App canvas");
    mocks.panel.isOpen = false;
    view.rerender(<McpAppPanel />);
    act(() => vi.advanceTimersByTime(MCP_APP_IDLE_MS / 2));
    mocks.panel.isOpen = true;
    view.rerender(<McpAppPanel />);
    act(() => vi.advanceTimersByTime(MCP_APP_IDLE_MS));
    expect(screen.getByTitle("App canvas")).toBe(frame);
  });
  it("waits for the panel to become visible before mounting a new app, then retains it while hidden", () => {
    mocks.panel.isOpen = false;
    const view = render(<McpAppPanel />);
    act(() => vi.advanceTimersByTime(300));
    expect(mocks.mounts).toBe(0);
    expect(document.querySelector("iframe")).toBeNull();
    mocks.panel.isOpen = true;
    view.rerender(<McpAppPanel />);
    act(() => vi.advanceTimersByTime(50));
    const frame = screen.getByTitle("App canvas");
    expect(frame.closest("[data-mcp-app-panel]")?.getAttribute("data-mcp-app-panel-visible")).toBe("");
    expect(mocks.mounts).toBe(1);
    mocks.panel.isOpen = false;
    view.rerender(<McpAppPanel />);
    act(() => vi.advanceTimersByTime(300));
    expect(document.querySelector("iframe")).toBe(frame);
    expect(mocks.mounts).toBe(1);
  });

  it.each(["figma.open_canvas", "tldraw.open_canvas"])("keeps %s free of banners and floating chat, with only Reload when expanded", (tool) => {
    mocks.panel.document.app.tool = tool;
    const view = render(<McpAppPanel />);
    expect(screen.queryByRole("note", { name: "App compatibility" })).toBeNull();
    expect(mocks.panel.setChatHost).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Expand MagicPath" })).toBeTruthy();
    const frame = screen.getByTitle("App canvas");
    mocks.panel.isExpanded = true;
    view.rerender(<McpAppPanel />);
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(["Reload app"]);
    expect(mocks.panel.setChatHost).not.toHaveBeenCalled();
    expect(screen.getByTitle("App canvas")).toBe(frame);
    fireEvent.click(screen.getByRole("button", { name: "Reload app" }));
    expect(screen.getByTitle("App canvas")).not.toBe(frame);
    expect(mocks.panel.newChat).not.toHaveBeenCalled();
  });

  it("does not show an unsupported notice for other apps", () => {
    render(<McpAppPanel />);
    expect(screen.queryByRole("note", { name: "App compatibility" })).toBeNull();
    expect(mocks.panel.setChatHost).toHaveBeenCalledWith(expect.any(HTMLDivElement));
  });

  it.each(["hover", "focus"])("shows only the close tooltip on tab-button %s", (interaction) => {
    render(<McpAppPanel />);
    const close = screen.getByRole("button", { name: "Close MagicPath tab" });
    if (interaction === "hover") fireEvent.mouseEnter(close);
    else fireEvent.focus(close);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getAllByRole("tooltip").map((tooltip) => tooltip.textContent))
      .toEqual(["Close MagicPath tab"]);
  });

  it("switches between title and close tooltips while moving within the tab", () => {
    render(<McpAppPanel />);
    const title = screen.getByText("MagicPath");
    const close = screen.getByRole("button", { name: "Close MagicPath tab" });
    fireEvent.mouseEnter(title);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getAllByRole("tooltip").map((tooltip) => tooltip.textContent)).toEqual(["MagicPath"]);

    fireEvent.mouseLeave(title, { relatedTarget: close });
    fireEvent.mouseEnter(close, { relatedTarget: title });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getAllByRole("tooltip").map((tooltip) => tooltip.textContent)).toEqual(["Close MagicPath tab"]);

    fireEvent.mouseLeave(close, { relatedTarget: title });
    fireEvent.mouseEnter(title, { relatedTarget: close });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getAllByRole("tooltip").map((tooltip) => tooltip.textContent)).toEqual(["MagicPath"]);
  });

  it.each(["Expand MagicPath", "Reload app"])("keeps the %s tooltip below the toolbar and away from the right edge", (label) => {
    render(<McpAppPanel />);
    const button = screen.getByRole("button", { name: label });
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({ top: 10, bottom: 34, left: 576, right: 600, width: 24, height: 24 } as DOMRect);
    fireEvent.focus(button);
    act(() => vi.advanceTimersByTime(50));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe(label);
    expect(tooltip.style.top).toBe("42px");
    expect(tooltip.style.left).toBe("600px");
    expect(tooltip.style.transform).toBe("translate(-100%, 0)");
    expect(tooltip.parentElement).toBe(document.body);
  });

  it("keeps the app mounted when docking, expanding, closing and reopening; only Reload rebuilds it", () => {
    const { rerender } = render(<McpAppPanel />);
    act(() => vi.advanceTimersByTime(50));
    const frame = screen.getByTitle("App canvas");
    expect(screen.getByRole("tab", { name: "MagicPath" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand MagicPath" }));
    expect(mocks.panel.toggleExpanded).toHaveBeenCalledOnce();
    mocks.panel.isExpanded = true;
    rerender(<McpAppPanel />);
    expect(screen.queryByRole("tablist", { name: "App tabs" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "MagicPath" })).toBeNull();
    expect(screen.getByTitle("App canvas")).toBe(frame);
    fireEvent.click(screen.getByRole("button", { name: "Restore MagicPath panel" }));
    expect(mocks.panel.toggleExpanded).toHaveBeenCalledTimes(2);
    mocks.panel.isExpanded = false;
    rerender(<McpAppPanel />);
    expect(screen.getByRole("tab", { name: "MagicPath" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close MagicPath tab" }));
    expect(mocks.panel.close).toHaveBeenCalledOnce();
    mocks.panel.isOpen = false;
    rerender(<McpAppPanel />);
    expect(frame.closest("[data-mcp-app-panel]")?.hasAttribute("inert")).toBe(true);
    act(() => vi.advanceTimersByTime(300));
    expect(document.querySelector("iframe")).toBe(frame);
    mocks.panel.isOpen = true;
    rerender(<McpAppPanel />);
    act(() => vi.advanceTimersByTime(50));
    expect(screen.getByTitle("App canvas")).toBe(frame);
    expect(mocks.mounts).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Reload app" }));
    expect(screen.getByTitle("App canvas")).not.toBe(frame);
    expect(mocks.mounts).toBe(2);
    expect(mocks.panel.runId).toBe("run-1");
    expect(mocks.panel.newChat).not.toHaveBeenCalled();
  });

  it("keeps the expanded toolbar limited to reload and restore while collapsing details outside the floating chat", () => {
    Object.assign(mocks.panel, { isExpanded: true, chatMode: "details" });
    render(<McpAppPanel />);
    fireEvent.pointerDown(screen.getByText("Floating chat"));
    expect(mocks.panel.setChatMode).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Reload app" }));
    expect(mocks.panel.setChatMode).toHaveBeenCalledWith("input");
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(["Reload app", "Restore MagicPath panel"]);
  });

  it("supports keyboard resizing and restoring the browser-sized default", () => {
    render(<McpAppPanel />);
    const handle = screen.getByRole("separator", { name: "Resize app panel" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(mocks.panel.setWidth).toHaveBeenCalledWith(624);
    fireEvent.doubleClick(handle);
    expect(mocks.panel.setWidth).toHaveBeenLastCalledWith(608);
  });
});
