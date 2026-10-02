// @vitest-environment jsdom
import { useEffect, type ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";
const mocks = vi.hoisted(() => ({ getState: vi.fn(), subscribe: vi.fn(), getById: vi.fn(), openExtension: vi.fn(), closeExtension: vi.fn(),
  workspaceId: "ws-1", mode: "developer", spaceId: "space-1", mounts: 0, sends: vi.fn() }));
vi.mock("@/lib/redux", () => ({ store: { getState: () => mocks.getState(), subscribe: (listener: () => void) => mocks.subscribe(listener) } }));
vi.mock("@/lib/transport", () => ({ appApi: { runs: { getById: mocks.getById } } }));
vi.mock("@/hooks/use-active-space", () => ({ useActiveSpace: () => ({ activeSpaceId: mocks.spaceId }) }));
vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ mode: mocks.mode }) }));
vi.mock("@/hooks/use-space-provider-variant", () => ({ useSpaceProviderVariant: () => ({ providerId: "codex" }) }));
vi.mock("@/hooks/use-mcp-app-extensions", () => ({ useMcpAppExtensions: () => ({ entries: [app] }) }));
vi.mock("@/features/workspace/hooks/use-workspace-data", () => ({ useWorkspaceData: () => ({ workspaceId: mocks.workspaceId }) }));
vi.mock("@/components/ui", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/features/workspace/components/tools/mcp-app-display", () => ({ McpAppDisplay: () => {
  useEffect(() => { mocks.mounts++; }, []);
  return <iframe title="test canvas" />;
} }));
import { McpAppPanelProvider, useMcpAppPanel } from "./use-mcp-app-panel";
import { McpAppWorkspace } from "@/features/workspace/components/mcp-app-workspace";
import workspaceReducer, { setComposerContextKey, setSelectedCollectionId, setMcpAppRunId } from "@/lib/redux/slices/workspaceSlice";
import settingsReducer from "@/lib/redux/slices/appSettingsSlice";
import { setBrowserPanelOpen, setSidebarCollapsed } from "@/lib/redux/slices/appSettingsSlice";
import { composerOwnerKey, mcpAppConversationKey } from "@/features/workspace/lib/ui-context";
import { buildRunContextPayload } from "@/features/workspace/lib/run-context-payload";
const app: McpAppEntrypoint = { id: "magicpath/account-1", name: "MagicPath", server: "codex_apps", tool: "magicpath.open_canvas",
  resourceUri: "ui://magicpath/canvas", connectorId: "connector-1", linkId: "account-1", entrypoints: ["global"], preferredModelDisplayMode: "fullscreen" };
const scope = () => ({ backendId: null, spaceId: mocks.spaceId, providerId: "codex", mode: mocks.mode,
  workspaceId: mocks.mode === "developer" ? mocks.workspaceId : undefined, collectionId: null as string | null });
