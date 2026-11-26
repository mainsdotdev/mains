vi.mock("../bridge", () => ({ assertOwnedRecord: vi.fn() }));
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalServerScan } from "./terminal-servers";

const mocks = vi.hoisted(() => ({ scan: vi.fn(), spawn: vi.fn() }));
vi.mock("./terminal-servers", () => ({ scanTerminalServers: mocks.scan }));
vi.mock("node-pty", () => ({ spawn: mocks.spawn }));
vi.mock("./terminal-shell", async (importOriginal) => {
  const original = await importOriginal<typeof import("./terminal-shell")>();
  return { ...original, workspaceShellEnvironment: (env: Record<string, string>) => ({ env, signals: original.terminalShellSignals("test") }) };
});
import { terminalService } from "./terminal.service";

let stopWatch: (() => void) | undefined;
let nextPid = 100;
const changed = vi.fn();
const server = { pid: 111, port: 3000, command: "node" };
const prompt = "\x1b]633;Mains;test;idle\x07";
const shellData = new Map<number, (data: string) => void>();
function scanResult(servers: [string, typeof server[]][], children: string[] = []): TerminalServerScan {
  return { servers: new Map(servers), withChildren: new Set(children) };
}
function create(id: string, workspaceId: string | undefined = id) {
  return terminalService.create(id, os.tmpdir(), () => {}, { workspaceId });
}

beforeEach(() => {
  vi.useFakeTimers();
  terminalService.destroyAll();
  nextPid = 100;
  shellData.clear();
  changed.mockClear();
  mocks.scan.mockReset().mockImplementation(async (roots: Map<string, number>) => scanResult([...roots.keys()].map((id) => [id, []])));
  mocks.spawn.mockReset().mockImplementation(() => {
    const pid = ++nextPid;
    return { pid, onData(callback: (data: string) => void) {
      shellData.set(pid, callback);
      return { dispose() {} };
    }, onExit: () => ({ dispose() {} }), kill: vi.fn(), write: vi.fn() };
  });
});
afterEach(() => { stopWatch?.(); stopWatch = undefined; terminalService.destroyAll(); vi.useRealTimers(); });

