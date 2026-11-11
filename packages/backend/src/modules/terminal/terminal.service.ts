import * as pty from "node-pty";
import { randomUUID } from "node:crypto";
import { assertOwnedRecord } from "../bridge";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import type { TerminalCreateOptions, TerminalSession, TerminalSnapshot, TerminalWriteOptions } from "@mains/contracts/terminal";
import { scanIdleTerminalShells, scanTerminalServers } from "./terminal-servers";
import { disposeShellIntegration, workspaceShellEnvironment } from "./terminal-shell";
import { createTerminalLifecycle, createTerminalMonitor } from "./terminal-lifecycle";

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
  lifecycle: ReturnType<typeof createTerminalLifecycle>;
  lastInputAt: number;
}

const instances = new Map<string, PtyInstance>();
const MAX_OUTPUT_CHARS = 128 * 1024;
const MAX_TERMINALS = 64;

function cloneSession(session: TerminalSession): TerminalSession {
  return { ...session, servers: session.servers?.map((server) => ({ ...server })) ?? null };
}

function hasManagedShells(): boolean {
  return [...instances.values()].some((entry) => entry.session.workspaceId !== null &&
    entry.lifecycle.running && Number.isSafeInteger(entry.process.pid) && entry.process.pid > 0);
}

const monitor = createTerminalMonitor({
  enabled: () => process.platform !== "win32",
  hasTargets: hasManagedShells,
  async read() {
    const targets = [...instances.values()].filter((entry) => entry.session.workspaceId !== null &&
      entry.lifecycle.running && Number.isSafeInteger(entry.process.pid) && entry.process.pid > 0);
    const roots = new Map(targets.map((entry) => [entry.session.id, entry.process.pid]));
    let result: Awaited<ReturnType<typeof scanTerminalServers>> | null;
    try { result = await scanTerminalServers(roots); } catch { result = null; }
    return { targets, result };
  },
  apply({ targets, result }) {
    let changed = false;
    for (const entry of targets) {
      if (instances.get(entry.session.id) !== entry || !entry.lifecycle.running) continue;
      const servers = result?.get(entry.session.id) ?? null;
      if (JSON.stringify(entry.session.servers) === JSON.stringify(servers)) continue;
      entry.session.servers = servers; changed = true;
    }
    return changed;
  },
});

function snapshot(instance: PtyInstance): TerminalSnapshot {
  return { session: cloneSession(instance.session), data: instance.data, sequence: instance.sequence };
}

