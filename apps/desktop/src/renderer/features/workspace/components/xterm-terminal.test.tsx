// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { XtermTerminal } from "./xterm-terminal";

const mocks = vi.hoisted(() => ({
  terms: [] as any[],
  writes: [] as { data: string; cols: number; rows: number }[],
  dimensions: { cols: 120, rows: 12 },
  resizeListeners: new Set<() => void>(),
  invoke: vi.fn(),
  listeners: new Map<string, Set<(value: unknown) => void>>(),
  statuses: new Set<(status: string) => void>(),
}));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  options: any; input = (_data: string) => {};
  cols = 80; rows = 24;
  write = vi.fn((data: string) => { mocks.writes.push({ data, cols: this.cols, rows: this.rows }); });
  reset = vi.fn(); dispose = vi.fn();
  constructor(options: unknown) { this.options = options; mocks.terms.push(this); }
  loadAddon(addon: any) { addon.terminal = this; } open() {}
  resize(cols: number, rows: number) { this.cols = cols; this.rows = rows; }
  onData(callback: (data: string) => void) { this.input = callback; return { dispose() {} }; }
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {
  terminal: any;
  fit() { this.terminal.resize(mocks.dimensions.cols, mocks.dimensions.rows); }
  proposeDimensions() { return { ...mocks.dimensions }; }
} }));
vi.mock("@/hooks/use-dark-mode", () => ({ useDarkMode: () => ({ darkMode: false }) }));
vi.mock("@/hooks/use-theme-tokens", () => ({ useThemeTokens: () => ({}) }));
vi.mock("@/lib/transport", () => {
  const transport = {
    invoke: mocks.invoke,
    subscribe(channel: string, callback: (value: unknown) => void) {
      let listeners = mocks.listeners.get(channel);
      if (!listeners) mocks.listeners.set(channel, listeners = new Set());
      listeners.add(callback);
      return () => listeners!.delete(callback);
    },
    onStatusChange(callback: (status: string) => void) { mocks.statuses.add(callback); return () => mocks.statuses.delete(callback); },
  };
  return { getTransport: () => transport, onTransportChange: () => () => {} };
});

const snapshot = { session: { id: "t", status: "running", exitCode: null }, data: "server ready\r\n", sequence: 1 };
function emit(channel: string, value: unknown) { for (const listener of mocks.listeners.get(channel) ?? []) listener(value); }
function controlAnimationFrames() {
  let nextId = 0;
  const pending = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { pending.set(++nextId, callback); return nextId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => pending.delete(id));
  return () => {
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks) callback(performance.now());
  };
}
beforeEach(() => {
  mocks.terms = [];
  mocks.writes = [];
  mocks.dimensions = { cols: 120, rows: 12 };
  mocks.resizeListeners.clear();
  mocks.listeners.clear();
  mocks.statuses.clear();
  mocks.invoke.mockReset().mockImplementation(async (channel) => ({ success: true, data: channel === CHANNELS.terminal.attach || channel === CHANNELS.terminal.create ? snapshot : undefined }));
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: () => void) {}
    observe(element: HTMLElement) {
      Object.defineProperty(element, "clientWidth", { configurable: true, get: () => mocks.dimensions.cols * 8 });
      Object.defineProperty(element, "clientHeight", { configurable: true, get: () => mocks.dimensions.rows * 16 });
      mocks.resizeListeners.add(this.callback);
    }
    disconnect() { mocks.resizeListeners.delete(this.callback); }
  });
});
afterEach(async () => { cleanup(); await new Promise((resolve) => setTimeout(resolve, 0)); vi.unstubAllGlobals(); });