function harness(initialPath = "/code/ws-1", previousPath?: string) {
  const state = configureStore({ reducer: { workspace: workspaceReducer, appSettings: settingsReducer,
    backends: () => ({ activeBackendId: null }) } });
  mocks.getState.mockImplementation(() => state.getState());
  mocks.subscribe.mockImplementation((listener: () => void) => state.subscribe(listener));
  let navigate!: ReturnType<typeof useNavigate>;
  let pathname!: string;
  const hook = renderHook(() => {
    navigate = useNavigate();
    pathname = useLocation().pathname;
    return useMcpAppPanel()!;
  }, { wrapper: ({ children }: { children: ReactNode }) =>
    <Provider store={state}><MemoryRouter initialEntries={previousPath ? [previousPath, initialPath] : [initialPath]}><McpAppPanelProvider>{children}<McpAppWorkspace /></McpAppPanelProvider></MemoryRouter></Provider> });
  return { ...hook, state, navigate: (path: string) => navigate(path), back: () => navigate(-1), get pathname() { return pathname; } };
}
async function openDraft(h: ReturnType<typeof harness>, collectionId: string | null = null) {
  const target = { ...scope(), collectionId };
  act(() => h.state.dispatch(setSelectedCollectionId(collectionId)));
  await act(async () => h.result.current.openGlobal(app));
  const ownerKey = composerOwnerKey(target, null);
  act(() => {
    h.state.dispatch(setComposerContextKey(ownerKey));
    h.result.current.registerConversation({ scope: target, ownerKey, send: mocks.sends });
  });
  return { target, ownerKey };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.workspaceId = "ws-1"; mocks.mode = "developer"; mocks.spaceId = "space-1"; mocks.mounts = 0;
  mocks.openExtension.mockResolvedValue({ success: true, data: { sessionId: "session-1", app, output: { content: [], _meta: { grant: "fixture-secret" } } } });
  mocks.closeExtension.mockResolvedValue({ success: true }); mocks.sends.mockResolvedValue("run-1");
  Object.defineProperty(window, "api", { configurable: true, value: { mcpApps: mocks } });
});
afterEach(cleanup);
describe("shared MCP App panel", () => {
  it("opens rail apps expanded with a normal draft and no model turn", async () => {
    const h = harness(); const { ownerKey } = await openDraft(h);
    expect(h.result.current.isExpanded).toBe(true);
    expect(h.state.getState().appSettings.sidebarCollapsed).toBe(true);
    expect(h.result.current.ownerKey).toBe(ownerKey);
    expect(h.state.getState().workspace.activeTab).toBe("new-run");
    expect(mocks.sends).not.toHaveBeenCalled();
  });
  it("keeps the sidebar closed while expanded and permits it again when docked or closed", async () => {
    const h = harness(); await openDraft(h);
    act(() => h.state.dispatch(setSidebarCollapsed(false)));
    expect(h.state.getState().appSettings.sidebarCollapsed).toBe(true);

    act(() => h.result.current.toggleExpanded());
    act(() => h.state.dispatch(setSidebarCollapsed(false)));
    expect(h.state.getState().appSettings.sidebarCollapsed).toBe(false);

    act(() => h.result.current.toggleExpanded());
    expect(h.state.getState().appSettings.sidebarCollapsed).toBe(true);

    act(() => h.result.current.close());
    act(() => h.state.dispatch(setSidebarCollapsed(false)));
    expect(h.state.getState().appSettings.sidebarCollapsed).toBe(false);
  });
  it("keeps the iframe and session through docking, expansion, close and reopening", async () => {
    const h = harness(); await openDraft(h);
    const frame = document.querySelector("iframe"); const id = h.result.current.document?.id;
    act(() => h.result.current.toggleExpanded());
    expect(h.result.current.isOpen).toBe(true); expect(h.result.current.isExpanded).toBe(false);
    act(() => h.result.current.toggleExpanded());
    act(() => h.result.current.close());
    await act(async () => h.result.current.openGlobal(app));
    expect(h.result.current.document?.id).toBe(id);
    expect(document.querySelector("iframe")).toBe(frame); expect(mocks.mounts).toBe(1);
    expect(mocks.openExtension).toHaveBeenCalledTimes(1); expect(mocks.closeExtension).not.toHaveBeenCalled();
    h.unmount(); expect(mocks.closeExtension).toHaveBeenCalledWith({ sessionId: "session-1" });
  });
  it("opens chat tools docked and keeps their original resource thread", () => {
    const h = harness(); const target = scope(); const ownerKey = composerOwnerKey(target, "run-1");
    act(() => { h.state.dispatch(setComposerContextKey(ownerKey));
      h.result.current.registerConversation({ scope: target, ownerKey, runId: "run-1", send: mocks.sends }); });
    act(() => h.result.current.openTool({ runId: "run-1", app, output: { content: [] }, title: app.name }, true));
    expect(h.result.current.isOpen).toBe(true); expect(h.result.current.isExpanded).toBe(false);
    expect(h.result.current.document?.resourceRunId).toBe("run-1");
    act(() => h.result.current.attachRun(ownerKey, "run-2", target));
    expect(h.result.current.document?.resourceRunId).toBe("run-1"); expect(h.result.current.runId).toBe("run-2");
  });
  it("routes a model tool result into the existing rail canvas without a second iframe", async () => {
    const h = harness(); const { target, ownerKey } = await openDraft(h);
    act(() => h.result.current.attachRun(ownerKey, "run-1", target));
    const runOwner = composerOwnerKey(target, "run-1");
    act(() => { h.state.dispatch(setComposerContextKey(runOwner));
      h.result.current.registerConversation({ scope: target, ownerKey: runOwner, runId: "run-1", send: mocks.sends }); });
    const frame = document.querySelector("iframe"); const id = h.result.current.document?.id;
    act(() => h.result.current.openTool({ runId: "run-1", app: { ...app, originCallId: "new-call" }, input: { projectId: "123" },
      output: { content: [], structuredContent: { projectId: "123" } }, title: "MagicPath" }, true));
    expect(h.result.current.isExpanded).toBe(true); expect(h.result.current.document?.id).toBe(id);
    expect(h.result.current.document?.input).toEqual({ projectId: "123" });
    expect(document.querySelector("iframe")).toBe(frame); expect(mocks.mounts).toBe(1);
  });
  it("expands with the compact composer and restores it when reopening a rail app", async () => {
    const h = harness(); await openDraft(h);
    act(() => { h.result.current.setChatMode("details"); h.result.current.toggleExpanded(); });
    act(() => { h.result.current.setChatVisible(false); h.result.current.toggleExpanded(); });
    expect(h.result.current.isExpanded).toBe(true);
    expect(h.result.current.chatMode).toBe("input");
    expect(h.result.current.chatVisible).toBe(true);
    act(() => { h.result.current.setChatMode("details"); h.result.current.close(); });
    await act(async () => h.result.current.openGlobal(app));
    expect(h.result.current.chatMode).toBe("input");
    expect(mocks.openExtension).toHaveBeenCalledTimes(1);
  });
  it("opens a closed app from a chat result docked even when it was previously expanded", async () => {
    const h = harness(); const { target, ownerKey } = await openDraft(h);
    act(() => h.result.current.attachRun(ownerKey, "run-1", target));
    const runOwner = composerOwnerKey(target, "run-1");
    act(() => { h.state.dispatch(setComposerContextKey(runOwner));
      h.result.current.registerConversation({ scope: target, ownerKey: runOwner, runId: "run-1", send: mocks.sends }); });
    const id = h.result.current.document?.id;
    act(() => h.result.current.close());
    act(() => h.result.current.openTool({ runId: "run-1", app, output: { content: [] }, title: "MagicPath" }));
    expect(h.result.current.isOpen).toBe(true);
    expect(h.result.current.isExpanded).toBe(false);
    expect(h.result.current.document?.id).toBe(id);
  });
  it("reveals the composer for New chat after the floating chat was hidden", async () => {
    const h = harness(); await openDraft(h);
    act(() => h.result.current.setChatVisible(false));
    act(() => h.result.current.newChat());
    expect(h.result.current.chatVisible).toBe(true);
    expect(h.result.current.chatMode).toBe("input");
    expect(mocks.sends).not.toHaveBeenCalled();
  });
  it.each(["work", "chat"])("starts %s app chats in the selected project without a filesystem workspace", async (mode) => {
    mocks.mode = mode;
    const h = harness(); await openDraft(h, "project-1");
    expect(h.result.current.scope).toMatchObject({ mode, collectionId: "project-1", workspaceId: undefined });
    await act(async () => h.result.current.sendMessage([{ type: "text", text: "Hello" }]));
    expect(mocks.sends).toHaveBeenCalledWith("Hello", undefined);
    expect(h.result.current.runId).toBe("run-1");
  });
  it("freezes a Code draft's workspace and uses the current workspace for New chat", async () => {
    const h = harness(); await openDraft(h);
    mocks.workspaceId = "ws-2"; h.rerender();
    expect(h.result.current.scope?.workspaceId).toBe("ws-1");
    act(() => h.result.current.newChat());
    expect(h.result.current.scope?.workspaceId).toBe("ws-2");
    expect(h.result.current.runId).toBeUndefined(); expect(mocks.openExtension).toHaveBeenCalledTimes(1);
  });
  it("uses the remembered run's workspace when opening an app again", async () => {
    const h = harness(); const target = scope();
    act(() => h.state.dispatch(setMcpAppRunId({ key: mcpAppConversationKey(target, app.id), runId: "old-run" })));
    mocks.getById.mockResolvedValue({ success: true, data: { id: "old-run", providerId: "codex", spaceId: "space-1", mode: "developer", workspaceId: "original-ws", collectionId: null } });
    await act(async () => h.result.current.openGlobal(app));
    expect(h.result.current.runId).toBe("old-run"); expect(h.result.current.scope?.workspaceId).toBe("original-ws");
    expect(h.state.getState().workspace.pendingRunId).toBe("old-run");
  });
  it("rejects a message after leaving its conversation instead of retargeting it", async () => {
    const h = harness(); await openDraft(h);
    act(() => h.result.current.registerConversation({ scope: { ...scope(), workspaceId: "other" }, ownerKey: "other-owner", send: mocks.sends }));
    await act(async () => expect(h.result.current.sendMessage([{ type: "text", text: "Do something" }])).rejects.toThrow("conversation"));
    expect(mocks.sends).not.toHaveBeenCalled();
  });
  it("blocks duplicate app sends before React renders the in-flight state", async () => {
    const h = harness(); await openDraft(h); let finish!: (value: string) => void;
    mocks.sends.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    let first!: Promise<void>;
    await act(async () => { first = h.result.current.sendMessage([{ type: "text", text: "First" }]);
      await expect(h.result.current.sendMessage([{ type: "text", text: "Duplicate" }])).rejects.toThrow("current message"); });
    await act(async () => { finish("run-1"); await first; }); expect(mocks.sends).toHaveBeenCalledTimes(1);
  });
  it("keeps model context bounded and excludes authentication metadata", async () => {
    const h = harness(); await openDraft(h);
    await act(async () => h.result.current.updateModelContext({ content: [{ type: "text", text: "Canvas selected" }],
      structuredContent: { projectId: "123" }, _meta: { grant: "another-secret" } }));
    const payload = buildRunContextPayload([...h.state.getState().workspace.contextItems, ...h.result.current.appContext(h.result.current.ownerKey!)]);
    expect(JSON.stringify(payload)).toContain("Canvas selected"); expect(JSON.stringify(payload)).not.toContain("secret");
    h.unmount(); expect(h.state.getState().workspace.contextItems).toEqual([]);
  });
  it("closes a late opening app without replacing a newer app", async () => {
    const h = harness(); let finish!: (result: unknown) => void;
    mocks.openExtension.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let first!: Promise<void>; act(() => { first = h.result.current.openGlobal(app); });
    const second = { ...app, id: "other-app", name: "Other" };
    mocks.openExtension.mockResolvedValue({ success: true, data: { sessionId: "session-2", app: second, output: { content: [] } } });
    await act(async () => h.result.current.openGlobal(second));
    await act(async () => { finish({ success: true, data: { sessionId: "late-session", app, output: { content: [] } } }); await first; });
    expect(h.result.current.document?.app.id).toBe("other-app");
    expect(mocks.closeExtension).toHaveBeenCalledWith({ sessionId: "late-session" });
  });
  it("does not navigate into a departing space after an app finishes opening", async () => {
    const h = harness(); let finish!: (result: unknown) => void;
    mocks.openExtension.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let opening!: Promise<void>; act(() => { opening = h.result.current.openGlobal(app); });
    mocks.spaceId = "another-space"; h.rerender();
    await act(async () => { finish({ success: true, data: { sessionId: "departing-session", app, output: { content: [] } } }); await opening; });
    expect(h.result.current.document).toBeNull();
    expect(mocks.closeExtension).toHaveBeenCalledWith({ sessionId: "departing-session" });
  });
  it("releases a late connection when the user leaves the app loading page", async () => {
    const h = harness("/apps/magicpath"); let finish!: (result: unknown) => void;
    mocks.openExtension.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let opening!: Promise<void>; act(() => { opening = h.result.current.openGlobal(app); });
    act(() => h.navigate("/plugins"));
    await act(async () => { finish({ success: true, data: { sessionId: "abandoned-session", app, output: { content: [] } } }); await opening; });
    expect(h.pathname).toBe("/plugins");
    expect(h.result.current.document).toBeNull();
    expect(h.result.current.opening).toBeNull();
    expect(mocks.closeExtension).toHaveBeenCalledWith({ sessionId: "abandoned-session" });
  });
  it("replaces the loading route so Back does not reopen the app", async () => {
    const h = harness("/apps/magicpath", "/plugins");
    await act(async () => h.result.current.openGlobal(app));
    expect(h.pathname).toBe("/code/ws-1");
    act(() => h.back());
    expect(h.pathname).toBe("/plugins");
  });
  it("does not start a connection after leaving during a remembered conversation lookup", async () => {
    const h = harness("/apps/magicpath"); let finish!: (result: unknown) => void;
    act(() => h.state.dispatch(setMcpAppRunId({ key: mcpAppConversationKey(scope(), app.id), runId: "old-run" })));
    mocks.getById.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let opening!: Promise<void>; act(() => { opening = h.result.current.openGlobal(app); });
    act(() => h.navigate("/plugins"));
    await act(async () => {
      finish({ success: true, data: { id: "old-run", providerId: "codex", spaceId: "space-1", mode: "developer", workspaceId: "ws-1" } });
      await opening;
    });
    expect(h.pathname).toBe("/plugins");
    expect(h.result.current.document).toBeNull();
    expect(mocks.openExtension).not.toHaveBeenCalled();
  });
  it("gives the right edge to the browser without disposing the app connection", async () => {
    const h = harness(); await openDraft(h);
    act(() => h.state.dispatch(setBrowserPanelOpen(true)));
    expect(h.result.current.isOpen).toBe(false);
    expect(mocks.closeExtension).not.toHaveBeenCalled();
    act(() => h.state.dispatch(setBrowserPanelOpen(false)));
    expect(h.result.current.isOpen).toBe(false);
  });
});
