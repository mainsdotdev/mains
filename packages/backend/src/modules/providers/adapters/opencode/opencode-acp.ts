import type { ChildProcess } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { spawnProvider as spawn, killProviderProcess } from "../provider-process";
import { createLogger } from "../adapter.shared";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
}
interface ProcessRecord {
  child?: ChildProcess;
  stdin?: Writable | null;
  stdout?: Readable | null;
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
  buffer: string;
  stderr: string;
  startSignal?: AbortSignal;
  startAbort?: () => void;
}
const log = createLogger("[OpenCodeACP]");

/** One child owns its NDJSON reader and pending RPCs. OS spawn admits writes;
 * only close releases native ownership, including after a forced kill. */
export class OpenCodeAcpServer {
  private process?: ProcessRecord;
  private nextId = 1;
  private notificationHandler: ((method: string, params: unknown) => void) | null = null;
  private requestHandler: ((id: number | string, method: string, params: unknown) => void) | null = null;
  private closeHandler: ((error?: Error) => void) | null = null;

  get isRunning(): boolean { return !!this.process && this.isCurrent(this.process); }
  private isCurrent(record: ProcessRecord): boolean {
    return this.process === record && record.phase === "running" && !!record.stdin &&
      (!record.child || record.child.exitCode === null && record.child.signalCode == null);
  }
  setNotificationHandler(handler: ((method: string, params: unknown) => void) | null): void { this.notificationHandler = handler; }
  setRequestHandler(handler: ((id: number | string, method: string, params: unknown) => void) | null): void { this.requestHandler = handler; }
  setOnClose(handler: ((error?: Error) => void) | null): void { this.closeHandler = handler; }

