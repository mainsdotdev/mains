// @vitest-environment jsdom
import { configureStore } from "@reduxjs/toolkit";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import type { TerminalCreateOptions, TerminalSession } from "@mains/contracts/terminal";
import { BOTTOM_TERMINAL_ANIM_MS } from "@/lib/layout";
import { installOverlayFrameClock } from "@/lib/overlay-test-fixtures";
import { baseApi } from "@/lib/redux/api/baseApi";
import { terminalApi } from "@/lib/redux/api/terminalApi";
import terminalReducer, { selectTerminal, terminalWorkspaceKey } from "@/lib/redux/slices/terminalSlice";
import appSettingsReducer from "@/lib/redux/slices/appSettingsSlice";
import { resetTransport, setTransport, type Transport } from "@/lib/transport";
import { WorkspaceTerminal } from "./workspace-terminal";

vi.mock("./xterm-terminal", () => ({ XtermTerminal: ({ id, persistent }: { id: string; persistent: boolean }) => <div data-testid="terminal-view" data-session={id} data-persistent={persistent} /> }));

function session(id: string, workspaceId = "a", title = "Terminal 1"): TerminalSession {
  return { id, workspaceId, workspaceName: workspaceId === "a" ? "Website" : "API", title,
    cwd: `/tmp/${workspaceId}`, status: "running", exitCode: null, createdAt: 1, servers: [] };
}
let sessions: TerminalSession[];
let testStore: ReturnType<typeof makeStore>;
const events = new Map<string, Set<(payload: unknown) => void>>();
const invoke = vi.fn();
const hide = vi.fn();
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
  return configureStore({ reducer: { [baseApi.reducerPath]: baseApi.reducer, terminal: terminalReducer,
    appSettings: appSettingsReducer, backends: () => ({ activeBackendId: null }) },
  middleware: (defaults) => defaults().concat(baseApi.middleware) });
}
function workspace(workspaceId = "a", isOpen = true) {
  return <Provider store={testStore}><WorkspaceTerminal workspaceId={workspaceId}
    workspaceName={workspaceId === "a" ? "Website" : "API"} rootPath={`/tmp/${workspaceId}`} isOpen={isOpen} onHide={hide} /></Provider>;
}

