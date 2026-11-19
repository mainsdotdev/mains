// @vitest-environment jsdom
import { configureStore } from "@reduxjs/toolkit";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import type { TerminalSession } from "@mains/contracts/terminal";
import { baseApi } from "@/lib/redux/api/baseApi";
import terminalReducer, { selectTerminal, terminalWorkspaceKey } from "@/lib/redux/slices/terminalSlice";
import appSettingsReducer, { setBottomTerminalOpen, setSessionPanelOpen } from "@/lib/redux/slices/appSettingsSlice";
import { resetTransport, setTransport, type Transport } from "@/lib/transport";
import { useModeConfig } from "@/hooks/use-mode-config";
import { useRunningServerSessions } from "./use-running-server-sessions";
import { SessionPanel } from "./session-panel";
import { SessionPanelTrigger } from "./session-panel-trigger";

vi.mock("@/hooks/use-panel-animation", () => ({
  usePanelAnimation: (open: boolean) => ({ isVisible: open, isAnimatedIn: open }),
}));
vi.mock("@/lib/platform", () => ({ useIsMobile: () => false }));
vi.mock("./git-actions", () => ({ GitActionsSection: () => null }));
vi.mock("./session-resources-section", () => ({
  SessionResourcesSection: () => <section aria-label="Sources"><h2>Sources</h2></section>,
}));
vi.mock("@/lib/redux/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/redux/api")>(),
  useListWorkspacesQuery: () => ({ data: [{ id: "a", projectId: "project", rootPath: "/repos/mains" }] }),
  useListProjectsQuery: () => ({ data: [{ id: "project", name: "mains" }] }),
}));

function session(id: string, workspaceId = "a", ports = [3000]): TerminalSession {
  return {
    id, workspaceId, workspaceName: workspaceId === "a" ? "Website" : "API", title: "Terminal 1",
    cwd: `/tmp/${workspaceId}`, status: "running", exitCode: null, createdAt: 1,
    servers: ports.map((port) => ({ pid: 10, port, command: "node" })),
  };
}
let sessions: TerminalSession[];
let spaces: { id: string; mode: string; isArchived?: boolean }[];
let activeSpaceId: string;
let testStore: ReturnType<typeof makeStore>;
const events = new Map<string, Set<(payload: unknown) => void>>();
const invoke = vi.fn();
const transport: Transport = {
  kind: "test", invoke, status: () => "connected", onStatusChange: () => () => {},
  subscribe(channel, callback) {
    let listeners = events.get(channel);
    if (!listeners) events.set(channel, listeners = new Set());
    listeners.add(callback);
    return () => listeners!.delete(callback);
  },
};
function changed() { for (const callback of events.get(CHANNELS.terminal.changed) ?? []) callback({}); }
function makeStore() {
  const result = configureStore({
    reducer: {
      [baseApi.reducerPath]: baseApi.reducer, terminal: terminalReducer, appSettings: appSettingsReducer,
      backends: () => ({ activeBackendId: null }), workspace: () => ({ activeWorkspaceId: "a", activeTab: "run-1", previousNonEditorTab: null }),
    },
    middleware: (defaults) => defaults().concat(baseApi.middleware),
  });
  result.dispatch(setSessionPanelOpen(true));
  return result;
}
function Location() { return <span data-testid="location">{useLocation().pathname}</span>; }
function PanelHarness({ allowSessionDetails, workspaceId, runId }: {
  allowSessionDetails: boolean;
  workspaceId: string | null;
  runId: string | null;
}) {
  const mode = useModeConfig();
  const serverSessions = useRunningServerSessions(true, workspaceId);
  const diffWorkspaceId = allowSessionDetails && mode.showGitActions ? workspaceId : null;
  const hasSessionDetails = !!diffWorkspaceId || (allowSessionDetails && mode.showSources && !!runId);
  const hasRunningServers = serverSessions.length > 0;
  return <>
    {(hasSessionDetails || hasRunningServers) && <SessionPanelTrigger
      showSessionDetails={hasSessionDetails} hasRunningServers={hasRunningServers} diffWorkspaceId={diffWorkspaceId}
    />}
    <SessionPanel allowSessionDetails={allowSessionDetails} runId={runId} serverSessions={serverSessions}
      laneOffset="0rem" floating={false} />
    <Location />
  </>;
}
function panel({ allowSessionDetails = true, workspaceId = "a", runId = "run-1", path = "/code/a" }: {
  allowSessionDetails?: boolean;
  workspaceId?: string | null;
  runId?: string | null;
  path?: string;
} = {}) {
  return <Provider store={testStore}><MemoryRouter initialEntries={[path]}>
    <PanelHarness allowSessionDetails={allowSessionDetails} workspaceId={workspaceId} runId={runId} />
  </MemoryRouter></Provider>;
}