  start(binaryPath: string, env?: Record<string, string>, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.process) return this.process.phase === "stopping"
      ? Promise.reject(new Error("OpenCode ACP stopping")) : this.process.started;
    let child: ChildProcess;
    try { child = spawn(binaryPath, ["acp"], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (error) { return Promise.reject(error); }
    const record = this.create(child.stdout, child.stdin, child);
    child.once("spawn", () => {
      if (this.process !== record || record.phase !== "starting") return;
      this.removeStartAbort(record); record.phase = "running"; record.resolveStarted();
    });
    record.startSignal = signal;
    record.startAbort = () => this.fail(record, signal!.reason instanceof Error ? signal!.reason : new Error(String(signal!.reason)));
    signal?.addEventListener("abort", record.startAbort, { once: true });
    if (signal?.aborted) record.startAbort();
    if (!child.stdout || !child.stdin) this.fail(record, new Error("OpenCode ACP did not expose stdio pipes"));
    return record.started;
  }

  /** Test seam with the same decoder, correlation and retirement rules. */
  attach(stdout: Readable, stdin: Writable): void {
    if (this.process) throw new Error("OpenCode ACP already owns a transport");
    const record = this.create(stdout, stdin);
    record.phase = "running"; record.resolveStarted();
  }
  private create(stdout?: Readable | null, stdin?: Writable | null, child?: ChildProcess): ProcessRecord {
    let resolveStarted!: () => void, rejectStarted!: (error: Error) => void, resolveClosed!: () => void;
    const started = new Promise<void>((yes, no) => { resolveStarted = yes; rejectStarted = no; });
    const closed = new Promise<void>((yes) => { resolveClosed = yes; });
    const record: ProcessRecord = {
      child, stdin, stdout, phase: "starting", started, resolveStarted, rejectStarted, closed, resolveClosed,
      pending: new Map(), decoder: new StringDecoder("utf8"), buffer: "", stderr: "",
    };
    this.process = record;
    stdout?.on("data", (chunk: Buffer | string) => {
      if (!this.isCurrent(record)) return;
      record.buffer += typeof chunk === "string" ? chunk : record.decoder.write(chunk);
      this.drain(record);
      if (record.buffer.length > 32 * 1024 * 1024) record.buffer = "";
    });
    stdout?.once("end", () => this.fail(record, new Error("OpenCode ACP stdout ended")));
    for (const stream of [stdin, stdout, child?.stderr]) stream?.on("error", (error) => this.fail(record, error));
    child?.stderr?.on("data", (chunk: Buffer) => {
      if (this.process === record) record.stderr = (record.stderr + chunk.toString()).slice(-4096);
    });
    child?.once("close", (code, signal) => this.finish(record,
      record.error ?? new Error(`OpenCode ACP exited (code=${code}, signal=${signal ?? "none"})${record.stderr ? `: ${record.stderr.trim()}` : ""}`)));
    child?.on("error", (error) => this.fail(record, error));
    child?.once("exit", (code, signal) => this.fail(record, new Error(`OpenCode ACP exited (code=${code}, signal=${signal ?? "none"})`)));
    return record;
  }
  private removeStartAbort(record: ProcessRecord): void {
    if (record.startAbort) record.startSignal?.removeEventListener("abort", record.startAbort);
  }
  private finish(record: ProcessRecord, error: Error): void {
    record.phase = "closed"; clearTimeout(record.killTimer); this.removeStartAbort(record);
    this.failPending(record, error); record.rejectStarted(error); record.resolveClosed(); record.buffer = "";
    if (this.process !== record) return;
    this.process = undefined; this.closeHandler?.(error);
  }
  private fail(record: ProcessRecord, error: Error): void {
    if (this.process !== record || record.phase === "closed") return;
    record.error ??= error;
    void this.stopRecord(record, error).catch((failure) => log.error("OpenCode ACP cleanup failed:", failure));
  }

  async sendRequest(method: string, params?: unknown, timeoutMs = 60_000, signal?: AbortSignal): Promise<unknown> {
    const record = this.process;
    if (!record || !this.isCurrent(record)) throw new Error("OpenCode ACP is not running");
    if (signal?.aborted) throw signal.reason;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.settle(record, id, new Error(`OpenCode ACP ${method} timed out after ${timeoutMs}ms`)), timeoutMs);
      const abort = () => this.settle(record, id, signal!.reason);
      record.pending.set(id, { resolve, reject, timer, signal, abort });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        this.write({ jsonrpc: "2.0", id, method, params }, record, (error) => {
          if (!error) return;
          this.settle(record, id, error); this.fail(record, error);
        });
      } catch (error) { this.settle(record, id, error instanceof Error ? error : new Error(String(error))); }
    });
  }
  sendNotification(method: string, params?: unknown): void { this.write({ jsonrpc: "2.0", method, params }); }
  respond(id: number | string, result: unknown): void { this.write({ jsonrpc: "2.0", id, result }); }
  respondError(id: number | string, code: number, message: string): void { this.write({ jsonrpc: "2.0", id, error: { code, message } }); }
  stop(): Promise<void> { return this.process ? this.stopRecord(this.process, new Error("OpenCode ACP stopped")) : Promise.resolve(); }
  private stopRecord(record: ProcessRecord, reason: Error): Promise<void> {
    if (record.phase === "closed") return Promise.resolve();
    if (record.stopping) return record.stopping;
    record.phase = "stopping"; this.removeStartAbort(record);
    record.rejectStarted(reason); this.failPending(record, reason);
    if (!record.child) { this.finish(record, reason); return Promise.resolve(); }
    const child = record.child;
    const pending = new Promise<void>((resolve, reject) => {
      void record.closed.then(resolve);
      record.killTimer = setTimeout(() => {
        if (record.phase === "closed") return;
        try { killProviderProcess(child); } catch (error) { reject(error); }
      }, 2000);
      try { record.stdin?.end(); killProviderProcess(child, "SIGTERM"); }
      catch (error) { clearTimeout(record.killTimer); reject(error); }
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
  private write(message: unknown, record = this.process, callback?: (error?: Error | null) => void): void {
    if (!record || !this.isCurrent(record) || !record.stdin) throw new Error("OpenCode ACP is not running");
    record.stdin.write(JSON.stringify(message) + "\n", callback);
  }
  private drain(record: ProcessRecord): void {
    let newline = record.buffer.indexOf("\n");
    while (this.isCurrent(record) && newline !== -1) {
      const line = record.buffer.slice(0, newline).trim(); record.buffer = record.buffer.slice(newline + 1);
      if (line) this.dispatch(record, line);
      newline = record.buffer.indexOf("\n");
    }
  }
  private dispatch(record: ProcessRecord, line: string): void {
    if (!this.isCurrent(record)) return;
    let message: Record<string, unknown>;
    try { message = JSON.parse(line) as Record<string, unknown>; } catch { return; }
    if (!message || typeof message !== "object") return;
    if ("id" in message && !("method" in message)) {
      const id = message.id;
      if (typeof id !== "string" && typeof id !== "number") return;
      const error = message.error as { message?: string } | undefined;
      this.settle(record, id, error ? new Error(error.message || "OpenCode ACP request failed") : undefined, message.result);
      return;
    }
    const method = message.method;
    if (typeof method !== "string") return;
    if ("id" in message && message.id !== undefined) {
      const id = message.id as number | string;
      if (this.requestHandler) this.requestHandler(id, method, message.params);
      else this.respondError(id, -32601, `Unhandled OpenCode request ${method}`);
    } else this.notificationHandler?.(method, message.params);
  }
}
