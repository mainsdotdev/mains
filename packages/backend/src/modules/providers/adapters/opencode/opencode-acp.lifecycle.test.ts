import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenCodeAcpServer } from "./opencode-acp";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("../provider-process", () => ({
  spawnProvider: mocks.spawn,
  killProviderProcess: (child: { kill(signal: string): void }, signal = "SIGKILL") => child.kill(signal),
}));
class Child extends EventEmitter {
  stdout = new PassThrough(); stderr = new PassThrough();
  exitCode: number | null = null;
  calls: any[] = [];
  stdin = new Writable({ write: (chunk, _encoding, done) => { this.calls.push(JSON.parse(chunk.toString())); done(); } });
  kill = vi.fn(() => { queueMicrotask(() => this.close()); return true; });
  close() { this.exitCode = 0; this.emit("close", 0, null); }
  send(message: object) { this.stdout.write(JSON.stringify(message) + "\n"); }
}
describe("OpenCode ACP transport lifecycle", () => {
  let child: Child, client: OpenCodeAcpServer;
  beforeEach(() => { child = new Child(); client = new OpenCodeAcpServer(); mocks.spawn.mockReset().mockReturnValue(child); });
  afterEach(async () => { child.close(); await client.stop(); vi.useRealTimers(); vi.restoreAllMocks(); });
  async function start() { const opening = client.start("fixture"); child.emit("spawn"); await opening; }

  it("retains a child past the forced-kill deadline until close and blocks replacement", async () => {
    await start(); vi.useFakeTimers(); child.kill.mockImplementation(() => true);
    let done = false;
    const closing = client.stop().then(() => { done = true; });
    try {
      await vi.advanceTimersByTimeAsync(2100);
      expect(done).toBe(false);
      await expect(client.start("replacement")).rejects.toThrow("stopping");
      expect(mocks.spawn).toHaveBeenCalledOnce();
    } finally { child.close(); await closing; }
  });
  it("shares startup and admits RPC only after the spawn event", async () => {
    const first = client.start("fixture"), second = client.start("fixture");
    expect(client.isRunning).toBe(false);
    await expect(client.sendRequest("initialize")).rejects.toThrow("not running");
    child.emit("spawn"); await Promise.all([first, second]);
    expect(client.isRunning).toBe(true);
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each(["error", "stdin", "exit"])("settles pending RPC once on %s before close and fences further writes", async (reason) => {
    await start(); vi.useFakeTimers();
    child.kill.mockImplementation(() => true);
    let rejected = 0;
    const request = client.sendRequest("session/prompt").catch((error) => { rejected++; throw error; });
    const failed = expect(request).rejects.toThrow(reason === "exit" ? "exited" : "broken transport");
    if (reason === "exit") { child.exitCode = 1; child.emit("exit", 1, null); }
    else (reason === "stdin" ? child.stdin : child).emit("error", new Error("broken transport"));
    await failed;
    await expect(client.sendRequest("another")).rejects.toThrow("not running");
    child.send({ id: child.calls[0].id, result: { stale: true } });
    child.close(); await client.stop();
    expect(rejected).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes an aborted RPC's timer and ignores its late response", async () => {
    await start(); vi.useFakeTimers();
    const controller = new AbortController();
    const old = client.sendRequest("old", {}, 60_000, controller.signal);
    const canceled = expect(old).rejects.toThrow("canceled");
    controller.abort(new Error("canceled")); await canceled;
    expect(vi.getTimerCount()).toBe(0);
    const next = client.sendRequest("next");
    child.send({ id: child.calls[0].id, result: "old response" });
    child.send({ id: child.calls[1].id, result: "new response" });
    await expect(next).resolves.toBe("new response");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases a serialization failure's timer while preserving the usable connection", async () => {
    await start(); vi.useFakeTimers();
    const circular: any = {}; circular.self = circular;
    await expect(client.sendRequest("bad", circular)).rejects.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    expect(child.calls).toHaveLength(0);
    const next = client.sendRequest("next");
    child.send({ id: child.calls[0].id, result: { ok: true } });
    await expect(next).resolves.toEqual({ ok: true });
  });

  it("settles an asynchronous write failure and retires its connection", async () => {
    await start(); vi.useFakeTimers();
    vi.spyOn(child.stdin, "write").mockImplementation((_chunk: any, callback: any) => {
      queueMicrotask(() => callback(new Error("write failed"))); return false;
    });
    await expect(client.sendRequest("failed-write")).rejects.toThrow("write failed");
    await client.stop();
    expect(client.isRunning).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("decodes UTF-8 correctly when every multibyte character is split across chunks", async () => {
    await start();
    const request = client.sendRequest("unicode");
    const bytes = Buffer.from(JSON.stringify({ id: child.calls[0].id, result: "İstanbul 😀" }) + "\n");
    for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
    await expect(request).resolves.toBe("İstanbul 😀");
  });

  it("retains a failed kill for retry and blocks replacement until close", async () => {
    await start();
    child.kill.mockImplementationOnce(() => { throw new Error("kill failed"); });
    await expect(client.stop()).rejects.toThrow("kill failed");
    await expect(client.start("replacement")).rejects.toThrow("stopping");
    expect(mocks.spawn).toHaveBeenCalledOnce();
    await client.stop();
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(client.isRunning).toBe(false);
  });

  it("stops dispatching a buffered notification batch as soon as its owner retires", async () => {
    await start();
    const notification = vi.fn(() => { void client.stop(); });
    client.setNotificationHandler(notification);
    child.stdout.write(JSON.stringify({ method: "first" }) + "\n" + JSON.stringify({ method: "retired" }) + "\n");
    await client.stop();
    expect(notification).toHaveBeenCalledOnce();
  });

  it("fences retired child output and errors after a new process is ready", async () => {
    await start(); await client.stop();
    const old = child; child = new Child(); mocks.spawn.mockReturnValue(child);
    await start();
    const notification = vi.fn(); client.setNotificationHandler(notification);
    const pending = client.sendRequest("new");
    old.send({ method: "session/update", params: { stale: true } });
    old.emit("error", new Error("retired error"));
    old.emit("close", 1, null);
    child.send({ id: child.calls[0].id, result: "current" });
    await expect(pending).resolves.toBe("current");
    expect(notification).not.toHaveBeenCalled();
    expect(client.isRunning).toBe(true);
  });
});