function disposeListeners(instance: PtyInstance): void {
  for (const disposable of [instance.onDataDispose, instance.onExitDispose]) {
    try { disposable.dispose(); } catch (error) { console.error("Could not release terminal listener:", error); }
  }
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
      shellSignals: integration?.signals, lifecycle: createTerminalLifecycle(), lastInputAt: 0,
      onDataDispose: { dispose() {} }, onExitDispose: { dispose() {} },
      session: { id, instanceId: randomUUID(), cwd: resolved, workspaceId, workspaceName: options.workspaceName ?? null,
        title: `Terminal ${nextNumber}`, status: "running", exitCode: null, createdAt: Date.now(), servers: null },
    };
    instances.set(id, instance);
    try {
      instance.onDataDispose = proc.onData((data) => {
        if (instances.get(id) !== instance || !instance.lifecycle.running) return;
        instance.lifecycle.touch();
        data = instance.shellSignals?.consume(data) ?? data;
        if (!data) return;
        instance.data = (instance.data + data).slice(-MAX_OUTPUT_CHARS);
        instance.sequence += 1;
        instance.onData(id, data, instance.sequence);
      });
      instance.onExitDispose = proc.onExit(({ exitCode }) => {
        if (instances.get(id) !== instance || !instance.lifecycle.exit()) return;
        instance.session.status = "exited";
        instance.session.exitCode = exitCode;
        instance.session.servers = [];
        disposeListeners(instance);
        instance.onExit?.(id, exitCode);
        monitor.targetsChanged();
      });
    } catch (error) {
      instance.lifecycle.fail();
      try { this.destroy(id); }
      catch (cleanup) { throw Object.assign(new Error("Terminal initialization and cleanup failed"), { errors: [error, cleanup] }); }
      throw error;
    }
    monitor.targetsChanged();
    return snapshot(instance);
  },

  attach(id: string, onData: DataCallback, onExit?: ExitCallback): TerminalSnapshot {
    const instance = requireInstance(id);
    if (!instance.lifecycle.attachable) throw new Error("Terminal initialization failed. Stop this terminal before opening another.");
    instance.lifecycle.touch();
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
    return monitor.watch(onChanged);
  },

  refreshServers(): Promise<void> {
    return monitor.refresh();
  },

  write(id: string, data: string, options?: TerminalWriteOptions): void {
    const instance = instances.get(id);
    if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options) ||
      [options.instanceId, options.commandId].some((key) => key !== undefined && (typeof key !== "string" || !key.trim() || key.length > 256)))) {
      throw new Error("Invalid terminal input identity");
    }
    if (typeof data !== "string") throw new Error("Invalid terminal input");
    if (options?.instanceId && instance?.session.instanceId !== options.instanceId) throw new Error("Terminal process changed or no longer exists");
    if (!instance && options?.commandId) throw new Error("Terminal no longer accepts commands");
    instance?.lifecycle.input(data, () => {
      instance.lastInputAt = Date.now();
      if (/[\r\n]/.test(data)) instance.shellSignals?.commandSent();
      instance.process.write(data);
    }, options?.commandId);
  },

  resize(id: string, cols: number, rows: number, instanceId?: string): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 1000 || rows > 1000) return;
    const instance = instances.get(id);
    if (instanceId && instance?.session.instanceId !== instanceId) return;
    if (instance?.lifecycle.running) {
      instance.process.resize(cols, rows);
    }
  },

  destroy(id: string, instanceId?: string): void {
    const instance = instances.get(id);
    if (instanceId && instance?.session.instanceId !== instanceId) return;
    if (instance) {
      if (!instance.lifecycle.destroy(() => instance.process.kill())) return;
      instances.delete(id);
      disposeListeners(instance);
      monitor.targetsChanged();
    }
  },

  async destroyIdle(workspaceId: string): Promise<string[]> {
    if (typeof workspaceId !== "string" || !workspaceId.trim() || workspaceId.length > 256) {
      throw new Error("Invalid terminal workspace.");
    }
    const candidates = [...instances.values()].filter((entry) => entry.session.workspaceId === workspaceId)
      .map((entry) => ({ entry, revision: entry.lifecycle.revision }));
    const roots = new Map(candidates.filter(({ entry }) => entry.lifecycle.running &&
      entry.shellSignals?.atPrompt === true && Number.isSafeInteger(entry.process.pid) && entry.process.pid > 0)
      .map(({ entry }) => [entry.session.id, entry.process.pid]));
    let idle: Set<string>;
    try { idle = await scanIdleTerminalShells(roots); } catch { idle = new Set(); }
    const stopped: string[] = [];
    for (const { entry, revision } of candidates) {
      if (instances.get(entry.session.id) !== entry || entry.lifecycle.revision !== revision) continue;
      if (entry.session.status !== "exited" && (!idle.has(entry.session.id) ||
        entry.shellSignals?.atPrompt !== true || Date.now() - entry.lastInputAt < 300)) continue;
      this.destroy(entry.session.id);
      stopped.push(entry.session.id);
    }
    return stopped;
  },

  destroyAll(): void {
    monitor.stop();
    const errors: unknown[] = [];
    for (const id of instances.keys()) {
      try { this.destroy(id); } catch (error) { errors.push(error); }
    }
    if (instances.size === 0) {
      try { disposeShellIntegration(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw Object.assign(new Error("Could not stop all terminals"), { errors });
  },
};
