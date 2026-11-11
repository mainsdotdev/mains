// @vitest-environment jsdom
import { useEffect, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  panel: { document: { id: "document-1", app: { name: "MagicPath", tool: "magicpath.open_canvas" } },
    scope: { mode: "developer", workspaceId: "ws-1", collectionId: null }, ownerKey: "owner",
    runId: "run-1", isOpen: true, isExpanded: false, chatMode: "input", chatVisible: true,
    setChatMode: vi.fn(), setChatHost: vi.fn(), newChat: vi.fn() },
  mounts: 0, teardown: null as (() => Promise<void>) | null,
}));
vi.mock("@/hooks/use-mcp-app-panel", () => ({
  useMcpAppPanel: () => mocks.panel, useMcpAppInstances: () => [mocks.panel],
  McpAppInstanceProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/redux/hooks", () => ({ useAppDispatch: () => vi.fn(), useAppSelector: (selector: (state: unknown) => unknown) =>
  selector({ workspace: { composerContextKey: "owner" } }) }));
vi.mock("./mcp-app-workspace", () => ({ McpAppWorkspace: ({ registerBeforeSuspend }: { registerBeforeSuspend: (callback: () => Promise<void>) => () => void }) => {
  useEffect(() => { mocks.mounts++; return mocks.teardown ? registerBeforeSuspend(mocks.teardown) : undefined; }, [registerBeforeSuspend]);
  return <><iframe title="App canvas" /><div data-floating-chat-surface="">Floating chat</div></>;
} }));
import { McpAppPanel, MCP_APP_IDLE_MS } from "./mcp-app-panel";
import { PreviewTabLifecycleProvider, usePreviewTabLifecycle } from "@/hooks/use-preview-tab-lifecycle";
function view() { return render(<MemoryRouter><McpAppPanel /></MemoryRouter>); }
function rerender(v: ReturnType<typeof view>) { v.rerender(<MemoryRouter><McpAppPanel /></MemoryRouter>); }
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); mocks.mounts = 0; mocks.teardown = null;
  Object.assign(mocks.panel.document.app, { tool: "magicpath.open_canvas" });
  Object.assign(mocks.panel, { isOpen: true, isExpanded: false, chatVisible: true, chatMode: "input" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("retained app tab content", () => {
  it("waits for the app's state save before hibernating its iframe", async () => {
    let saved!: () => void;
    mocks.teardown = vi.fn(() => new Promise<void>((resolve) => { saved = resolve; }));
    const v = view(); act(() => vi.advanceTimersByTime(50));
    mocks.panel.isOpen = false; rerender(v);
    act(() => vi.advanceTimersByTime(MCP_APP_IDLE_MS));
    expect(mocks.teardown).toHaveBeenCalledOnce();
    expect(document.querySelector("iframe")).not.toBeNull();
    await act(async () => saved());
    expect(document.querySelector("iframe")).toBeNull();
  });
  it("preserves its canvas across tab switches and docking; Reload alone rebuilds it", () => {
    const v = view(); act(() => vi.advanceTimersByTime(50)); const frame = screen.getByTitle("App canvas");
    mocks.panel.isOpen = false; rerender(v); act(() => vi.advanceTimersByTime(300));
    expect(document.querySelector("iframe")).toBe(frame);
    mocks.panel.isOpen = true; mocks.panel.isExpanded = true; rerender(v);
    expect(screen.getByTitle("App canvas")).toBe(frame);
    fireEvent.click(screen.getByRole("button", { name: "Reload app" }));
    expect(screen.getByTitle("App canvas")).not.toBe(frame);
    expect(mocks.panel.newChat).not.toHaveBeenCalled();
  });
  it("cancels hibernation when selected during its grace period", () => {
    const v = view(); act(() => vi.advanceTimersByTime(50)); const frame = screen.getByTitle("App canvas");
    mocks.panel.isOpen = false; rerender(v); act(() => vi.advanceTimersByTime(MCP_APP_IDLE_MS / 2));
    mocks.panel.isOpen = true; rerender(v); act(() => vi.advanceTimersByTime(MCP_APP_IDLE_MS));
    expect(screen.getByTitle("App canvas")).toBe(frame);
  });
  it("reopens a hibernated canvas in the same conversation", () => {
    const v = view(); act(() => vi.advanceTimersByTime(50)); const frame = screen.getByTitle("App canvas");
    mocks.panel.isOpen = false; rerender(v); act(() => vi.advanceTimersByTime(MCP_APP_IDLE_MS));
    expect(document.querySelector("iframe")).toBeNull();
    mocks.panel.isOpen = true; rerender(v); act(() => vi.advanceTimersByTime(50));
    expect(screen.getByTitle("App canvas")).not.toBe(frame);
    expect(mocks.panel.runId).toBe("run-1");
  });
  it("does not load a canvas before it is first selected", () => {
    mocks.panel.isOpen = false; const v = view(); act(() => vi.advanceTimersByTime(300));
    expect(mocks.mounts).toBe(0);
    mocks.panel.isOpen = true; rerender(v); act(() => vi.advanceTimersByTime(50));
    expect(mocks.mounts).toBe(1);
  });
  it("registers a save barrier for closing its own tab", async () => {
    mocks.teardown = vi.fn(async () => {});
    let lifecycle!: ReturnType<typeof usePreviewTabLifecycle>;
    function Consumer() { lifecycle = usePreviewTabLifecycle(); return null; }
    render(<MemoryRouter><PreviewTabLifecycleProvider><Consumer /><McpAppPanel /></PreviewTabLifecycleProvider></MemoryRouter>);
    await act(async () => lifecycle.prepareClose("document-1"));
    expect(mocks.teardown).toHaveBeenCalledOnce();
  });
  it("shares a pending idle save with explicit close and keeps close pending until it finishes", async () => {
    let saved!: () => void;
    mocks.teardown = vi.fn(() => new Promise<void>((resolve) => { saved = resolve; }));
    let lifecycle!: ReturnType<typeof usePreviewTabLifecycle>;
    function Consumer() { lifecycle = usePreviewTabLifecycle(); return null; }
    const ui = () => <MemoryRouter><PreviewTabLifecycleProvider><Consumer /><McpAppPanel /></PreviewTabLifecycleProvider></MemoryRouter>;
    const v = render(ui()); act(() => vi.advanceTimersByTime(50));
    mocks.panel.isOpen = false; v.rerender(ui());
    act(() => vi.advanceTimersByTime(MCP_APP_IDLE_MS));
    let closed = false;
    let closing!: Promise<void>;
    act(() => { closing = lifecycle.prepareClose("document-1").then(() => { closed = true; }); });
    expect(mocks.teardown).toHaveBeenCalledOnce();
    expect(closed).toBe(false);
    await act(async () => { saved(); await closing; });
    expect(closed).toBe(true);
  });
  it("retains the iframe after a shared save fails and allows close to retry", async () => {
    let fail!: (error: Error) => void;
    const teardown = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    mocks.teardown = teardown;
    let lifecycle!: ReturnType<typeof usePreviewTabLifecycle>;
    function Consumer() { lifecycle = usePreviewTabLifecycle(); return null; }
    const ui = () => <MemoryRouter><PreviewTabLifecycleProvider><Consumer /><McpAppPanel /></PreviewTabLifecycleProvider></MemoryRouter>;
    const v = render(ui()); act(() => vi.advanceTimersByTime(50));
    const frame = screen.getByTitle("App canvas");
    mocks.panel.isOpen = false; v.rerender(ui());
    act(() => vi.advanceTimersByTime(MCP_APP_IDLE_MS));
    const closing = lifecycle.prepareClose("document-1");
    const failed = expect(closing).rejects.toThrow("Save failed");
    await act(async () => { fail(new Error("Save failed")); await failed; });
    expect(document.querySelector("iframe")).toBe(frame);
    expect(teardown).toHaveBeenCalledOnce();
    teardown.mockResolvedValueOnce();
    await act(async () => lifecycle.prepareClose("document-1"));
    expect(teardown).toHaveBeenCalledTimes(2);
  });
  it("ignores an old idle save after Reload replaces the canvas", async () => {
    let saved!: () => void;
    mocks.teardown = vi.fn(() => new Promise<void>((resolve) => { saved = resolve; }));
    const v = view(); act(() => vi.advanceTimersByTime(50));
    mocks.panel.isOpen = false; rerender(v);
    act(() => vi.advanceTimersByTime(MCP_APP_IDLE_MS));
    mocks.panel.isOpen = true; rerender(v);
    fireEvent.click(screen.getByRole("button", { name: "Reload app" }));
    const replacement = screen.getByTitle("App canvas");
    await act(async () => saved());
    expect(screen.getByTitle("App canvas")).toBe(replacement);
    expect(mocks.mounts).toBe(2);
  });
  it("rebuilds the same conversation when selected before idle teardown finishes", async () => {
    let saved!: () => void;
    mocks.teardown = vi.fn(() => new Promise<void>((resolve) => { saved = resolve; }));
    const v = view(); act(() => vi.advanceTimersByTime(50));
    const original = screen.getByTitle("App canvas");
    mocks.panel.isOpen = false; rerender(v);
    act(() => vi.advanceTimersByTime(MCP_APP_IDLE_MS));
    mocks.panel.isOpen = true; rerender(v);
    expect(screen.getByTitle("App canvas")).toBe(original);
    await act(async () => saved());
    expect(screen.getByTitle("App canvas")).not.toBe(original);
    expect(mocks.panel.runId).toBe("run-1");
    expect(mocks.panel.newChat).not.toHaveBeenCalled();
  });
  it.each(["figma.open_canvas", "tldraw.open_canvas"])("keeps unsupported %s free of floating chat", (tool) => {
    mocks.panel.document.app.tool = tool; view();
    expect(mocks.panel.setChatHost).not.toHaveBeenCalled();
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("collapses chat details only when interacting outside the floating chat", () => {
    Object.assign(mocks.panel, { isExpanded: true, chatMode: "details" }); view();
    fireEvent.pointerDown(screen.getByText("Floating chat")); expect(mocks.panel.setChatMode).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Reload app" })); expect(mocks.panel.setChatMode).toHaveBeenCalledWith("input");
  });
});
