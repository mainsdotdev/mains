import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ spawn: vi.fn(), request: vi.fn(), createServer: vi.fn() }));
vi.mock("child_process", () => ({ spawn: io.spawn }));
vi.mock("http", () => ({ request: io.request }));
vi.mock("net", () => ({ createServer: io.createServer }));
import { sshService } from "./ssh.service";

let children: Array<EventEmitter & { stderr: EventEmitter; killed: boolean; kill: ReturnType<typeof vi.fn> }>;
let requests: Array<{ request: EventEmitter & { end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }; respond: (response: { resume(): void }) => void }>;
let holdPort: boolean, portCallbacks: Array<() => void>;
beforeEach(() => {
  children = []; requests = []; holdPort = false; portCallbacks = [];
  (sshService as any).start?.();
  io.createServer.mockImplementation(() => {
    const server = new EventEmitter() as any;
    server.address = () => ({ port: 12345 });
    server.close = vi.fn((callback) => callback?.());
    server.listen = vi.fn((_port, _host, callback) => { portCallbacks.push(callback); if (!holdPort) queueMicrotask(callback); });
    return server;
  });
  io.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), killed: false, kill: vi.fn() });
    child.kill.mockImplementation(() => { child.killed = true; return true; });
    children.push(child); queueMicrotask(() => child.emit("spawn"));
    return child;
  });
  io.request.mockImplementation((_options, respond) => {
    const request = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
    requests.push({ request, respond }); return request;
  });
});
afterEach(async () => {
  const closing = sshService.closeAllTunnels();
  for (const child of children) child.emit("close", 0, null);
  await closing;
  vi.clearAllMocks(); vi.useRealTimers();
});

it("never publishes a ready tunnel after shutdown retired its pending probe", async () => {
  const opening = sshService.openTunnel({ host: "dev", remotePort: 8787 });
  const result = opening.catch((error: Error) => error);
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  const closing = sshService.closeAllTunnels();
  children[0].emit("exit", 0, null); children[0].emit("close", 0, null);
  requests[0].respond({ resume() {} });
  expect(await result).toBeInstanceOf(Error);
  await closing;
});

it("does not publish readiness when the child exits after HTTP responds but before promotion", async () => {
  const opening = sshService.openTunnel({ host: "dev", remotePort: 8787 });
  const result = opening.catch((error: Error) => error);
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  requests[0].respond({ resume() {} }); children[0].emit("exit", 1, null);
  expect(await result).toBeInstanceOf(Error);
});

it("drains a canceled port allocation before acknowledging shutdown and never spawns late", async () => {
  holdPort = true;
  const opening = sshService.openTunnel({ host: "dev", remotePort: 8787 });
  const result = opening.catch((error: Error) => error);
  let drained = false;
  const closing = sshService.closeAllTunnels().then(() => { drained = true; });
  await new Promise((resolve) => setImmediate(resolve));
  expect(drained).toBe(false);
  portCallbacks[0]();
  expect(await result).toBeInstanceOf(Error); await closing;
  expect(io.spawn).not.toHaveBeenCalled();
});

it("retains ownership until actual child close, including repeated close requests", async () => {
  const opening = sshService.openTunnel({ host: "dev", remotePort: 8787 });
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  requests[0].respond({ resume() {} });
  const handle = await opening;
  let closed = false;
  const first = sshService.closeTunnel(handle.id).then(() => { closed = true; });
  const second = sshService.closeTunnel(handle.id);
  children[0].emit("exit", 0, null); await Promise.resolve();
  expect(closed).toBe(false);
  children[0].emit("close", 0, null); await Promise.all([first, second]);
  expect(children[0].kill).toHaveBeenCalledTimes(1);
});

it("cancels one request without closing a different ready tunnel", async () => {
  const ready = sshService.openTunnel({ host: "ready", remotePort: 8787, requestId: "keep" });
  await vi.waitFor(() => expect(requests).toHaveLength(1)); requests[0].respond({ resume() {} }); await ready;
  const pending = sshService.openTunnel({ host: "pending", remotePort: 8787, requestId: "cancel" });
  const result = pending.catch((error: Error) => error);
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  const stopping = sshService.cancelTunnelOpen("cancel"); children[1].emit("close", 0, null);
  expect(await result).toBeInstanceOf(Error); await stopping;
  expect(children[0].kill).not.toHaveBeenCalled();
});