beforeEach(() => {
  sessions = [];
  spaces = [{ id: "code", mode: "developer" }];
  activeSpaceId = "code";
  events.clear();
  invoke.mockReset().mockImplementation(async (channel: string, args: unknown[] = []) => {
    if (channel === CHANNELS.terminal.list) return { success: true, data: structuredClone(sessions) };
    if (channel === CHANNELS.space.getAll) return { success: true, data: structuredClone(spaces) };
    if (channel === CHANNELS.appSettings.get) return { success: true, data: { activeSpaceId } };
    if (channel === CHANNELS.appSettings.update) {
      activeSpaceId = (args[0] as { activeSpaceId: string }).activeSpaceId;
      return { success: true, data: { activeSpaceId } };
    }
    if (channel === CHANNELS.space.update) {
      const [id, patch] = args as [string, { mode: string }];
      const space = spaces.find((item) => item.id === id)!;
      space.mode = patch.mode;
      return { success: true, data: { ...space } };
    }
    if (channel === CHANNELS.terminal.destroy) {
      sessions = sessions.filter((entry) => entry.id !== args[0]);
      changed();
    }
    return { success: true, data: undefined };
  });
  setTransport(transport);
  testStore = makeStore();
});
afterEach(async () => {
  cleanup();
  testStore.dispatch(baseApi.util.resetApiState());
  await Promise.resolve();
  resetTransport();
});

