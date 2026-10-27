import * as pty from "node-pty";
import { assertOwnedRecord } from "../bridge";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import type { TerminalCreateOptions, TerminalSession, TerminalSnapshot } from "@mains/contracts/terminal";
import { scanIdleTerminalShells, scanTerminalServers } from "./terminal-servers";
import { disposeShellIntegration, workspaceShellEnvironment } from "./terminal-shell";

type DataCallback = (id: string, data: string, sequence: number) => void;
type ExitCallback = (id: string, exitCode: number) => void;

interface PtyInstance {
  process: pty.IPty;
  onDataDispose: { dispose(): void };
  onExitDispose: { dispose(): void };
  onData: DataCallback;
  onExit?: ExitCallback;
  session: TerminalSession;
  data: string;
  sequence: number;
  shellSignals?: ReturnType<typeof workspaceShellEnvironment>["signals"];
  activityRevision: number;
  lastInputAt: number;
}

const instances = new Map<string, PtyInstance>();
const MAX_OUTPUT_CHARS = 128 * 1024;
const MAX_TERMINALS = 64;
const SERVER_CHECK_INTERVAL_MS = 2500;
let serversChanged: (() => void) | null = null;
let serverTimer: ReturnType<typeof setTimeout> | null = null;
let serverCheck: Promise<void> | null = null;

function cloneSession(session: TerminalSession): TerminalSession {
  return { ...session, servers: session.servers?.map((server) => ({ ...server })) ?? null };
}

function hasManagedShells(): boolean {
  return [...instances.values()].some((entry) => entry.session.workspaceId !== null &&
    entry.session.status === "running" && Number.isSafeInteger(entry.process.pid) && entry.process.pid > 0);
}

function scheduleServerCheck(): void {
  // The Windows beta retains PowerShell tabs until explicitly stopped. POSIX
  // process/listener probes and zsh prompt-based idle cleanup do not apply.
  if (process.platform === "win32") return;
  if (!serversChanged || serverTimer || !hasManagedShells()) return;
  serverTimer = setTimeout(() => {
    serverTimer = null;
    void terminalService.refreshServers().finally(scheduleServerCheck);
  }, SERVER_CHECK_INTERVAL_MS);
  serverTimer.unref();
}

function clearUnusedServerTimer(): void {
  if (serverTimer && !hasManagedShells()) { clearTimeout(serverTimer); serverTimer = null; }
}

function snapshot(instance: PtyInstance): TerminalSnapshot {
  return { session: cloneSession(instance.session), data: instance.data, sequence: instance.sequence };
}

function requireInstance(id: string): PtyInstance {
  const instance = instances.get(id);
  if (!instance) throw new Error("Terminal no longer exists. Open a new terminal.");
  return instance;
}

const SENSITIVE_ENV_PREFIXES = [
  "APPLE_", "GITHUB_TOKEN", "GITHUB_CLIENT_SECRET",
  "RESEND_", "NOTION_", "TADDY_", "RAINDROP_",
  "LINEAR_", "JIRA_", "ASANA_",
];

function getSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (SENSITIVE_ENV_PREFIXES.some((p) => key.startsWith(p))) continue;
    env[key] = value;
  }
  return env;
}

