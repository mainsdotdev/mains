import { describe, expect, it } from "vitest";
import { terminalIdleShells, terminalListeners, terminalProcessOwners } from "./terminal-servers";

describe("terminal TCP server ownership", () => {
  const roots = new Map([["website", 100], ["api", 200]]);
  const processes = "100 1\n110 100\n111 110\n200 1\n210 200\n900 1\n";

  it("follows nested child shells and keeps unrelated host processes out", () => {
    const owners = terminalProcessOwners(roots, processes);
    expect(owners.get(111)).toBe("website");
    expect(owners.get(210)).toBe("api");
    expect(owners.has(900)).toBe(false);
    const result = terminalListeners(roots, owners, "p111\ncnode\nf1\nn127.0.0.1:3000\np210\ncpython\nf2\nn*:8080\np900\ncnode\nf3\nn*:9999\n");
    expect(result.get("website")).toEqual([{ pid: 111, port: 3000, command: "node" }]);
    expect(result.get("api")).toEqual([{ pid: 210, port: 8080, command: "python" }]);
  });

  it("counts a dual-stack listener once and supports several ports in one terminal", () => {
    const result = terminalListeners(roots, terminalProcessOwners(roots, processes),
      "p111\ncnode\nf1\nn127.0.0.1:3000\nf2\nn[::1]:3000\nf3\nn*:4000\n");
    expect(result.get("website")?.map((server) => server.port)).toEqual([3000, 4000]);
    expect(result.get("api")).toEqual([]);
  });

  it("leaves idle shells and foreground commands without listening sockets inactive", () => {
    expect(terminalListeners(roots, terminalProcessOwners(roots, processes), "")).toEqual(
      new Map([["website", []], ["api", []]]),
    );
  });

  it("tolerates malformed snapshots and cyclic parent relationships", () => {
    const owners = terminalProcessOwners(roots, "100 110\n110 100\nbad row\n0 100\n99999999999999999999 100\n");
    expect([...owners.keys()]).toEqual([100, 110, 200]);
    const result = terminalListeners(roots, owners, "p110\ncnode\nn*:0\nn*:65536\nninvalid\nn[::1]:4000\n");
    expect(result.get("website")).toEqual([{ pid: 110, port: 4000, command: "node" }]);
  });
});

describe("idle shell process inspection", () => {
  const roots = new Map([["idle", 100], ["foreground", 200], ["background", 300], ["cpu", 400], ["missing", 500]]);
  it("preserves foreground and background jobs, running shell code and missing processes", () => {
    const table = "100 1 100 100 Ss+\n200 1 200 210 Ss\n210 200 210 210 S+\n300 1 300 300 Ss+\n310 300 310 300 T\n400 1 400 400 Rs+\n900 0 0 -1 S\n";
    expect([...terminalIdleShells(roots, table)]).toEqual(["idle"]);
  });
  it("does not treat a malformed or truncated process table as authoritative", () => {
    expect(() => terminalIdleShells(roots, "100 1 100 100 Ss+\nbroken child row\n")).toThrow("Incomplete");
    expect(() => terminalIdleShells(roots, "999999999999999999999 1 100 100 S\n")).toThrow("Invalid");
  });
  it("recognizes macOS shells that have been sleeping for more than twenty seconds", () => {
    expect([...terminalIdleShells(roots, "100 1 100 100 Is+\n")]).toEqual(["idle"]);
  });
});