beforeEach(() => {
  sessions = [];
  events.clear();
  hide.mockClear();
  invoke.mockReset().mockImplementation(async (channel: string, args: unknown[] = []) => {
    if (channel === CHANNELS.terminal.list) return { success: true, data: sessions.map((entry) => ({ ...entry })) };
    if (channel === CHANNELS.terminal.create) {
      const options = args[0] as TerminalCreateOptions;
      const existing = sessions.find((entry) => entry.id === options.id);
      if (existing) return { success: true, data: { session: existing, data: "", sequence: 0 } };
      const created = { ...session(options.id, options.workspaceId), cwd: options.cwd!,
        title: `Terminal ${sessions.filter((entry) => entry.workspaceId === options.workspaceId).length + 1}` };
      sessions.push(created);
      changed();
      return { success: true, data: { session: created, data: "", sequence: 0 } };
    }
    if (channel === CHANNELS.terminal.destroy) {
      sessions = sessions.filter((entry) => entry.id !== args[0]);
      changed();
    }
    return { success: true, data: undefined };
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false, addEventListener() {}, removeEventListener() {},
  })));
  setTransport(transport);
  testStore = makeStore();
});
afterEach(async () => {
  cleanup();
  testStore.dispatch(baseApi.util.resetApiState());
  await Promise.resolve();
  resetTransport();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("workspace terminal tabs", () => {
  it("keeps the second terminal visible while a new terminal waits for the catalog refresh", async () => {
    sessions = [session("first"), session("second", "a", "Terminal 2")];
    const key = terminalWorkspaceKey("local", "a");
    testStore.dispatch(selectTerminal({ key, id: "second" }));
    render(workspace());
    await waitFor(() => expect(screen.getByTestId("terminal-view").getAttribute("data-session")).toBe("second"));
    const original = invoke.getMockImplementation()!;
    const pending: ((value: unknown) => void)[] = [];
    let delayCatalog = true;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.terminal.list && delayCatalog
      ? new Promise((resolve) => pending.push(resolve)) : original(channel, args));
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    await waitFor(() => expect(sessions).toHaveLength(3));
    await waitFor(() => expect(testStore.getState().terminal.selectedByWorkspace[key]).toBe(sessions[2].id));
    const duringRefresh = screen.getByTestId("terminal-view").getAttribute("data-session");
    delayCatalog = false;
    act(() => { for (const finish of pending) finish({ success: true, data: [...sessions] }); });
    await waitFor(() => expect(screen.getByTestId("terminal-view").getAttribute("data-session")).toBe(sessions[2].id));
    expect(duringRefresh).toBe("second");
  });

  it("creates tabs on demand and retains each workspace's selected terminal through hide and navigation", async () => {
    const view = render(workspace("a", false));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(CHANNELS.terminal.list, []));
    expect(sessions).toHaveLength(0);
    view.rerender(workspace());
    await screen.findByRole("tab", { name: "Terminal 1" });
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    await screen.findByRole("tab", { name: "Terminal 2" });
    fireEvent.click(screen.getByRole("tab", { name: "Terminal 1" }));
    await waitFor(() => expect(screen.getByTestId("terminal-view").getAttribute("data-session")).toBe(sessions[0].id));
    expect(screen.getByTestId("terminal-view").getAttribute("data-persistent")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Hide terminal" }));
    expect(hide).toHaveBeenCalledOnce();
    view.rerender(workspace("a", false));
    expect(screen.getByTestId("terminal-view").closest("section")?.hasAttribute("inert")).toBe(true);
    view.rerender(workspace("b"));
    await waitFor(() => expect(sessions.filter((entry) => entry.workspaceId === "b")).toHaveLength(1));
    view.rerender(workspace("a"));
    await screen.findByRole("tab", { name: "Terminal 2" });
    expect(screen.getByRole("tab", { name: "Terminal 1" }).getAttribute("aria-selected")).toBe("true");
    view.unmount();
    expect(sessions).toHaveLength(3);
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.terminal.destroy)).toBe(false);
  });

  it("mounts xterm on the frame after the current opening transition finishes", async () => {
    sessions = [session("existing")];
    const frames = installOverlayFrameClock();
    const view = render(workspace("a", false));
    const drawer = view.container.firstElementChild!;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    Object.defineProperty(drawer, "getAnimations", {
      value: () => [{ transitionProperty: "height", finished }],
    });

    view.rerender(workspace());
    await screen.findByRole("tab", { name: "Terminal 1" });
    act(() => frames.flush());
    expect(screen.queryByTestId("terminal-view")).toBeNull();
    await act(async () => finish());
    expect(screen.queryByTestId("terminal-view")).toBeNull();
    act(() => frames.flush());
    expect(await screen.findByTestId("terminal-view")).toBeTruthy();
  });

  it("ignores an opening transition that reports completion while the drawer is closing", async () => {
    sessions = [session("existing")];
    const frames = installOverlayFrameClock();
    const view = render(workspace("a", false));
    const drawer = view.container.firstElementChild!;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    Object.defineProperty(drawer, "getAnimations", {
      value: () => [{ transitionProperty: "height", finished }],
    });

    view.rerender(workspace());
    await screen.findByRole("tab", { name: "Terminal 1" });
    act(() => frames.flush());
    view.rerender(workspace("a", false));
    await act(async () => finish());
    act(() => frames.flush());
    expect(screen.queryByTestId("terminal-view")).toBeNull();
  });

  it("keeps the same terminal view through a reversed close and detaches it after a full exit", async () => {
    sessions = [session("existing")];
    const view = render(workspace());
    const terminal = await screen.findByTestId("terminal-view");
    vi.useFakeTimers();
    view.rerender(workspace("a", false));
    act(() => vi.advanceTimersByTime(BOTTOM_TERMINAL_ANIM_MS / 2));
    expect(screen.getByTestId("terminal-view")).toBe(terminal);
    view.rerender(workspace());
    act(() => vi.advanceTimersByTime(BOTTOM_TERMINAL_ANIM_MS));
    expect(screen.getByTestId("terminal-view")).toBe(terminal);
    expect(terminal.closest("section")?.hasAttribute("inert")).toBe(false);

    view.rerender(workspace("a", false));
    act(() => vi.advanceTimersByTime(BOTTOM_TERMINAL_ANIM_MS));
    expect(screen.queryByTestId("terminal-view")).toBeNull();
  });

  it("retains the closing tab when idle cleanup removes it", async () => {
    sessions = [session("idle")];
    const view = render(workspace());
    const terminal = await screen.findByTestId("terminal-view");
    vi.useFakeTimers();
    view.rerender(workspace("a", false));
    sessions = [];
    changed();
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(terminalApi.endpoints.getTerminalSessions.select()(testStore.getState()).data).toEqual([]);
    expect(screen.getByTestId("terminal-view")).toBe(terminal);
  });

  it("restores a shell when idle cleanup finishes after the drawer has reopened", async () => {
    sessions = [session("idle")];
    const view = render(workspace());
    const terminal = await screen.findByTestId("terminal-view");
    vi.useFakeTimers();
    view.rerender(workspace("a", false));
    view.rerender(workspace());
    expect(screen.getByTestId("terminal-view")).toBe(terminal);
    sessions = [];
    changed();
    await act(() => vi.advanceTimersByTimeAsync(BOTTOM_TERMINAL_ANIM_MS));
    expect(screen.getByTestId("terminal-view").getAttribute("data-session")).toBe("terminal-a");
  });

  it("detaches immediately when reduced motion is enabled", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true, addEventListener() {}, removeEventListener() {},
    } as unknown as MediaQueryList);
    sessions = [session("existing")];
    const view = render(workspace());
    await screen.findByTestId("terminal-view");
    view.rerender(workspace("a", false));
    expect(screen.queryByTestId("terminal-view")).toBeNull();
  });

  it("stops only the selected terminal and does not respawn the last stopped tab", async () => {
    sessions = [session("existing")];
    render(workspace());
    await screen.findByRole("tab", { name: "Terminal 1" });
    const id = sessions[0].id;
    fireEvent.click(screen.getByRole("button", { name: "Stop Terminal 1" }));
    await waitFor(() => expect(hide).toHaveBeenCalledOnce());
    await screen.findByText("No open terminals");
    expect(invoke).toHaveBeenCalledWith(CHANNELS.terminal.destroy, [id]);
    expect(sessions).toHaveLength(0);
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.create)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    await screen.findByRole("tab", { name: "Terminal 1" });
    expect(sessions).toHaveLength(1);
  });

  it("reopens existing backend sessions without creating another shell", async () => {
    sessions = [session("existing")];
    render(workspace());
    await screen.findByRole("tab", { name: "Terminal 1" });
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.terminal.create)).toBe(false);
  });

  it("uses the same initial shell when rapid navigation overlaps create replies", async () => {
    const original = invoke.getMockImplementation()!;
    const pending: (() => void)[] = [];
    invoke.mockImplementation((channel, args) => channel === CHANNELS.terminal.create
      ? new Promise((resolve) => { pending.push(() => { void original(channel, args).then(resolve); }); })
      : original(channel, args));
    const first = render(workspace());
    await waitFor(() => expect(pending).toHaveLength(1));
    first.unmount();
    render(workspace());
    await waitFor(() => expect(pending).toHaveLength(2));
    const ids = invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.create).map(([, args]) => args[0].id);
    expect(ids).toEqual(["terminal-a", "terminal-a"]);
    act(() => { for (const finish of pending) finish(); });
    await screen.findByRole("tab", { name: "Terminal 1" });
    expect(sessions).toHaveLength(1);
  });
});