describe("session panel running servers", () => {
  it("lists each open port before Sources, with current-workspace servers first", async () => {
    sessions = [session("api", "b", [8080]), session("website", "a", [3000, 3001])];
    render(panel());
    const section = await screen.findByRole("region", { name: "Running servers" });
    expect(within(section).getByText("3")).toBeTruthy();
    expect(within(section).getAllByRole("button", { name: /^node/ })
      .map((button) => within(button).getByText(/^:\d+$/).textContent))
      .toEqual([":3000", ":3001", ":8080"]);
    expect(within(section).getAllByText("Website")).toHaveLength(2);
    expect(within(section).getByText("API")).toBeTruthy();
    expect(within(section).queryByText(/Terminal 1/)).toBeNull();
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent))
      .toEqual(["mains", "Running servers", "Sources"]);
    expect(screen.getByRole("complementary", { name: "Session panel" }).contains(section)).toBe(true);
  });

  it("opens the owning workspace and selects that server's existing terminal", async () => {
    sessions = [session("api", "b", [8080])];
    render(panel());
    fireEvent.click(await screen.findByRole("button", { name: /^node :8080/ }));
    expect(screen.getByTestId("location").textContent).toBe("/code/b");
    expect(testStore.getState().terminal.selectedByWorkspace[terminalWorkspaceKey("local", "b")]).toBe("api");
    expect(testStore.getState().appSettings.bottomTerminalOpen).toBe(true);
    expect(screen.getByRole("region", { name: "Running servers" })).toBeTruthy();
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.terminal.create)).toBe(false);
  });

  it("stops only the chosen terminal and removes all its ports", async () => {
    sessions = [session("website", "a", [3000, 3001]), session("api", "b", [8080])];
    testStore.dispatch(selectTerminal({ key: terminalWorkspaceKey("local", "a"), id: "website" }));
    render(panel());
    const buttons = await screen.findAllByRole("button", { name: "Stop terminal and its servers: Website" });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(screen.queryByText(":3000")).toBeNull());
    expect(screen.queryByText(":3001")).toBeNull();
    expect(screen.getByText(":8080")).toBeTruthy();
    expect(sessions.map((entry) => entry.id)).toEqual(["api"]);
    expect(invoke).toHaveBeenCalledWith(CHANNELS.terminal.destroy, ["website"]);
    expect(testStore.getState().terminal.selectedByWorkspace[terminalWorkspaceKey("local", "a")]).toBeUndefined();
  });

  it("does not list idle, unverified, exited or provider sign-in terminals", async () => {
    sessions = [session("idle", "a", []), { ...session("unknown"), servers: null },
      { ...session("exited"), status: "exited" }, { ...session("auth"), workspaceId: null }];
    render(panel());
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(CHANNELS.terminal.list, []));
    expect(screen.queryByRole("region", { name: "Running servers" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Sources" })).toBeTruthy();
    act(() => testStore.dispatch(setSessionPanelOpen(false)));
    expect(screen.getByRole("button", { name: "Open session details" }).querySelector("svg")?.classList.contains("text-success")).toBe(false);
  });

  it("updates live port changes without destroying the shell or hiding the terminal drawer", async () => {
    sessions = [session("website")];
    testStore.dispatch(setBottomTerminalOpen(true));
    render(panel());
    await screen.findByText(":3000");
    act(() => { sessions[0].servers = []; changed(); });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Running servers" })).toBeNull());
    expect(sessions[0].status).toBe("running");
    expect(testStore.getState().appSettings.bottomTerminalOpen).toBe(true);
    act(() => { sessions[0].servers = [{ pid: 11, port: 3001, command: "node" }]; changed(); });
    await screen.findByText(":3001");
    act(() => testStore.dispatch(setSessionPanelOpen(false)));
    expect(screen.queryByRole("complementary", { name: "Session panel" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "Open session details" });
    expect(trigger.querySelector("svg")?.classList.contains("text-success")).toBe(true);
    act(() => { sessions[0].servers = []; changed(); });
    await waitFor(() => expect(trigger.querySelector("svg")?.classList.contains("text-success")).toBe(false));
    act(() => { sessions[0].servers = [{ pid: 11, port: 3001, command: "node" }]; changed(); });
    await waitFor(() => expect(trigger.querySelector("svg")?.classList.contains("text-success")).toBe(true));
    act(() => testStore.dispatch(setSessionPanelOpen(true)));
    expect(screen.getByText(":3001")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close session details" }).querySelector("svg")?.classList.contains("text-success")).toBe(false);
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.terminal.destroy)).toBe(false);
  });

  it("shows live ports alongside a workspace-less Work session and jumps through an existing Code space", async () => {
    spaces.unshift({ id: "work", mode: "work" });
    activeSpaceId = "work";
    sessions = [session("api", "b", [8080])];
    testStore.dispatch(setSessionPanelOpen(false));
    render(panel({ workspaceId: null, path: "/code/runs/run-1" }));
    const trigger = screen.getByRole("button", { name: "Open session details" });
    await waitFor(() => expect(trigger.querySelector("svg")?.classList.contains("text-success")).toBe(true));
    fireEvent.click(trigger);
    expect(screen.getByRole("heading", { name: "Sources" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Stop terminal/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^node :8080/ }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/code/b"));
    expect(activeSpaceId).toBe("code");
    expect(spaces[0].mode).toBe("work");
    expect(testStore.getState().terminal.selectedByWorkspace[terminalWorkspaceKey("local", "b")]).toBe("api");
    expect(testStore.getState().appSettings.bottomTerminalOpen).toBe(true);
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.terminal.create)).toBe(false);
  });

  it.each([
    { mode: "chat", allowSessionDetails: true, path: "/code/runs/run-1" },
    { mode: "developer", allowSessionDetails: false, path: "/assistants?assistant=a&run=run-1" },
  ])("offers a servers-only panel from $path", async ({ mode, allowSessionDetails, path }) => {
    spaces = [{ id: "current", mode }];
    activeSpaceId = "current";
    sessions = [session("api", "b", [8080])];
    testStore.dispatch(setSessionPanelOpen(false));
    render(panel({ allowSessionDetails, workspaceId: null, path }));

    const trigger = await screen.findByRole("button", { name: "Open running servers" });
    expect(trigger.querySelector("svg")?.classList.contains("text-success")).toBe(true);
    fireEvent.click(trigger);
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Running servers"]);
    fireEvent.click(screen.getByRole("button", { name: /^node :8080/ }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/code/b"));
    expect(spaces[0].mode).toBe("developer");
    expect(testStore.getState().terminal.selectedByWorkspace[terminalWorkspaceKey("local", "b")]).toBe("api");
  });
});