describe("terminal server monitor", () => {
  it("keeps a failed acquisition owned for Stop without polling an unusable shell", () => {
    const kill = vi.fn().mockImplementationOnce(() => { throw new Error("Stop failed"); });
    mocks.spawn.mockImplementationOnce(() => ({ pid: 500, kill,
      onData: () => ({ dispose() {} }), onExit: () => { throw new Error("Listener setup failed"); },
    }));
    expect(() => create("broken")).toThrow(/initialization and cleanup/);
    expect(terminalService.list().map((session) => session.id)).toEqual(["broken"]);
    expect(() => terminalService.attach("broken", () => {})).toThrow(/initialization failed/);
    stopWatch = terminalService.watchServers(changed);
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.scan).not.toHaveBeenCalled();
  });
  it("retires an old watcher scan without blocking or clearing its replacement", async () => {
    create("a");
    const previousChanged = vi.fn(), currentChanged = vi.fn();
    stopWatch = terminalService.watchServers(previousChanged);
    let finishOld!: (result: TerminalServerScan) => void;
    let finishNew!: (result: TerminalServerScan) => void;
    mocks.scan.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }));
    const old = terminalService.refreshServers();
    await Promise.resolve();
    stopWatch(); stopWatch = terminalService.watchServers(currentChanged);
    const fresh = terminalService.refreshServers();
    try {
      expect(fresh).not.toBe(old);
      await Promise.resolve();
      finishOld(scanResult([["a", [server]]])); await old;
      expect(terminalService.list()[0].servers).toBeNull();
      expect(terminalService.refreshServers()).toBe(fresh);
      finishNew(scanResult([["a", [{ ...server, port: 4000 }]]])); await fresh;
      expect(terminalService.list()[0].servers?.[0].port).toBe(4000);
      expect(previousChanged).not.toHaveBeenCalled(); expect(currentChanged).toHaveBeenCalledOnce();
    } finally { finishOld?.(scanResult([])); finishNew?.(scanResult([])); await Promise.allSettled([old, fresh]); }
  });
  it("batches workspace shells and never scans provider sign-in terminals", async () => {
    create("a"); create("b");
    terminalService.create("auth", os.tmpdir(), () => {});
    await terminalService.refreshServers();
    expect(mocks.scan).toHaveBeenCalledOnce();
    expect([...mocks.scan.mock.calls[0][0].keys()]).toEqual(["a", "b"]);
    expect(terminalService.list().every((session) => session.servers?.length === 0)).toBe(true);
  });

  it("coalesces overlapping scans and does not assign old results to a reused terminal id", async () => {
    create("a"); create("b");
    let finish!: (value: TerminalServerScan) => void;
    mocks.scan.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = terminalService.refreshServers();
    expect(terminalService.refreshServers()).toBe(first);
    await Promise.resolve();
    terminalService.destroy("a");
    create("a");
    finish(scanResult([["a", [server]], ["b", [server]]]));
    await first;
    expect(mocks.scan).toHaveBeenCalledOnce();
    expect(terminalService.list().find((session) => session.id === "a")?.servers).toBeNull();
    expect(terminalService.list().find((session) => session.id === "b")?.servers).toEqual([server]);
  });

  it("updates only changed listener lists and stops polling when the last shell is destroyed", async () => {
    stopWatch = terminalService.watchServers(changed);
    create("a");
    await vi.advanceTimersByTimeAsync(2500);
    expect(changed).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2500);
    expect(changed).toHaveBeenCalledOnce();
    mocks.scan.mockResolvedValue(scanResult([["a", [server]]]));
    await vi.advanceTimersByTimeAsync(2500);
    expect(changed).toHaveBeenCalledTimes(2);
    const snapshot = terminalService.list()[0];
    snapshot.servers![0].port = 9999;
    expect(terminalService.list()[0].servers![0].port).toBe(3000);
    mocks.scan.mockResolvedValue(scanResult([["a", []]]));
    await vi.advanceTimersByTimeAsync(2500);
    expect(changed).toHaveBeenCalledTimes(3);
    expect(terminalService.list()[0].status).toBe("running");
    terminalService.destroy("a");
    expect(vi.getTimerCount()).toBe(0);
    const count = mocks.scan.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.scan).toHaveBeenCalledTimes(count);
  });

  it("backs off after verifying an idle prompt and wakes for a submitted command", async () => {
    stopWatch = terminalService.watchServers(changed);
    create("a");
    const data = shellData.get(nextPid)!;
    data(prompt);
    await vi.advanceTimersByTimeAsync(2500);
    expect(mocks.scan).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(14999);
    expect(mocks.scan).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.scan).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    terminalService.write("a", "npm run dev &\r");
    data(prompt);
    mocks.scan.mockResolvedValue(scanResult([["a", []]], ["a"]));
    await vi.advanceTimersByTimeAsync(2500);
    expect(mocks.scan).toHaveBeenCalledTimes(3);
    mocks.scan.mockResolvedValue(scanResult([["a", [server]]], ["a"]));
    await vi.advanceTimersByTimeAsync(2500);
    expect(terminalService.list()[0].servers).toEqual([server]);
  });

  it("does not back off existing listeners opened by a shell at its prompt", async () => {
    stopWatch = terminalService.watchServers(changed);
    create("a");
    shellData.get(nextPid)!(prompt);
    mocks.scan.mockResolvedValue(scanResult([["a", [server]]]));
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.scan).toHaveBeenCalledTimes(2);
    expect(terminalService.list()[0].servers).toEqual([server]);
  });

  it("keeps a quick discovery check when work starts during an earlier empty probe", async () => {
    stopWatch = terminalService.watchServers(changed);
    create("a");
    const data = shellData.get(nextPid)!;
    data(prompt);
    let finish!: (result: TerminalServerScan) => void;
    mocks.scan.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(2500);
    terminalService.write("a", "npm run dev &\r");
    data(prompt);
    finish(scanResult([["a", []]]));
    await vi.advanceTimersByTimeAsync(2500);
    expect(mocks.scan).toHaveBeenCalledTimes(2);
  });

  it("marks failed inspections unavailable and recovers on a later successful scan", async () => {
    create("a");
    mocks.scan.mockResolvedValue(scanResult([["a", [server]]]));
    await terminalService.refreshServers();
    mocks.scan.mockRejectedValue(new Error("lsof unavailable"));
    await expect(terminalService.refreshServers()).resolves.toBeUndefined();
    expect(terminalService.list()[0].servers).toBeNull();
    mocks.scan.mockResolvedValue(scanResult([["a", []]]));
    await terminalService.refreshServers();
    expect(terminalService.list()[0].servers).toEqual([]);
  });
});
