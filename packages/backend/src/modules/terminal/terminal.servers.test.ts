vi.mock("../bridge", () => ({ assertOwnedRecord: vi.fn() }));
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ scan: vi.fn(), spawn: vi.fn() }));
vi.mock("./terminal-servers", () => ({ scanTerminalServers: mocks.scan }));
vi.mock("node-pty", () => ({ spawn: mocks.spawn }));
import { terminalService } from "./terminal.service";

let stopWatch: (() => void) | undefined;
let nextPid = 100;
const changed = vi.fn();
const server = { pid: 111, port: 3000, command: "node" };
function create(id: string, workspaceId: string | undefined = id) {
  return terminalService.create(id, os.tmpdir(), () => {}, { workspaceId });
}

beforeEach(() => {
  vi.useFakeTimers();
  terminalService.destroyAll();
  nextPid = 100;
  changed.mockClear();
  mocks.scan.mockReset().mockImplementation(async (roots: Map<string, number>) => new Map([...roots.keys()].map((id) => [id, []])));
  mocks.spawn.mockReset().mockImplementation(() => ({ pid: ++nextPid,
    onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), kill: vi.fn() }));
});
afterEach(() => { stopWatch?.(); stopWatch = undefined; terminalService.destroyAll(); vi.useRealTimers(); });

describe("terminal server monitor", () => {
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
    let finish!: (value: Map<string, typeof server[]>) => void;
    mocks.scan.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = terminalService.refreshServers();
    expect(terminalService.refreshServers()).toBe(first);
    terminalService.destroy("a");
    create("a");
    finish(new Map([["a", [server]], ["b", [server]]]));
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
    mocks.scan.mockResolvedValue(new Map([["a", [server]]]));
    await vi.advanceTimersByTimeAsync(2500);
    expect(changed).toHaveBeenCalledTimes(2);
    const snapshot = terminalService.list()[0];
    snapshot.servers![0].port = 9999;
    expect(terminalService.list()[0].servers![0].port).toBe(3000);
    mocks.scan.mockResolvedValue(new Map([["a", []]]));
    await vi.advanceTimersByTimeAsync(2500);
    expect(changed).toHaveBeenCalledTimes(3);
    expect(terminalService.list()[0].status).toBe("running");
    terminalService.destroy("a");
    expect(vi.getTimerCount()).toBe(0);
    const count = mocks.scan.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.scan).toHaveBeenCalledTimes(count);
  });

  it("marks failed inspections unavailable and recovers on a later successful scan", async () => {
    create("a");
    mocks.scan.mockResolvedValue(new Map([["a", [server]]]));
    await terminalService.refreshServers();
    mocks.scan.mockRejectedValue(new Error("lsof unavailable"));
    await expect(terminalService.refreshServers()).resolves.toBeUndefined();
    expect(terminalService.list()[0].servers).toBeNull();
    mocks.scan.mockResolvedValue(new Map([["a", []]]));
    await terminalService.refreshServers();
    expect(terminalService.list()[0].servers).toEqual([]);
  });
});
