// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useWorkspacePage } from "./use-workspace-page";
import type { RunEvent } from "../types";
import { McpAppToolOpenerProvider } from "@/hooks/use-mcp-app-tool-opener";
const mocks = vi.hoisted(() => ({ registerConversation: vi.fn(() => vi.fn()), openTool: vi.fn(), enabled: true }));
vi.mock("@/hooks/use-mcp-app-panel", () => ({ useMcpAppPanel: () => mocks.enabled ? mocks : null }));
import { useMcpAppConversation } from "./use-mcp-app-conversation";
const scope = { backendId: null, spaceId: "space-1", providerId: "codex", mode: "developer", workspaceId: "ws-1" };
const send = vi.fn();
function WithOpener({ children }: { children: ReactNode }) {
  return createElement(McpAppToolOpenerProvider, { openTool: mocks.openTool }, children);
}
function workspace(events: RunEvent[] = []) {
  return { ownerKey: "run-owner", contextParts: scope, composerRun: { id: "run-1" },
    handleExecute: send, currentEvents: events } as unknown as ReturnType<typeof useWorkspacePage>;
}
function event(status = "done", timestamp = Date.now(), overrides = {}): RunEvent {
  return { id: "tool-1", type: "tool_call", timestamp: new Date(timestamp), content: "Open canvas",
    metadata: { status, mcpApp: { server: "codex_apps", tool: "magicpath.open", resourceUri: "ui://magicpath", appName: "MagicPath" },
      input: '{"projectId":"123"}', output: JSON.stringify({ content: [], structuredContent: { projectId: "123" } }), ...overrides } };
}
beforeEach(() => { vi.clearAllMocks(); mocks.enabled = true; });
afterEach(cleanup);
describe("normal conversation to app panel binding", () => {
  it("binds the normal composer to app messages without another run runtime", () => {
    const hook = renderHook(() => useMcpAppConversation(workspace()), { wrapper: WithOpener });
    expect(mocks.registerConversation).toHaveBeenCalledWith({ scope, ownerKey: "run-owner", runId: "run-1", send });
    const unregister = mocks.registerConversation.mock.results[0].value;
    hook.unmount();
    expect(unregister).toHaveBeenCalledOnce();
  });
  it("opens a newly finished persisted tool in the panel once", () => {
    const hook = renderHook(({ events }) => useMcpAppConversation(workspace(events)), { wrapper: WithOpener, initialProps: { events: [] as RunEvent[] } });
    act(() => hook.rerender({ events: [event()] }));
    expect(mocks.openTool).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1", input: { projectId: "123" } }), true);
    act(() => hook.rerender({ events: [event()] }));
    expect(mocks.openTool).toHaveBeenCalledTimes(1);
  });
  it("does not open historical apps when reopening a transcript", () => {
    renderHook(() => useMcpAppConversation(workspace([event("done", Date.now() - 60000)])), { wrapper: WithOpener });
    expect(mocks.openTool).not.toHaveBeenCalled();
  });
  it("waits for completion and ignores failed results", () => {
    const hook = renderHook(({ events }) => useMcpAppConversation(workspace(events)), { wrapper: WithOpener, initialProps: { events: [event("running")] } });
    expect(mocks.openTool).not.toHaveBeenCalled();
    act(() => hook.rerender({ events: [event("done", Date.now(), { output: { isError: true } })] }));
    expect(mocks.openTool).not.toHaveBeenCalled();
    act(() => hook.rerender({ events: [event("completed")] }));
    expect(mocks.openTool).toHaveBeenCalledOnce();
  });
  it("relays fresh results from a floating window that has no local app panel", () => {
    mocks.enabled = false;
    const hook = renderHook(({ events }) => useMcpAppConversation(workspace(events)), { wrapper: WithOpener, initialProps: { events: [] as RunEvent[] } });
    act(() => hook.rerender({ events: [event()] }));
    expect(mocks.registerConversation).not.toHaveBeenCalled();
    expect(mocks.openTool).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1" }), true);
    act(() => hook.rerender({ events: [event()] }));
    expect(mocks.openTool).toHaveBeenCalledOnce();
  });
  it("does not open an app when no local or relayed opener is available", () => {
    mocks.enabled = false;
    renderHook(() => useMcpAppConversation(workspace([event()])));
    expect(mocks.openTool).not.toHaveBeenCalled();
  });
});
