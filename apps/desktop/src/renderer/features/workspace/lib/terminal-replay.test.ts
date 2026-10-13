import { describe, expect, it, vi } from "vitest";
import { createTerminalReplay } from "./terminal-replay";
import type { TerminalSnapshot } from "@mains/contracts/terminal";

const snapshot = (data: string, sequence: number) => ({ data, sequence } as TerminalSnapshot);

describe("terminal output replay", () => {
  it("deduplicates output delivered both in the snapshot and in live events", () => {
    const write = vi.fn();
    const replay = createTerminalReplay(write);
    replay.push({ id: "t", data: "ready", sequence: 1 });
    replay.push({ id: "t", data: "request", sequence: 2 });
    replay.restore(snapshot("ready", 1));
    replay.push({ id: "t", data: "request", sequence: 2 });
    replay.push({ id: "t", data: "response", sequence: 3 });
    expect(write.mock.calls.map(([data]) => data)).toEqual(["ready", "request", "response"]);
  });

  it("queues output during reconnect until the new snapshot is restored", () => {
    const write = vi.fn();
    const replay = createTerminalReplay(write);
    replay.restore(snapshot("one", 1));
    replay.begin();
    replay.push({ id: "t", data: "two", sequence: 2 });
    expect(write).toHaveBeenCalledTimes(1);
    replay.restore(snapshot("one two", 2));
    replay.push({ id: "t", data: "three", sequence: 3 });
    expect(write.mock.calls.map(([data]) => data)).toEqual(["one", "one two", "three"]);
  });

  it("bounds pending output when the backend is slow to answer", () => {
    const write = vi.fn();
    const replay = createTerminalReplay(write);
    for (let sequence = 1; sequence <= 100; sequence++) replay.push({ id: "t", data: "x".repeat(5000), sequence });
    replay.push({ id: "t", data: "latest", sequence: 101 });
    replay.restore(snapshot("", 0));
    expect(write.mock.calls.reduce((sum, [data]) => sum + data.length, 0)).toBeLessThanOrEqual(128 * 1024);
    expect(write).toHaveBeenLastCalledWith("latest");
  });
});