describe("terminal view lifecycle", () => {
  it("cannot reuse the previous terminal's ready state while a replacement is still being created", async () => {
    let finish!: () => void;
    const first = vi.fn(), replacement = vi.fn();
    mocks.invoke.mockImplementation(async (channel, args) => {
      if (channel === CHANNELS.terminal.create) {
        if (args[0].id === "replacement") return new Promise((resolve) => {
          finish = () => resolve({ success: true, data: { ...snapshot, session: { ...snapshot.session, id: "replacement" } } });
        });
        return { success: true, data: snapshot };
      }
      return { success: true };
    });
    const view = render(<XtermTerminal id="t" pendingCommand="codex login" onPendingCommandSent={first} />);
    await waitFor(() => expect(first).toHaveBeenCalledOnce());
    view.rerender(<XtermTerminal id="replacement" pendingCommand="claude auth login" onPendingCommandSent={replacement} />);
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(mocks.invoke.mock.calls.filter(([channel, args]) => channel === CHANNELS.terminal.write && args[0] === "replacement")).toHaveLength(0);
    await act(async () => { finish(); });
    await waitFor(() => expect(replacement).toHaveBeenCalledOnce());
    expect(mocks.invoke.mock.calls.filter(([channel, args]) => channel === CHANNELS.terminal.write && args[0] === "replacement")).toHaveLength(1);
  });
  it("shares temporary acquisition and command delivery through StrictMode replay", async () => {
    const sent = vi.fn();
    const view = render(<StrictMode><XtermTerminal id="t" pendingCommand="codex login" onPendingCommandSent={sent} /></StrictMode>);
    await waitFor(() => expect(sent).toHaveBeenCalledOnce());
    expect(mocks.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.create)).toHaveLength(1);
    expect(mocks.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.write)).toHaveLength(1);
    expect(mocks.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.destroy)).toHaveLength(0);
    view.unmount();
    await waitFor(() => expect(mocks.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.destroy)).toHaveLength(1));
  });

  it("keeps a temporary process alive while another view still owns it", async () => {
    const first = render(<XtermTerminal id="t" />), second = render(<XtermTerminal id="t" />);
    await waitFor(() => expect(mocks.terms.every((term) => term.write.mock.calls.length === 1)).toBe(true));
    first.unmount(); await act(async () => { await Promise.resolve(); });
    expect(mocks.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.destroy)).toHaveLength(0);
    second.unmount();
    await waitFor(() => expect(mocks.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.destroy)).toHaveLength(1));
  });

  it("keeps uncertain command delivery visible and never resends it on reconnect", async () => {
    const sent = vi.fn();
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === CHANNELS.terminal.write) throw new Error("Reply lost");
      return { success: true, data: channel === CHANNELS.terminal.create ? snapshot : undefined };
    });
    render(<XtermTerminal id="t" pendingCommand="codex login" onPendingCommandSent={sent} />);
    expect((await screen.findByRole("alert")).textContent).toContain("could not be confirmed");
    act(() => { for (const listener of mocks.statuses) listener("reconnecting"); });
    act(() => { for (const listener of mocks.statuses) listener("connected"); });
    await waitFor(() => expect(mocks.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.create)).toHaveLength(2));
    await screen.findByRole("alert");
    expect(mocks.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.write)).toHaveLength(1);
    expect(sent).not.toHaveBeenCalled();
  });

  it("binds native input and resize to the snapshot's process incarnation", async () => {
    mocks.invoke.mockImplementation(async (channel) => ({ success: true,
      data: channel === CHANNELS.terminal.attach ? { ...snapshot, session: { ...snapshot.session, instanceId: "native-t" } } : undefined }));
    render(<XtermTerminal id="t" persistent />);
    await waitFor(() => expect(mocks.terms[0].write).toHaveBeenCalledOnce());
    act(() => mocks.terms[0].input("pwd\r"));
    expect(mocks.invoke).toHaveBeenCalledWith(CHANNELS.terminal.write, ["t", "pwd\r", { instanceId: "native-t" }]);
    expect(mocks.invoke).toHaveBeenCalledWith(CHANNELS.terminal.resize, ["t", 120, 12, "native-t"]);
  });

  it("discards an older attach reply after reconnecting to a fresher snapshot", async () => {
    const replies: ((value: unknown) => void)[] = [];
    mocks.invoke.mockImplementation(async (channel) => channel === CHANNELS.terminal.attach
      ? new Promise((resolve) => { replies.push(resolve); }) : { success: true });
    render(<XtermTerminal id="t" persistent />);
    act(() => { for (const listener of mocks.statuses) listener("reconnecting"); });
    act(() => { for (const listener of mocks.statuses) listener("connected"); });
    await act(async () => { replies[1]({ success: true, data: { ...snapshot, data: "newer", sequence: 10 } }); });
    await act(async () => { replies[0]({ success: true, data: snapshot }); });
    expect(mocks.writes.map((write) => write.data)).toEqual(["newer"]);
  });

  it("refuses malformed replay metadata before permitting sign-in input", async () => {
    mocks.invoke.mockResolvedValue({ success: true, data: { ...snapshot, sequence: -1 } });
    render(<XtermTerminal id="t" pendingCommand="codex login" />);
    await screen.findByRole("alert");
    expect(mocks.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.write)).toHaveLength(0);
  });
  it("releases a temporary PTY whose creation finishes after its view closes", async () => {
    let finish!: () => void, live = false;
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === CHANNELS.terminal.create) return new Promise((resolve) => {
        finish = () => { live = true; resolve({ success: true, data: snapshot }); };
      });
      if (channel === CHANNELS.terminal.destroy) live = false;
      return { success: true };
    });
    const view = render(<XtermTerminal id="t" />);
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    view.unmount();
    await act(async () => { finish(); });
    await waitFor(() => expect(live).toBe(false));
  });
  it("joins a pending sign-in command across callback rerenders", async () => {
    let finish!: (value: unknown) => void;
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === CHANNELS.terminal.create) return { success: true, data: snapshot };
      if (channel === CHANNELS.terminal.write) return new Promise((resolve) => { finish = resolve; });
      return { success: true };
    });
    const first = vi.fn(), current = vi.fn();
    const view = render(<XtermTerminal id="t" pendingCommand="claude auth login" onPendingCommandSent={first} />);
    await waitFor(() => expect(mocks.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.write)).toHaveLength(1));
    view.rerender(<XtermTerminal id="t" pendingCommand="claude auth login" onPendingCommandSent={current} />);
    expect(mocks.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.write)).toHaveLength(1);
    await act(async () => { finish({ success: true }); });
    expect(current).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
  it("does not resize the PTY again when resize notifications leave the terminal grid unchanged", async () => {
    const flushFrame = controlAnimationFrames();
    render(<XtermTerminal id="t" persistent />);
    await waitFor(() => expect(mocks.terms[0].write).toHaveBeenCalledOnce());
    act(flushFrame);
    for (let frame = 0; frame < 18; frame += 1) {
      act(() => { for (const resize of mocks.resizeListeners) resize(); flushFrame(); });
    }
    expect(mocks.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.resize)).toHaveLength(1);
    act(() => {
      mocks.dimensions = { cols: 100, rows: 14 };
      for (const resize of mocks.resizeListeners) resize();
      flushFrame();
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith(CHANNELS.terminal.resize, ["t", 100, 14]);
    expect(mocks.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.resize)).toHaveLength(2);
  });

  it("fits an attached terminal before replaying its history instead of replaying at the default 80 columns", async () => {
    controlAnimationFrames();
    render(<XtermTerminal id="t" persistent />);
    await waitFor(() => expect(mocks.terms[0].write).toHaveBeenCalledOnce());
    expect(mocks.writes[0]).toEqual({ data: snapshot.data, cols: 120, rows: 12 });
  });

  it("detaches persistent views without killing or recreating the PTY, including StrictMode", async () => {
    const view = render(<StrictMode><XtermTerminal id="t" persistent /></StrictMode>);
    await waitFor(() => expect(mocks.terms[mocks.terms.length - 1].write).toHaveBeenCalledWith("server ready\r\n"));
    view.unmount();
    const second = render(<XtermTerminal id="t" persistent />);
    await waitFor(() => expect(mocks.terms[mocks.terms.length - 1].write).toHaveBeenCalledWith("server ready\r\n"));
    second.unmount();
    expect(mocks.invoke.mock.calls.every(([channel]) => channel !== CHANNELS.terminal.create && channel !== CHANNELS.terminal.destroy)).toBe(true);
    expect(mocks.terms.every((term) => term.dispose.mock.calls.length === 1)).toBe(true);
  });

  it("still destroys temporary provider login terminals and sends their command once ready", async () => {
    const sent = vi.fn();
    const view = render(<XtermTerminal id="t" pendingCommand="claude auth login" onPendingCommandSent={sent} />);
    await waitFor(() => expect(sent).toHaveBeenCalledOnce());
    expect(mocks.invoke).toHaveBeenCalledWith(CHANNELS.terminal.write, ["t", "claude auth login\r", { commandId: "provider-login" }]);
    view.unmount();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(CHANNELS.terminal.destroy, ["t"]));
  });

  it("does not duplicate output received before the attach reply", async () => {
    let resolve!: (value: unknown) => void;
    mocks.invoke.mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<XtermTerminal id="t" persistent />);
    act(() => {
      emit(CHANNELS.terminal.data, { id: "t", data: "server ready\r\n", sequence: 1 });
      emit(CHANNELS.terminal.data, { id: "t", data: "request\r\n", sequence: 2 });
      resolve({ success: true, data: snapshot });
    });
    await waitFor(() => expect(mocks.terms[0].write.mock.calls).toEqual([["server ready\r\n"], ["request\r\n"]]));
  });

  it("keeps an exit event that races the attach reply and stops accepting input", async () => {
    let resolve!: (value: unknown) => void;
    mocks.invoke.mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<XtermTerminal id="t" persistent />);
    act(() => {
      emit(CHANNELS.terminal.exit, { id: "t", exitCode: 0 });
      resolve({ success: true, data: snapshot });
    });
    await screen.findByText("Process exited (0)");
    act(() => mocks.terms[0].input("ls\r"));
    expect(mocks.invoke.mock.calls.some(([channel]) => channel === CHANNELS.terminal.write)).toBe(false);
  });

  it("reattaches the same session after a transport reconnect", async () => {
    render(<XtermTerminal id="t" persistent />);
    await waitFor(() => expect(mocks.terms[0].write).toHaveBeenCalledOnce());
    act(() => { for (const listener of mocks.statuses) listener("reconnecting"); });
    act(() => mocks.terms[0].input("ignored\r"));
    act(() => { for (const listener of mocks.statuses) listener("connected"); });
    await waitFor(() => expect(mocks.terms[0].write).toHaveBeenCalledTimes(2));
    expect(mocks.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.terminal.attach)).toHaveLength(2);
    expect(mocks.invoke.mock.calls.some(([channel]) => channel === CHANNELS.terminal.destroy || channel === CHANNELS.terminal.write)).toBe(false);
  });

  it("reports a stopped terminal instead of silently creating a replacement", async () => {
    mocks.invoke.mockResolvedValue({ success: false, error: "Terminal no longer exists. Open a new terminal." });
    render(<XtermTerminal id="t" persistent />);
    expect((await screen.findByRole("alert")).textContent).toContain("Terminal no longer exists");
    expect(mocks.invoke.mock.calls.every(([channel]) => channel !== CHANNELS.terminal.create)).toBe(true);
  });
});
