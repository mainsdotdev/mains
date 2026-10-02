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
vi.mock("./mcp-app-workspace", () => ({ McpAppWorkspace: () => {
  useEffect(() => { mocks.mounts++; }, []);
  return <><iframe title="App canvas" /><div data-floating-chat-surface="">Floating chat</div></>;
} }));
import { McpAppPanel } from "./mcp-app-panel";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.mounts = 0;
  Object.assign(mocks.panel, { isOpen: true, isExpanded: false, chatVisible: true, chatMode: "input", width: 608 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("MCP app panel interactions", () => {
  it.each(["Expand MagicPath", "Close MagicPath", "Reload app"])("keeps the %s tooltip below the toolbar and away from the right edge", (label) => {
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
    fireEvent.click(screen.getByRole("button", { name: "Expand MagicPath" }));
    expect(mocks.panel.toggleExpanded).toHaveBeenCalledOnce();
    mocks.panel.isExpanded = true;
    rerender(<McpAppPanel />);
    expect(screen.getByTitle("App canvas")).toBe(frame);
    fireEvent.click(screen.getByRole("button", { name: "Restore MagicPath panel" }));
    expect(mocks.panel.toggleExpanded).toHaveBeenCalledTimes(2);
    mocks.panel.isExpanded = false;
    rerender(<McpAppPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Close MagicPath" }));
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

  it("exposes chat visibility and collapses details when clicking outside the floating chat", () => {
    Object.assign(mocks.panel, { isExpanded: true, chatMode: "details" });
    render(<McpAppPanel />);
    fireEvent.pointerDown(screen.getByText("Floating chat"));
    expect(mocks.panel.setChatMode).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Reload app" }));
    expect(mocks.panel.setChatMode).toHaveBeenCalledWith("input");
    const hideChat = screen.getByRole("button", { name: "Hide chat" });
    expect(hideChat.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(hideChat);
    expect(mocks.panel.setChatVisible).toHaveBeenCalledWith(false);
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
