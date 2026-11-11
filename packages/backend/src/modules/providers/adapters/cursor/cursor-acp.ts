import type { ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { spawnProvider as spawn, killProviderProcess } from "../provider-process";
import { createLogger } from "../adapter.shared";

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc?: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc?: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function isServerRequest(msg: unknown): msg is JsonRpcRequest {
  return typeof msg === "object" && msg !== null && "method" in msg && "id" in msg;
}

function isServerNotification(msg: unknown): msg is JsonRpcNotification {
  return typeof msg === "object" && msg !== null && "method" in msg && !("id" in msg);
}

function isResponse(msg: unknown): msg is JsonRpcResponse {
  return typeof msg === "object" && msg !== null && "id" in msg && !("method" in msg);
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
}
interface ProcessRecord {
  child: ChildProcess;
  phase: "starting" | "running" | "stopping" | "closed";
  started: Promise<void>;
  resolveStarted(): void;
  rejectStarted(error: Error): void;
  closed: Promise<void>;
  resolveClosed(): void;
  stopping?: Promise<void>;
  killTimer?: ReturnType<typeof setTimeout>;
  error?: Error;
  pending: Map<number | string, PendingRequest>;
  decoder: StringDecoder;
  jsonBuffer: string;
  stderr: string;
}
const { info: logInfo, error: logError } = createLogger("[CursorACP]");

/** One child owns its decoder, RPCs and close barrier. Only spawn publishes a
 * running transport; only close releases the child. Retired callbacks cannot
 * settle another child's requests or dispatch its notifications. */
export class CursorAcpServer {
  private process: ProcessRecord | undefined;
  private nextId = 1;
  private notificationHandler?: (method: string, params: unknown) => void;
  private serverRequestHandler?: (id: number | string, method: string, params: unknown) => void;
  private onClose?: (error?: Error) => void;

  start(binaryPath: string, env?: Record<string, string>): Promise<void> {
    if (this.process) return this.process.phase === "stopping"
      ? Promise.reject(new Error("ACP server stopping")) : this.process.started;
    let child: ChildProcess;
    try { child = spawn(binaryPath, ["acp"], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (error) { return Promise.reject(error); }
    let resolveStarted!: () => void, rejectStarted!: (error: Error) => void, resolveClosed!: () => void;
    const started = new Promise<void>((yes, no) => { resolveStarted = yes; rejectStarted = no; });
    const closed = new Promise<void>((yes) => { resolveClosed = yes; });
    const record: ProcessRecord = {
      child, phase: "starting", started, resolveStarted, rejectStarted, closed, resolveClosed,
      pending: new Map(), decoder: new StringDecoder("utf8"), jsonBuffer: "", stderr: "",
    };
    this.process = record;
    child.once("spawn", () => {
      if (this.process !== record || record.phase !== "starting") return;
      record.phase = "running"; record.resolveStarted();
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (!this.isCurrent(record)) return;
      record.jsonBuffer += record.decoder.write(chunk);
      this.drainJsonBuffer(record);
      if (record.jsonBuffer.length > 32 * 1024 * 1024) {
        logError("ACP JSON buffer exceeded 32MB; resetting"); record.jsonBuffer = "";
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (this.process === record) record.stderr = (record.stderr + chunk.toString()).slice(-2048);
    });
    child.once("close", (code, signal) => {
      const error = record.error ?? new Error(`ACP server exited (code=${code}, signal=${signal ?? "none"})`);
      record.phase = "closed"; clearTimeout(record.killTimer);
      this.failPending(record, error); record.rejectStarted(error); record.resolveClosed();
      record.jsonBuffer = "";
      if (this.process !== record) return;
      this.process = undefined;
      logInfo(`ACP process closed code=${code} signal=${signal ?? "none"}${record.stderr ? ` stderr: ${record.stderr.trim()}` : ""}`);
      this.onClose?.(error);
    });
    const fail = (error: Error) => {
      if (this.process !== record || record.phase === "closed") return;
      record.error ??= error;
      void this.stopRecord(record, error).catch((cleanupError) => logError("ACP cleanup failed:", cleanupError));
    };
    child.on("error", fail);
    child.once("exit", (code, signal) => fail(new Error(`ACP server exited (code=${code}, signal=${signal ?? "none"})`)));
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.on("error", fail);
    if (!child.stdin || !child.stdout) fail(new Error("Failed to get stdio pipes from cursor acp"));
    return started;
  }

  get isRunning(): boolean { return !!this.process && this.isCurrent(this.process); }
  private isCurrent(record: ProcessRecord): boolean {
    return this.process === record && record.phase === "running" && record.child.exitCode === null && record.child.signalCode == null;
  }
  setNotificationHandler(handler: (method: string, params: unknown) => void): void { this.notificationHandler = handler; }
  setServerRequestHandler(handler: (id: number | string, method: string, params: unknown) => void): void { this.serverRequestHandler = handler; }
  setOnClose(handler: (error?: Error) => void): void { this.onClose = handler; }

  async sendRequest(method: string, params?: unknown, timeoutMs = 30000, signal?: AbortSignal): Promise<unknown> {
    const record = this.process;
    if (!record || !this.isCurrent(record)) throw new Error("ACP server not running");
    if (signal?.aborted) throw signal.reason;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.settle(record, id, new Error(`RPC timeout: ${method} (${timeoutMs}ms)`)), timeoutMs);
      const abort = () => this.settle(record, id, signal!.reason);
      record.pending.set(id, { resolve, reject, timer, signal, abort });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        this.write({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) }, record, (error) => {
          if (!error) return;
          this.settle(record, id, error);
          if (this.process === record && record.phase !== "closed") {
            record.error ??= error;
            void this.stopRecord(record, error).catch((failure) => logError("ACP write cleanup failed:", failure));
          }
        });
      } catch (error) { this.settle(record, id, error instanceof Error ? error : new Error(String(error))); }
    });
  }
  respondToRequest(id: number | string, result: unknown): void { this.write({ jsonrpc: "2.0", id, result }); }
  respondToRequestError(id: number | string, code: number, message: string): void { this.write({ jsonrpc: "2.0", id, error: { code, message } }); }
  sendNotification(method: string, params?: unknown): void { this.write({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) }); }
  stop(): Promise<void> { return this.process ? this.stopRecord(this.process, new Error("ACP server stopping")) : Promise.resolve(); }

  private stopRecord(record: ProcessRecord, reason: Error): Promise<void> {
    if (record.phase === "closed") return Promise.resolve();
    if (record.stopping) return record.stopping;
    record.phase = "stopping";
    record.rejectStarted(reason); this.failPending(record, reason);
    const pending = new Promise<void>((resolve, reject) => {
      void record.closed.then(resolve);
      record.killTimer = setTimeout(() => {
        if (record.phase === "closed") return;
        try { killProviderProcess(record.child); }
        catch (error) { reject(error); }
      }, 500);
      try {
        record.child.stdin?.end();
        killProviderProcess(record.child, "SIGTERM");
      } catch (error) { clearTimeout(record.killTimer); reject(error); }
    });
    record.stopping = pending;
    void pending.catch(() => { if (record.stopping === pending) record.stopping = undefined; });
    return pending;
  }
  private settle(record: ProcessRecord, id: number | string, error?: unknown, result?: unknown): void {
    const pending = record.pending.get(id);
    if (!pending) return;
    record.pending.delete(id); clearTimeout(pending.timer);
    if (pending.abort) pending.signal?.removeEventListener("abort", pending.abort);
    if (error !== undefined) pending.reject(error); else pending.resolve(result);
  }
  private failPending(record: ProcessRecord, error: Error): void {
    for (const id of record.pending.keys()) this.settle(record, id, error);
  }
  private write(message: unknown, record = this.process, onError?: (error?: Error | null) => void): void {
    if (!record || !this.isCurrent(record) || !record.child.stdin) throw new Error("ACP server not running");
    record.child.stdin.write(JSON.stringify(message) + "\n", onError);
  }

  private handleLine(record: ProcessRecord, line: string): void {
    if (!this.isCurrent(record)) return;
    if (!line.trim()) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    if (isResponse(parsed)) {
      this.settle(record, parsed.id, parsed.error ? new Error(`${parsed.error.message} (code: ${parsed.error.code})`) : undefined, parsed.result);
    } else if (isServerRequest(parsed)) {
      this.serverRequestHandler?.(parsed.id, parsed.method, parsed.params);
    } else if (isServerNotification(parsed)) {
      this.notificationHandler?.(parsed.method, parsed.params);
    }
  }

  private drainJsonBuffer(record: ProcessRecord): void {
    while (this.isCurrent(record) && record.jsonBuffer.length > 0) {
      const trimStart = record.jsonBuffer.search(/\S/);
      if (trimStart === -1) {
        record.jsonBuffer = "";
        return;
      }
      if (trimStart > 0) {
        record.jsonBuffer = record.jsonBuffer.slice(trimStart);
      }

      if (record.jsonBuffer[0] !== "{") {
        const nextBrace = record.jsonBuffer.indexOf("{", 1);
        if (nextBrace === -1) {
          record.jsonBuffer = "";
          return;
        }
        record.jsonBuffer = record.jsonBuffer.slice(nextBrace);
        continue;
      }

      let depth = 0;
      let inString = false;
      let escaped = false;
      let endIdx = -1;

      for (let i = 0; i < record.jsonBuffer.length; i++) {
        const ch = record.jsonBuffer[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          if (inString) escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }

      if (endIdx === -1) {
        return;
      }

      const jsonStr = record.jsonBuffer.slice(0, endIdx + 1);
      record.jsonBuffer = record.jsonBuffer.slice(endIdx + 1);

      this.handleLine(record, jsonStr);
    }
  }

}
