import { spawn, type ChildProcess } from "child_process";
import { createServer } from "net";
import { request as httpRequest, type ClientRequest } from "http";
import { randomUUID } from "node:crypto";
import { generateToken } from "@mains/backend/ipc-kit/ws-auth";
import { buildSshArgs, wrapRemoteLaunch } from "./ssh.utils";
import type { OpenTunnelInput, TunnelHandle } from "./ssh.service";

const retired = () => new Error("This SSH connection was canceled or closed.");
const abortError = (signal: AbortSignal): Error => signal.reason instanceof Error ? signal.reason : retired();

function freePort(signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    let settled = false;
    const finish = (error?: Error, port?: number) => {
      if (settled) return;
      settled = true;
      const closed = (closeError?: Error) => {
        if (error || signal.aborted) reject(error ?? abortError(signal));
        else if (closeError) reject(closeError);
        else resolve(port!);
      };
      try { server.close(closed); } catch (closeError) { closed(closeError as Error); }
    };
    server.on("error", (error) => finish(error));
    if (signal.aborted) { finish(abortError(signal)); return; }
    server.listen(0, "127.0.0.1", () => {
      if (settled) { try { server.close(() => {}); } catch { /* Already closed. */ } return; }
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      finish(signal.aborted ? abortError(signal) : port ? undefined : new Error("No free port"), port);
    });
  });
}

function spawned(child: ChildProcess, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      child.off("spawn", ready); child.off("error", failed); child.off("exit", exited);
      signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const ready = () => finish();
    const failed = (error: Error) => finish(error);
    const exited = () => finish(new Error("SSH exited before becoming ready."));
    const abort = () => finish(abortError(signal));
    child.once("spawn", ready); child.once("error", failed); child.once("exit", exited);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** One total deadline and one retry per HTTP attempt. Cancellation, child exit
 * and readiness all dispose the same probe; a late response cannot reopen it. */
function probe(port: number, child: ChildProcess, signal: AbortSignal, timeoutMs: number, detail: () => string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false, retry: ReturnType<typeof setTimeout> | undefined;
    let request: ClientRequest | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(deadline); clearTimeout(retry);
      signal.removeEventListener("abort", abort); child.off("exit", exited);
      request?.destroy();
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(abortError(signal));
    const exited = () => finish(new Error(`ssh exited: ${detail() || "unknown error"}`));
    const deadline = setTimeout(() => finish(new Error(`backend not ready after ${timeoutMs / 1000}s${detail() ? `: ${detail()}` : ""}`)), timeoutMs);
    signal.addEventListener("abort", abort, { once: true }); child.once("exit", exited);
    const attempt = () => {
      if (settled) return;
      let failed = false;
      const again = () => {
        if (failed || settled) return;
        failed = true; request?.destroy();
        retry = setTimeout(attempt, 500);
      };
      try {
        request = httpRequest({ host: "127.0.0.1", port, path: "/", method: "GET", timeout: 3000 }, (response) => {
          // Destroying a completed probe can abort a still-draining body.
          response.on?.("error", () => {});
          response.resume();
          if (!failed) finish(signal.aborted ? abortError(signal) : undefined);
        });
        request.on("error", again); request.on("timeout", again); request.end();
      } catch { again(); }
    };
    if (signal.aborted) abort(); else attempt();
  });
}

interface Tunnel {
  id: string;
  requestId: string;
  signature: string;
  phase: "preparing" | "probing" | "ready" | "closing" | "closed";
  controller: AbortController;
  child?: ChildProcess;
  childClosed: boolean;
  childExited: boolean;
  workDone: boolean;
  opening?: Promise<TunnelHandle>;
  drained: Promise<void>;
  release(): void;
  force?: ReturnType<typeof setTimeout>;
}

/** Admission starts before port allocation; ownership ends only after the
 * opening job has settled AND the OS child has actually closed. */
