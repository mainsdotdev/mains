// @vitest-environment jsdom
import { configureStore } from "@reduxjs/toolkit";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import type { TerminalCreateOptions, TerminalSession } from "@mains/contracts/terminal";
import { baseApi } from "@/lib/redux/api/baseApi";
import terminalReducer from "@/lib/redux/slices/terminalSlice";
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
  setTransport(transport);
  testStore = makeStore();
});
afterEach(async () => {
  cleanup();
  testStore.dispatch(baseApi.util.resetApiState());
  await Promise.resolve();
  resetTransport();
  vi.unstubAllGlobals();
});

describe("workspace terminal tabs", () => {
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
    expect(screen.queryByTestId("terminal-view")).toBeNull();
    view.rerender(workspace("b"));
    await waitFor(() => expect(sessions.filter((entry) => entry.workspaceId === "b")).toHaveLength(1));
    view.rerender(workspace("a"));
    await screen.findByRole("tab", { name: "Terminal 2" });
    expect(screen.getByRole("tab", { name: "Terminal 1" }).getAttribute("aria-selected")).toBe("true");
    view.unmount();
    expect(sessions).toHaveLength(3);
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.terminal.destroy)).toBe(false);
  });

  it("stops only the selected terminal and does not respawn the last stopped tab", async () => {
    render(workspace());
    await screen.findByRole("tab", { name: "Terminal 1" });
    const id = sessions[0].id;
    fireEvent.click(screen.getByRole("button", { name: "Stop Terminal 1" }));
    await waitFor(() => expect(hide).toHaveBeenCalledOnce());
    await screen.findByText("No open terminals");
    expect(invoke).toHaveBeenCalledWith(CHANNELS.terminal.destroy, [id]);
    expect(sessions).toHaveLength(0);
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.create)).toHaveLength(1);
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