it("joins an identical open request and rejects conflicting reuse before another spawn", async () => {
  const input = { host: "dev", remotePort: 8787, requestId: "same" };
  const first = sshService.openTunnel(input), second = sshService.openTunnel(input);
  await expect(sshService.openTunnel({ ...input, host: "different" })).rejects.toThrow("another connection");
  await vi.waitFor(() => expect(requests).toHaveLength(1)); requests[0].respond({ resume() {} });
  expect(await second).toEqual(await first); expect(io.spawn).toHaveBeenCalledTimes(1);
});

it("rejects an open whose cancellation arrived before admission", async () => {
  await sshService.cancelTunnelOpen("already-canceled");
  await expect(sshService.openTunnel({ host: "dev", remotePort: 8787, requestId: "already-canceled" })).rejects.toThrow("canceled");
  expect(io.spawn).not.toHaveBeenCalled();
});

it("coalesces timeout and error from one probe into one retry and disposes all timers", async () => {
  vi.useFakeTimers();
  const opening = sshService.openTunnel({ host: "dev", remotePort: 8787, requestId: "retry" });
  const result = opening.catch((error: Error) => error);
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  requests[0].request.emit("timeout"); requests[0].request.emit("error", new Error("socket closed"));
  await vi.advanceTimersByTimeAsync(500); expect(requests).toHaveLength(2);
  const closing = sshService.cancelTunnelOpen("retry"); children[0].emit("close", 0, null);
  expect(await result).toBeInstanceOf(Error); await closing;
  expect(vi.getTimerCount()).toBe(0);
});

it("forces termination after the grace deadline without treating the signal as confirmed close", async () => {
  vi.useFakeTimers();
  const opening = sshService.openTunnel({ host: "dev", remotePort: 8787 });
  await vi.waitFor(() => expect(requests).toHaveLength(1)); requests[0].respond({ resume() {} });
  const handle = await opening;
  let closed = false;
  const closing = sshService.closeTunnel(handle.id).then(() => { closed = true; });
  await vi.advanceTimersByTimeAsync(1500);
  expect(children[0].kill).toHaveBeenLastCalledWith("SIGKILL"); expect(closed).toBe(false);
  children[0].emit("close", 0, null); await closing;
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves a spawn failure and retains the failed child until close", async () => {
  io.spawn.mockImplementationOnce(() => {
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), killed: false, kill: vi.fn(() => true) });
    children.push(child); queueMicrotask(() => child.emit("error", new Error("spawn ssh ENOENT")));
    return child;
  });
  const opening = sshService.openTunnel({ host: "dev", remotePort: 8787 });
  await expect(opening).rejects.toThrow("ENOENT");
  const closing = sshService.closeAllTunnels();
  expect(() => sshService.start()).toThrow("cleanup is still pending");
  children[0].emit("close", -1, null); await closing;
});

it.each([false, true])("bounds backend readiness with auto-launch=%s and ignores a late HTTP reply", async (launch) => {
  vi.useFakeTimers();
  const opening = sshService.openTunnel({ host: "dev", remotePort: 8787, ...(launch ? { remoteCommand: "mains serve" } : {}) });
  const result = opening.catch((error: Error) => error);
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  let token: string | undefined;
  if (launch) {
    token = String(io.spawn.mock.calls[0][1].at(-1)).match(/MAINS_SERVE_TOKEN='([^']+)'/)?.[1];
    children[0].stderr.emit("data", `launch failed ${token}`);
  }
  await vi.advanceTimersByTimeAsync(launch ? 45_000 : 15_000);
  const error = await result as Error;
  expect(error.message).toContain("not ready");
  if (token) expect(error.message).not.toContain(token);
  requests[0].respond({ resume() {} });
  const closing = sshService.closeAllTunnels(); children[0].emit("close", 0, null); await closing;
  expect(vi.getTimerCount()).toBe(0);
});
