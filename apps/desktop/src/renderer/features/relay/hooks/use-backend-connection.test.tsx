// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import reducer, { addBackend } from "@/lib/redux/slices/backendsSlice";
import { disconnectRemoteBackend, getTransport, onTransportChange } from "@/lib/transport";
import { useBackendConnection } from "./use-backend-connection";

class Socket {
  static all: Socket[] = [];
  readyState = 0; sent: string[] = []; closed = false;
  onopen: (() => void) | null = null; onclose: (() => void) | null = null;
  onerror: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null;
  constructor(readonly url: string) { Socket.all.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; this.readyState = 3; this.onclose?.(); }
  accept(backendId = "verified") {
    this.readyState = 1; this.onopen?.();
    const request = JSON.parse(this.sent[0]);
    this.onmessage?.({ data: JSON.stringify({ kind: "response", id: request.id, result: { success: true, data: {
      backendId, name: backendId, appVersion: "1", protocolVersion: 1, capabilities: [], serverTime: "now",
    } } }) });
  }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const native = { openTunnel: vi.fn(), closeTunnel: vi.fn(), cancelTunnelOpen: vi.fn(), getToken: vi.fn(), deleteToken: vi.fn() };
let store: ReturnType<typeof makeStore>;
function makeStore() { return configureStore({ reducer: { backends: reducer } }); }
function mount() {
  return renderHook(() => useBackendConnection(), { wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider> });
}
beforeEach(() => {
  store = makeStore(); Socket.all = [];
  vi.stubGlobal("WebSocket", Socket);
  native.closeTunnel.mockResolvedValue({ success: true }); native.cancelTunnelOpen.mockResolvedValue({ success: true });
  Object.defineProperty(window, "api", { configurable: true, value: { ssh: native, remoteBackends: native } });
  store.dispatch(addBackend({ id: "ssh", label: "SSH", ssh: { host: "dev", remotePort: 8787 } }));
  store.dispatch(addBackend({ id: "direct", label: "Direct", wsUrl: "ws://direct" }));
});
afterEach(async () => { cleanup(); await disconnectRemoteBackend(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it("does not open a WebSocket from a retired SSH preparation and releases a late handle", async () => {
  const tunnel = deferred<any>(); native.openTunnel.mockReturnValue(tunnel.promise);
  const view = mount();
  let connecting!: Promise<unknown>;
  act(() => { connecting = view.result.current.connect("ssh").catch((error: Error) => error); });
  await act(() => view.result.current.disconnect());
  await act(async () => { tunnel.resolve({ success: true, data: { id: "late", localUrl: "ws://late" } }); await connecting; });
  expect(await connecting).toBeInstanceOf(Error);
  expect(Socket.all).toHaveLength(0);
  expect(native.closeTunnel).toHaveBeenCalledWith("late");
  expect(native.cancelTunnelOpen).toHaveBeenCalled();
  expect(store.getState().backends.activeBackendId).toBeNull();
});

it("publishes the verified transport and saved selection in one observable transition", async () => {
  const view = mount();
  const observed: Array<string | null> = [];
  const off = onTransportChange(() => { if (getTransport().kind === "ws") observed.push(store.getState().backends.activeBackendId); });
  try {
    let connecting!: Promise<unknown>;
    act(() => { connecting = view.result.current.connect("direct"); });
    await act(async () => { Socket.all[0].accept(); await connecting; });
    expect(observed).toEqual(["direct"]);
    expect(store.getState().backends.activeBackendId).toBe("direct");
  } finally { off(); }
});

it("publishes the local selection before notifying transport observers", async () => {
  const view = mount(); let connecting!: Promise<unknown>;
  act(() => { connecting = view.result.current.connect("direct"); });
  await act(async () => { Socket.all[0].accept(); await connecting; });
  const observed: Array<string | null> = [];
  const off = onTransportChange(() => observed.push(store.getState().backends.activeBackendId));
  try {
    await act(() => view.result.current.disconnect());
    expect(observed).toEqual([null]);
  } finally { off(); }
});

it("removing the pending saved backend retires its late native preparation", async () => {
  const tunnel = deferred<any>(); native.openTunnel.mockReturnValue(tunnel.promise);
  const view = mount(); let connecting!: Promise<unknown>;
  act(() => { connecting = view.result.current.connect("ssh").catch((error: Error) => error); });
  act(() => view.result.current.remove("ssh"));
  await act(async () => { tunnel.resolve({ success: true, data: { id: "removed", localUrl: "ws://removed" } }); await connecting; });
  expect(await connecting).toBeInstanceOf(Error); expect(Socket.all).toHaveLength(0);
  expect(store.getState().backends.saved.some((backend) => backend.id === "ssh")).toBe(false);
});

it("retains the active SSH tunnel through a failed candidate and releases it after verified replacement", async () => {
  native.openTunnel.mockResolvedValue({ success: true, data: { id: "active-tunnel", localUrl: "ws://ssh" } });
  const view = mount(); let first!: Promise<unknown>;
  act(() => { first = view.result.current.connect("ssh"); });
  await vi.waitFor(() => expect(Socket.all).toHaveLength(1));
  await act(async () => { Socket.all[0].accept("ssh-backend"); await first; });
  const previous = getTransport();
  let failing!: Promise<unknown>;
  act(() => { failing = view.result.current.connect("direct").catch((error: Error) => error); });
  await act(async () => {
    const socket = Socket.all[1]; socket.readyState = 1; socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ kind: "response", id: JSON.parse(socket.sent[0]).id, result: { success: false, error: "Unauthorized" } }) });
    await failing;
  });
  expect(await failing).toBeInstanceOf(Error);
  expect(getTransport()).toBe(previous); expect(store.getState().backends.activeBackendId).toBe("ssh");
  expect(native.closeTunnel).not.toHaveBeenCalled();
  let succeeding!: Promise<unknown>;
  act(() => { succeeding = view.result.current.connect("direct"); });
  await act(async () => { Socket.all[2].accept("direct-backend"); await succeeding; });
  expect(native.closeTunnel).toHaveBeenCalledWith("active-tunnel");
  expect(store.getState().backends.activeBackendId).toBe("direct");
});

it("retires an unmounted view's pending preparation while leaving committed connections alive", async () => {
  const tunnel = deferred<any>(); native.openTunnel.mockReturnValue(tunnel.promise);
  const view = mount(); let connecting!: Promise<unknown>;
  act(() => { connecting = view.result.current.connect("ssh").catch((error: Error) => error); });
  view.unmount();
  await act(async () => { tunnel.resolve({ success: true, data: { id: "unmounted", localUrl: "ws://unmounted" } }); await connecting; });
  expect(await connecting).toBeInstanceOf(Error); expect(Socket.all).toHaveLength(0);
  expect(native.closeTunnel).toHaveBeenCalledWith("unmounted");
});

it("does not use credentials returned after a newer backend choice", async () => {
  store.dispatch(addBackend({ id: "token", label: "Token", wsUrl: "ws://token", hasToken: true }));
  const token = deferred<any>(); native.getToken.mockReturnValue(token.promise);
  const view = mount(); let old!: Promise<unknown>, current!: Promise<unknown>;
  act(() => { old = view.result.current.connect("token").catch((error: Error) => error); });
  act(() => { current = view.result.current.connect("direct"); });
  await act(async () => { Socket.all[0].accept(); await current; });
  await act(async () => { token.resolve({ success: true, data: "retired-token" }); await old; });
  expect(await old).toBeInstanceOf(Error); expect(Socket.all).toHaveLength(1);
  expect(store.getState().backends.activeBackendId).toBe("direct");
});
