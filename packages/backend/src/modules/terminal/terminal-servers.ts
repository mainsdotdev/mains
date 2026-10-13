import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TerminalServer } from "@mains/contracts/terminal";

const execFileAsync = promisify(execFile);
const COMMAND_OPTIONS = { encoding: "utf8" as const, timeout: 2000, maxBuffer: 1024 * 1024 };

/** One process snapshot for every terminal, including nested npm/child shells. */
export function terminalProcessOwners(roots: ReadonlyMap<string, number>, processes: string): Map<number, string> {
  const children = new Map<number, number[]>();
  for (const line of processes.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const parent = Number(match[2]);
    if (pid <= 0 || parent < 0 || !Number.isSafeInteger(pid) || !Number.isSafeInteger(parent)) continue;
    const siblings = children.get(parent) ?? [];
    siblings.push(pid);
    children.set(parent, siblings);
  }
  const owners = new Map<number, string>();
  for (const [id, root] of roots) {
    const pending = [root];
    while (pending.length > 0) {
      const pid = pending.pop()!;
      if (owners.has(pid)) continue;
      owners.set(pid, id);
      pending.push(...children.get(pid) ?? []);
    }
  }
  return owners;
}

/** lsof's field format avoids parsing aligned columns or shell command text. */
export function terminalListeners(roots: ReadonlyMap<string, number>, owners: ReadonlyMap<number, string>, output: string): Map<string, TerminalServer[]> {
  const result = new Map([...roots.keys()].map((id) => [id, [] as TerminalServer[]]));
  const seen = new Set<string>();
  let pid = 0;
  let command = "";
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) { pid = Number(line.slice(1)); command = ""; }
    else if (line.startsWith("c")) command = line.slice(1).slice(0, 80);
    else if (line.startsWith("n")) {
      const owner = owners.get(pid);
      const match = line.match(/:(\d+)$/);
      const port = match ? Number(match[1]) : 0;
      if (!owner || port < 1 || port > 65535 || seen.has(`${pid}:${port}`)) continue;
      seen.add(`${pid}:${port}`);
      result.get(owner)?.push({ pid, port, command: command || "Server" });
    }
  }
  for (const servers of result.values()) servers.sort((a, b) => a.port - b.port || a.pid - b.pid);
  return result;
}

export async function scanTerminalServers(roots: ReadonlyMap<string, number>): Promise<Map<string, TerminalServer[]>> {
  if (roots.size === 0) return new Map();
  const { stdout: processes } = await execFileAsync(process.platform === "darwin" ? "/bin/ps" : "ps", ["-axo", "pid=,ppid="], COMMAND_OPTIONS);
  const owners = terminalProcessOwners(roots, processes);
  return scanListeners(roots, owners);
}

async function scanListeners(roots: ReadonlyMap<string, number>, owners: ReadonlyMap<number, string>): Promise<Map<string, TerminalServer[]>> {
  // Inspect only this app's terminal process trees, not every socket on the host.
  const pids = [...owners.keys()];
  if (pids.length > 4096) throw new Error("Terminal process tree is too large to inspect.");
  let listeners: string;
  try {
    const result = await execFileAsync(process.platform === "darwin" ? "/usr/sbin/lsof" : "lsof", ["-nP", "-a", "-p", pids.join(","), "-iTCP", "-sTCP:LISTEN", "-Fpcn"], COMMAND_OPTIONS);
    listeners = result.stdout;
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    // lsof exits 1 for a successful search with no matching listeners.
    if (failure.code !== 1 || failure.stderr?.trim()) throw error;
    listeners = failure.stdout ?? "";
  }
  return terminalListeners(roots, owners, listeners);
}

/** A sleeping foreground shell with no child jobs is eligible for idle cleanup. */
export function terminalIdleShells(roots: ReadonlyMap<string, number>, processes: string): Set<string> {
  const rows = new Map<number, { parent: number; group: number; foreground: number; state: string }>();
  const parents = new Set<number>();
  for (const line of processes.split("\n")) {
    if (!line.trim()) continue;
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)$/);
    if (!match) throw new Error("Incomplete terminal process inspection.");
    const [pid, parent, group, foreground] = match.slice(1, 5).map(Number);
    if (![pid, parent, group, foreground].every(Number.isSafeInteger) || pid <= 0 || parent < 0 || group < 0) {
      throw new Error("Invalid terminal process inspection.");
    }
    rows.set(pid, { parent, group, foreground, state: match[5] });
    parents.add(parent);
  }
  return new Set([...roots].filter(([, pid]) => {
    const row = rows.get(pid);
    return row && row.group > 0 && row.group === row.foreground && /^[SI]/.test(row.state) && !parents.has(pid);
  }).map(([id]) => id));
}

/** Fresh process and socket checks, including listeners opened by shell builtins. */
export async function scanIdleTerminalShells(roots: ReadonlyMap<string, number>): Promise<Set<string>> {
  if (roots.size === 0) return new Set();
  const { stdout } = await execFileAsync(process.platform === "darwin" ? "/bin/ps" : "ps",
    ["-axo", "pid=,ppid=,pgid=,tpgid=,stat="], COMMAND_OPTIONS);
  const idle = terminalIdleShells(roots, stdout);
  if (idle.size === 0) return idle;
  const candidates = new Map([...roots].filter(([id]) => idle.has(id)));
  const listeners = await scanListeners(candidates, new Map([...candidates].map(([id, pid]) => [pid, id])));
  for (const [id, servers] of listeners) if (servers.length > 0) idle.delete(id);
  return idle;
}
