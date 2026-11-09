// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

class Socket {
  static all: Socket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) { Socket.all.push(this); }
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
}
let transport: typeof import("../transport");
let fetchImpl: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.resetModules(); Socket.all = [];
  vi.stubGlobal("WebSocket", Socket);
  fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchImpl);
  Reflect.deleteProperty(window, "mainTransport"); Reflect.deleteProperty(window, "api");
  localStorage.clear(); window.history.replaceState(null, "", "/#login=one-use-code");
  transport = await import("../transport");
});
afterEach(() => {
  const active = transport.getTransport();
  if (active instanceof transport.WsTransport) active.dispose();
  transport.resetTransport(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it("retires a pending login handoff on a transport swap away and back", async () => {
  let finish!: (value: Response) => void;
  fetchImpl.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
  await import("./web-bootstrap");
  const original = transport.getTransport() as InstanceType<typeof transport.WsTransport>;
  const pending = original.invoke("runs:getById", ["run"]).catch((error) => error);
  try {
    transport.setTransport(new transport.WsTransport("ws://replacement.test"));
    transport.setTransport(original);
    finish(new Response(null, { status: 204 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(Socket.all).toHaveLength(0);
  } finally { original.dispose(); await pending; }
});

it("queues shim invokes until login completes, then delivers them over the owned socket", async () => {
  let finish!: (value: Response) => void;
  fetchImpl.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
  await import("./web-bootstrap");
  const request = window.api.runs.getById("run");
  expect(window.location.href).not.toContain("one-use-code");
  expect(Socket.all).toHaveLength(0);
  finish(new Response(null, { status: 204 }));
  await vi.waitFor(() => expect(Socket.all).toHaveLength(1));
  const socket = Socket.all[0]; socket.open();
  const frame = JSON.parse(socket.sent[0]);
  expect(frame).toMatchObject({ kind: "invoke", channel: "runs:getById", args: ["run"] });
  expect(socket.url).not.toContain("one-use-code");
  socket.onmessage!({ data: JSON.stringify({ kind: "response", id: frame.id, result: { success: true, data: { id: "run" } } }) });
  await expect(request).resolves.toMatchObject({ success: true, data: { id: "run" } });
});

it("lets the normal socket failure state handle a rejected login exchange", async () => {
  fetchImpl.mockRejectedValueOnce(new Error("Login refused"));
  await import("./web-bootstrap");
  await vi.waitFor(() => expect(Socket.all).toHaveLength(1));
  expect(transport.getTransport().status()).toBe("connecting");
});

it("releases the socket once at the deadline and ignores a later fetch success", async () => {
  vi.useFakeTimers();
  let finish!: (value: Response) => void;
  fetchImpl.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
  await import("./web-bootstrap");
  await vi.advanceTimersByTimeAsync(8000);
  expect(Socket.all).toHaveLength(1);
  expect((fetchImpl.mock.calls[0][1] as RequestInit).signal!.aborted).toBe(true);
  Socket.all[0].open();
  finish(new Response(null, { status: 204 }));
  await vi.advanceTimersByTimeAsync(0);
  expect(Socket.all).toHaveLength(1);
});

it("retires login and queued invokes when the page unloads", async () => {
  let finish!: (value: Response) => void;
  fetchImpl.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
  await import("./web-bootstrap");
  const pending = transport.getTransport().invoke("runs:getById", ["run"]).catch((error) => error);
  window.dispatchEvent(new Event("beforeunload"));
  expect(await pending).toBeInstanceOf(Error);
  expect((fetchImpl.mock.calls[0][1] as RequestInit).signal!.aborted).toBe(true);
  finish(new Response(null, { status: 204 }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(Socket.all).toHaveLength(0);
});

it("connects an existing cookie session without fetching a login code", async () => {
  window.history.replaceState(null, "", "/#/code");
  await import("./web-bootstrap");
  await vi.waitFor(() => expect(Socket.all).toHaveLength(1));
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("#/code");
});

it("keeps the native Electron preload path unchanged", async () => {
  vi.stubGlobal("mainTransport", {});
  await import("./web-bootstrap");
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(Socket.all).toHaveLength(0);
  expect(window.api).toBeUndefined();
});
