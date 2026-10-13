// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { XtermTerminal } from "./xterm-terminal";

const mocks = vi.hoisted(() => ({
  terms: [] as any[],
  invoke: vi.fn(),
  listeners: new Map<string, Set<(value: unknown) => void>>(),
  statuses: new Set<(status: string) => void>(),
}));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  options: any; input = (_data: string) => {};
  write = vi.fn(); reset = vi.fn(); dispose = vi.fn();
  constructor(options: unknown) { this.options = options; mocks.terms.push(this); }
  loadAddon() {} open() {}
  onData(callback: (data: string) => void) { this.input = callback; return { dispose() {} }; }
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {
  fit() {} proposeDimensions() { return { cols: 80, rows: 24 }; }
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
beforeEach(() => {
  mocks.terms = [];
  mocks.listeners.clear();
  mocks.statuses.clear();
  mocks.invoke.mockReset().mockImplementation(async (channel) => ({ success: true, data: channel === CHANNELS.terminal.attach || channel === CHANNELS.terminal.create ? snapshot : undefined }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("terminal view lifecycle", () => {
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
    expect(mocks.invoke).toHaveBeenCalledWith(CHANNELS.terminal.write, ["t", "claude auth login\r"]);
    view.unmount();
    expect(mocks.invoke).toHaveBeenCalledWith(CHANNELS.terminal.destroy, ["t"]);
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
