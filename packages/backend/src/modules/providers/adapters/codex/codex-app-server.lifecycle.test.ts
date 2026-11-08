import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnProvider, killProviderProcess } from "../provider-process";
import { CodexAppServer } from "./codex-app-server.client";
import { createCodexServerLifecycle } from "./codex-server-lifecycle";
import type { ResourceScope } from "../../../../runtime/resource-lifecycle";

// Only the OS boundary is scripted, so late events and write/close races are
// deterministic. The client, streams, timers, framing and RPC routing are real.
vi.mock("../provider-process", () => ({
  spawnProvider: vi.fn(),
  killProviderProcess: vi.fn(),
}));

function childProcess() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    exitCode: null, signalCode: null,
  });
}
let children: ReturnType<typeof childProcess>[];
let servers: CodexAppServer[];
function createServer() {
  const server = new CodexAppServer({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  servers.push(server);
  return server;
}
async function start(server: CodexAppServer) {
  const opening = server.start("fixture-codex", "/fixture");
  const child = children.at(-1)!;
  child.emit("spawn");
  await opening;
  return child;
}
function initializedServer() {
  let current: CodexAppServer | undefined;
  const lifecycle = createCodexServerLifecycle(() => current?.isRunning ?? false);
  const open = async (scope: ResourceScope) => {
    const server = createServer();
    current = server;
    scope.defer(() => server.stop());
    await start(server);
    return server;
  };
  return { lifecycle, open };
}
beforeEach(() => {
  vi.useFakeTimers();
  children = []; servers = [];
  vi.mocked(spawnProvider).mockImplementation(() => {
    const child = childProcess(); children.push(child);
    return child as unknown as ChildProcess;
  });
});
afterEach(async () => {
  const closing = servers.map((server) => server.stop());
  children.forEach((child) => child.emit("close", 0));
  await Promise.all(closing);
  vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks();
});

describe("Codex process / JSON-RPC lifecycle", () => {
  it("shares crash recovery while exit is still waiting for child close", async () => {
    const { lifecycle, open } = initializedServer();
    const original = await lifecycle.start(open);
    const child = children[0];
    child.emit("exit", 17);
    const first = lifecycle.start(open);
    const second = lifecycle.start(open);
    await Promise.resolve();
    expect(children).toHaveLength(1);
    child.emit("close", 17);
    const [replacement, shared] = await Promise.all([first, second]);
    expect(replacement).toBe(shared);
    expect(replacement).not.toBe(original);
    expect(replacement.isRunning).toBe(true);
    expect(children).toHaveLength(2);
    const closing = lifecycle.close();
    children[1].emit("close", 0);
    await closing;
  });

  it("cancels recovery waiters on explicit shutdown without reopening a child", async () => {
    const { lifecycle, open } = initializedServer();
    await lifecycle.start(open);
    children[0].emit("exit", 17);
    const recovery = lifecycle.start(open);
    const rejected = expect(recovery).rejects.toThrow("canceled by close");
    const closing = lifecycle.close();
    children[0].emit("close", 17);
    await Promise.all([closing, rejected]);
    expect(children).toHaveLength(1);
    expect(lifecycle.ready).toBe(false);
  });

  it("ignores a timed-out response while preserving later request correlation", async () => {
    const server = createServer();
    const child = await start(server);
    const expired = server.sendRequest("account/read", {}, 20);
    const { id: expiredId } = JSON.parse(child.stdin.read().toString());
    const timedOut = expect(expired).rejects.toThrow("RPC timeout: account/read (20ms)");
    await vi.advanceTimersByTimeAsync(20);
    await timedOut;
    const response = server.sendRequest("account/read", {});
    const { id } = JSON.parse(child.stdin.read().toString());
    expect(id).not.toBe(expiredId);
    child.stdout.emit("data", Buffer.from([
      { id: expiredId, result: "late" }, { id: 99999, result: "unknown" },
      { id, result: "current" }, { id, error: { code: -1, message: "duplicate" } },
    ].map((message) => JSON.stringify(message)).join("\n")));
    await expect(response).resolves.toBe("current");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("correlates out-of-order success and RPC errors without retiring the transport", async () => {
    const server = createServer();
    const child = await start(server);
    const first = server.sendRequest("account/read", {});
    const second = server.sendRequest("model/list", {});
    const [a, b] = child.stdin.read().toString().trim().split("\n").map((line: string) => JSON.parse(line));
    const rejected = expect(second).rejects.toThrow("rejected (code: -32602)");
    child.stdout.emit("data", Buffer.from(JSON.stringify({ id: b.id, error: { code: -32602, message: "rejected" } })));
    child.stdout.emit("data", Buffer.from(JSON.stringify({ id: a.id, result: "accepted" })));
    await rejected;
    await expect(first).resolves.toBe("accepted");
    expect(server.isRunning).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the failed request timer when serialization fails and keeps other RPCs alive", async () => {
    const server = createServer();
    const child = await start(server);
    const good = server.sendRequest("account/read", {});
    const badParams = { refreshToken: false, toJSON() { throw new Error("serialization failed"); } };
    await expect(server.sendRequest("account/read", badParams)).rejects.toThrow("serialization failed");
    const { id } = JSON.parse(child.stdin.read().toString());
    child.stdout.emit("data", Buffer.from(JSON.stringify({ id, result: "accepted" })));
    await expect(good).resolves.toBe("accepted");
    expect(server.isRunning).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves UTF-8 and escaped braces across fragmented JSON-RPC responses", async () => {
    const server = createServer();
    const child = await start(server);
    const response = server.sendRequest("account/read", {});
    const { id } = JSON.parse(child.stdin.read().toString());
    const result = { label: 'Türkçe { \\" }' };
    const bytes = Buffer.from(JSON.stringify({ id, result }));
    const split = bytes.indexOf(Buffer.from("ü")) + 1;
    child.stdout.emit("data", bytes.subarray(0, split));
    child.stdout.emit("data", bytes.subarray(split, bytes.length - 1));
    child.stdout.emit("data", bytes.subarray(bytes.length - 1));
    await expect(response).resolves.toEqual(result);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coalesces starts, cancels startup on stop and fences a late spawn", async () => {
    const server = createServer();
    const first = server.start("fixture-codex", "/fixture");
    const second = server.start("fixture-codex", "/fixture");
    const results = Promise.allSettled([first, second]);
    expect(children).toHaveLength(1);
    expect(server.isRunning).toBe(false);
    const stopping = server.stop();
    children[0].emit("spawn");
    expect(server.isRunning).toBe(false);
    await expect(server.start("fixture-codex", "/fixture")).rejects.toThrow("stopping");
    children[0].emit("close", 0);
    await stopping;
    expect((await results).map((result) => result.status)).toEqual(["rejected", "rejected"]);
    await start(server);
    expect(server.isRunning).toBe(true);
    expect(children).toHaveLength(2);
  });

  it("shares stop, rejects every pending RPC once and waits for close after forced kill", async () => {
    const server = createServer();
    const child = await start(server);
    const onClose = vi.fn(); server.setOnClose(onClose);
    const failed = vi.fn();
    const requests = [server.sendRequest("account/read", {}), server.sendRequest("model/list", {})];
    const results = requests.map((request) => request.catch((error) => { failed(error.message); }));
    const stopping = server.stop();
    let stopped = false;
    void stopping.then(() => { stopped = true; });
    expect(server.stop()).toBe(stopping);
    await Promise.all(results);
    expect(failed.mock.calls).toEqual([["App-server stopping"], ["App-server stopping"]]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(killProviderProcess).toHaveBeenCalledTimes(1);
    expect(stopped).toBe(false);
    expect(server.isRunning).toBe(false);
    child.emit("error", new Error("late process error"));
    child.emit("exit", 1);
    child.emit("close", 1);
    child.emit("close", 1);
    await stopping;
    expect(failed).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("isolates late stdout, errors and close events from a replacement process", async () => {
    const server = createServer();
    const oldChild = await start(server);
    let finishWrite!: (error: Error) => void;
    vi.spyOn(oldChild.stdin, "write").mockImplementationOnce((_payload, callback) => {
      finishWrite = callback as unknown as (error: Error) => void;
      return true;
    });
    const retiredRequest = expect(server.sendRequest("account/read", {})).rejects.toThrow("App-server stopping");
    // An incomplete object belongs to this process only.
    oldChild.stdout.emit("data", Buffer.from('{"result":'));
    const stopping = server.stop(); oldChild.emit("close", 0); await stopping;
    await retiredRequest;
    const child = await start(server);
    const onNotification = vi.fn(); server.setNotificationHandler(onNotification);
    const onClose = vi.fn(); server.setOnClose(onClose);
    const response = server.sendRequest("account/read", {});
    const { id } = JSON.parse(child.stdin.read().toString());
    oldChild.stdout.emit("data", Buffer.from(JSON.stringify({ id, result: { stale: true } })));
    oldChild.stdout.emit("data", Buffer.from('{"method":"stale/notification"}'));
    oldChild.emit("error", new Error("retired process error"));
    oldChild.stdin.emit("error", new Error("retired stdin error"));
    finishWrite(new Error("retired write callback"));
    oldChild.emit("close", 1);
    child.stdout.emit("data", Buffer.from(JSON.stringify({ id, result: { current: true } })));
    await expect(response).resolves.toEqual({ current: true });
    expect(server.isRunning).toBe(true);
    expect(onNotification).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["throw", "callback", "stdin", "stdout", "stderr", "process"] as const)("settles outstanding RPCs on %s errors without waiting for RPC timeouts", async (failure) => {
    const server = createServer();
    const child = await start(server);
    const first = server.sendRequest("account/read", {});
    const failed = vi.fn();
    const firstResult = first.catch((error) => { failed(error.message); });
    if (failure === "throw") vi.spyOn(child.stdin, "write").mockImplementationOnce(() => { throw new Error("write failed"); });
    if (failure === "callback") vi.spyOn(child.stdin, "write").mockImplementationOnce((_payload, callback) => {
      (callback as unknown as (error: Error) => void)(new Error("write failed")); return false;
    });
    const secondResult = server.sendRequest("model/list", {}).catch((error) => { failed(error.message); });
    if (failure === "stdin") child.stdin.emit("error", new Error("write failed"));
    if (failure === "stdout") child.stdout.emit("error", new Error("write failed"));
    if (failure === "stderr") child.stderr.emit("error", new Error("write failed"));
    if (failure === "process") child.emit("error", new Error("write failed"));
    await Promise.all([firstResult, secondResult]);
    expect(failed).toHaveBeenCalledTimes(2);
    expect(failed.mock.calls.every(([message]) => message.includes("write failed"))).toBe(true);
    await expect(server.sendRequest("account/read", {})).rejects.toThrow("not running");
    child.emit("close", 1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(failed).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a broken stdin during spawn instead of publishing a running transport", async () => {
    const server = createServer();
    const opening = server.start("fixture-codex", "/fixture");
    const rejected = expect(opening).rejects.toThrow("broken pipe");
    const child = children[0];
    child.stdin.emit("error", new Error("broken pipe"));
    child.emit("spawn");
    child.emit("close", 1);
    await rejected;
    expect(server.isRunning).toBe(false);
  });
});