export function createSshTunnelLifecycle() {
  const entries = new Map<string, Tunnel>();
  const requests = new Map<string, Tunnel>();
  const canceled = new Set<string>();
  let phase: "open" | "closing" | "closed" = "open";
  let shuttingDown: Promise<void> | undefined;
  const release = (entry: Tunnel) => {
    if (!entry.workDone || entry.child && !entry.childClosed) return;
    entry.phase = "closed"; clearTimeout(entry.force);
    entries.delete(entry.id); requests.delete(entry.requestId); canceled.add(entry.requestId); entry.release();
  };
  const stop = (entry: Tunnel, reason = retired()) => {
    if (entry.phase === "closed") return;
    entry.phase = "closing"; entry.controller.abort(reason);
    if (entry.child && !entry.childClosed && !entry.childExited && !entry.force) {
      try { entry.child.kill(); } catch (error) { console.warn("[SSH] Could not terminate tunnel:", error); }
      entry.force = setTimeout(() => {
        if (!entry.childClosed && !entry.childExited) { try { entry.child?.kill("SIGKILL"); } catch (error) { console.warn("[SSH] Could not force tunnel closure:", error); } }
      }, 1500);
      entry.force.unref?.();
    }
    release(entry);
  };
  async function open(entry: Tunnel, input: OpenTunnelInput): Promise<TunnelHandle> {
    const current = () => {
      if (phase !== "open" || entry.controller.signal.aborted || entries.get(entry.id) !== entry || entry.childClosed) throw abortError(entry.controller.signal);
    };
    let stderr = "";
    let token: string | undefined;
    try {
      current();
      const localPort = await freePort(entry.controller.signal);
      current();
      const command = input.remoteCommand?.trim();
      if (command) token = generateToken();
      const child = spawn("ssh", buildSshArgs({ ...input, localPort, remoteCommand: command ? wrapRemoteLaunch(command, token!) : undefined }), { stdio: ["ignore", "pipe", "pipe"] });
      entry.child = child;
      const collect = (data: unknown) => { stderr = (stderr + String(data)).slice(-4096); };
      child.stderr?.on("data", collect);
      child.on("error", (error) => stop(entry, error));
      child.once("exit", () => {
        entry.childExited = true;
        const detail = token ? stderr.trim().split(token).join("[redacted]") : stderr.trim();
        stop(entry, new Error(`ssh exited: ${detail || "unknown error"}`));
      });
      child.once("close", () => {
        entry.childClosed = true; clearTimeout(entry.force); child.stderr?.off("data", collect);
        entry.controller.abort(new Error("SSH process closed.")); release(entry);
      });
      await spawned(child, entry.controller.signal); current();
      entry.phase = "probing";
      await probe(localPort, child, entry.controller.signal, command ? 45_000 : 15_000,
        () => token ? stderr.trim().split(token).join("[redacted]") : stderr.trim());
      current(); entry.phase = "ready";
      return { id: entry.id, localPort, localUrl: `ws://127.0.0.1:${localPort}`, ...(token ? { token } : {}) };
    } catch (error) {
      stop(entry); throw error;
    } finally { entry.workDone = true; release(entry); }
  }
  return {
    start() {
      if (phase === "open") return;
      if (phase !== "closed") throw new Error("SSH tunnel cleanup is still pending.");
      phase = "open"; shuttingDown = undefined; canceled.clear();
    },
    open(input: OpenTunnelInput): Promise<TunnelHandle> {
      if (!input || typeof input.host !== "string" || !input.host.trim()) return Promise.reject(new Error("SSH host is required"));
      if (!Number.isInteger(input.remotePort) || input.remotePort <= 0 || input.remotePort > 65535) return Promise.reject(new Error("A valid remote port is required"));
      if (input.requestId !== undefined && (typeof input.requestId !== "string" || !input.requestId || input.requestId.length > 256)) return Promise.reject(new Error("Invalid SSH request id"));
      if (input.remoteCommand !== undefined && input.remoteCommand !== null && typeof input.remoteCommand !== "string") return Promise.reject(new Error("Invalid remote command"));
      if (phase !== "open") return Promise.reject(new Error("SSH tunnels are shutting down."));
      const requestId = input.requestId ?? randomUUID();
      if (canceled.has(requestId)) return Promise.reject(retired());
      const signature = JSON.stringify([input.host, input.remotePort, input.remoteCommand?.trim()]);
      const existing = requests.get(requestId);
      if (existing) {
        if (existing.phase === "closing") return Promise.reject(retired());
        return existing.signature === signature ? existing.opening! : Promise.reject(new Error("This SSH request belongs to another connection."));
      }
      let done!: () => void;
      const entry: Tunnel = { id: `tunnel-${randomUUID()}`, requestId, signature, phase: "preparing", controller: new AbortController(), childClosed: false, childExited: false,
        workDone: false, drained: new Promise<void>((resolve) => { done = resolve; }), release: () => done() };
      entries.set(entry.id, entry); requests.set(requestId, entry);
      entry.opening = open(entry, { ...input });
      return entry.opening;
    },
    close(id: string): Promise<void> {
      const entry = entries.get(id);
      if (!entry) return Promise.resolve();
      stop(entry); return entry.drained;
    },
    cancel(requestId: string): Promise<void> {
      if (typeof requestId !== "string" || !requestId || requestId.length > 256) return Promise.reject(new Error("Invalid SSH request id"));
      canceled.add(requestId);
      const entry = requests.get(requestId);
      if (!entry) return Promise.resolve();
      stop(entry); return entry.drained;
    },
    shutdown(): Promise<void> {
      if (shuttingDown) return shuttingDown;
      phase = "closing";
      const closing = [...entries.values()];
      for (const entry of closing) stop(entry);
      shuttingDown = Promise.allSettled(closing.map((entry) => entry.drained)).then(() => { phase = "closed"; });
      return shuttingDown;
    },
  };
}