export const terminalService = {
  create(
    id: string, cwd: string | undefined, onData: DataCallback,
    options: Pick<TerminalCreateOptions, "workspaceId" | "workspaceName"> = {}, onExit?: ExitCallback,
  ): TerminalSnapshot {
    if (typeof id !== "string" || !id.trim() || id.length > 256) throw new Error("Invalid terminal id.");
    const existing = instances.get(id);
    // Reattaching a view must never replace its shell or the server inside it.
    if (existing) return this.attach(id, onData, onExit);
    if (instances.size >= MAX_TERMINALS) throw new Error("Too many open terminals. Stop an unused terminal first.");
    if (cwd !== undefined && (typeof cwd !== "string" || cwd.includes("\0"))) throw new Error("Invalid terminal directory.");
    for (const name of [options.workspaceId, options.workspaceName]) {
      if (name !== undefined && (typeof name !== "string" || !name.trim() || name.length > 256)) throw new Error("Invalid terminal workspace.");
    }
    if (options.workspaceId) assertOwnedRecord("workspaces", options.workspaceId);

    // Provider login terminals are workspace-less. Resolve their cwd on the
    // backend, not in the renderer, so remote backends use their own home.
    const resolved = path.resolve(cwd || os.homedir());
    if (!existsSync(resolved)) {
      throw new Error(`Terminal cwd does not exist: ${resolved}`);
    }

    const shell = process.platform === "win32" ? "powershell.exe" : "zsh";
    const workspaceId = options.workspaceId ?? null;
    const env = getSafeEnv();
    let integration: ReturnType<typeof workspaceShellEnvironment> | undefined;
    if (workspaceId !== null && shell === "zsh") {
      // Failure to install prompt signals keeps automatic cleanup disabled.
      try { integration = workspaceShellEnvironment(env); } catch { /* retain unknown shells */ }
    }
    const proc = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: resolved,
      env: integration?.env ?? env,
    });

    const siblings = [...instances.values()].filter((entry) => entry.session.workspaceId === workspaceId);
    const nextNumber = Math.max(0, ...siblings.map((entry) => Number(entry.session.title.slice(9)) || 0)) + 1;
    const instance: PtyInstance = {
      process: proc, onData, onExit, data: "", sequence: 0,
      shellSignals: integration?.signals, activityRevision: 0, lastInputAt: 0,
      onDataDispose: { dispose() {} }, onExitDispose: { dispose() {} },
      session: { id, cwd: resolved, workspaceId, workspaceName: options.workspaceName ?? null,
        title: `Terminal ${nextNumber}`, status: "running", exitCode: null, createdAt: Date.now(), servers: null },
    };
    instances.set(id, instance);
    instance.onDataDispose = proc.onData((data) => {
      if (instances.get(id) !== instance) return;
      instance.activityRevision += 1;
      data = instance.shellSignals?.consume(data) ?? data;
      if (!data) return;
      instance.data = (instance.data + data).slice(-MAX_OUTPUT_CHARS);
      instance.sequence += 1;
      instance.onData(id, data, instance.sequence);
    });
    instance.onExitDispose = proc.onExit(({ exitCode }) => {
      if (instances.get(id) !== instance) return;
      instance.session.status = "exited";
      instance.session.exitCode = exitCode;
      instance.session.servers = [];
      instance.onDataDispose.dispose();
      instance.onExitDispose.dispose();
      instance.onExit?.(id, exitCode);
      clearUnusedServerTimer();
    });
    scheduleServerCheck();
    return snapshot(instance);
  },

  attach(id: string, onData: DataCallback, onExit?: ExitCallback): TerminalSnapshot {
    const instance = requireInstance(id);
    instance.activityRevision += 1;
    instance.onData = onData;
    instance.onExit = onExit;
    return snapshot(instance);
  },

  list(): TerminalSession[] {
    // Interactive provider login terminals have their own temporary lifecycle.
    return [...instances.values()].filter((entry) => entry.session.workspaceId !== null)
      .map((entry) => cloneSession(entry.session));
  },

  watchServers(onChanged: () => void): () => void {
    serversChanged = onChanged;
    scheduleServerCheck();
    return () => {
      if (serversChanged !== onChanged) return;
      serversChanged = null;
      if (serverTimer) { clearTimeout(serverTimer); serverTimer = null; }
    };
  },

  refreshServers(): Promise<void> {
    if (process.platform === "win32") return Promise.resolve();
    if (serverCheck) return serverCheck;
    const targets = [...instances.values()].filter((entry) => entry.session.workspaceId !== null &&
      entry.session.status === "running" && Number.isSafeInteger(entry.process.pid) && entry.process.pid > 0);
    if (targets.length === 0) return Promise.resolve();
    const roots = new Map(targets.map((entry) => [entry.session.id, entry.process.pid]));
    serverCheck = (async () => {
      let result: Awaited<ReturnType<typeof scanTerminalServers>> | null;
      try { result = await scanTerminalServers(roots); } catch { result = null; }
      let changed = false;
      for (const entry of targets) {
        if (instances.get(entry.session.id) !== entry || entry.session.status !== "running") continue;
        const servers = result?.get(entry.session.id) ?? null;
        if (JSON.stringify(entry.session.servers) === JSON.stringify(servers)) continue;
        entry.session.servers = servers;
        changed = true;
      }
      if (changed) serversChanged?.();
    })().finally(() => { serverCheck = null; });
    return serverCheck;
  },

  write(id: string, data: string): void {
    const instance = instances.get(id);
    if (instance?.session.status === "running") {
      instance.activityRevision += 1;
      instance.lastInputAt = Date.now();
      if (/[\r\n]/.test(data)) instance.shellSignals?.commandSent();
      instance.process.write(data);
    }
  },

  resize(id: string, cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 1000 || rows > 1000) return;
    const instance = instances.get(id);
    if (instance?.session.status === "running") {
      instance.process.resize(cols, rows);
    }
  },

  destroy(id: string): void {
    const instance = instances.get(id);
    if (instance) {
      instances.delete(id);
      instance.onDataDispose.dispose();
      instance.onExitDispose.dispose();
      if (instance.session.status === "running") instance.process.kill();
      clearUnusedServerTimer();
    }
  },

  async destroyIdle(workspaceId: string): Promise<string[]> {
    if (typeof workspaceId !== "string" || !workspaceId.trim() || workspaceId.length > 256) {
      throw new Error("Invalid terminal workspace.");
    }
    const candidates = [...instances.values()].filter((entry) => entry.session.workspaceId === workspaceId)
      .map((entry) => ({ entry, revision: entry.activityRevision }));
    const roots = new Map(candidates.filter(({ entry }) => entry.session.status === "running" &&
      entry.shellSignals?.atPrompt === true && Number.isSafeInteger(entry.process.pid) && entry.process.pid > 0)
      .map(({ entry }) => [entry.session.id, entry.process.pid]));
    let idle: Set<string>;
    try { idle = await scanIdleTerminalShells(roots); } catch { idle = new Set(); }
    const stopped: string[] = [];
    for (const { entry, revision } of candidates) {
      if (instances.get(entry.session.id) !== entry || entry.activityRevision !== revision) continue;
      if (entry.session.status !== "exited" && (!idle.has(entry.session.id) ||
        entry.shellSignals?.atPrompt !== true || Date.now() - entry.lastInputAt < 300)) continue;
      this.destroy(entry.session.id);
      stopped.push(entry.session.id);
    }
    return stopped;
  },

  destroyAll(): void {
    for (const id of instances.keys()) {
      this.destroy(id);
    }
    disposeShellIntegration();
  },
};
