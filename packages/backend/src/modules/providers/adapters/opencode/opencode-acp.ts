import type { ChildProcess } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { spawnProvider as spawn, killProviderProcess } from "../provider-process";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface JsonRpcResponse {
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string };
}

function isResponse(message: Record<string, unknown>): boolean {
  return "id" in message && !("method" in message);
}

/**
 * One long-lived `opencode acp` process. ACP is newline-delimited JSON-RPC
 * on stdin/stdout. Stderr is logs, never protocol.
 */
export class OpenCodeAcpServer {
  private child: ChildProcess | null = null;
  private stdin: Writable | null = null;
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private buffer = "";
  private notificationHandler: ((method: string, params: unknown) => void) | null = null;
  private requestHandler: ((id: number | string, method: string, params: unknown) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private stderr = "";

  get isRunning(): boolean {
    return this.stdin !== null && (this.child === null || this.child.exitCode === null);
  }

  setNotificationHandler(handler: ((method: string, params: unknown) => void) | null): void {
    this.notificationHandler = handler;
  }

  setRequestHandler(handler: ((id: number | string, method: string, params: unknown) => void) | null): void {
    this.requestHandler = handler;
  }

  setOnClose(handler: (() => void) | null): void {
    this.closeHandler = handler;
  }

  async start(binaryPath: string, env?: Record<string, string>): Promise<void> {
    if (this.isRunning) return;
    const child = spawn(binaryPath, ["acp"], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (!child.stdout || !child.stdin) {
      killProviderProcess(child);
      throw new Error("OpenCode ACP did not expose stdio pipes");
    }
    this.child = child;
    this.attach(child.stdout, child.stdin);
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-4096);
    });
    child.on("close", () => this.failPending("OpenCode ACP process exited"));
    child.on("error", (error) => this.failPending(error.message));
  }

  /** Test seam: feed protocol bytes without spawning a binary. */
  attach(stdout: Readable, stdin: Writable): void {
    this.stdin = stdin;
    stdout.on("data", (chunk: Buffer | string) => {
      this.buffer += chunk.toString();
      this.drain();
    });
  }

  async sendRequest(method: string, params?: unknown, timeoutMs = 60_000): Promise<unknown> {
    const id = this.nextId++;
    this.write({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`OpenCode ACP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  sendNotification(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  respondError(id: number | string, code: number, message: string): void {
    this.write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.stdin = null;
    this.failPending("OpenCode ACP stopped");
    if (!child) return;
    killProviderProcess(child, "SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        killProviderProcess(child);
        resolve();
      }, 2000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private write(message: unknown): void {
    if (!this.stdin) throw new Error("OpenCode ACP is not running");
    this.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private drain(): void {
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.dispatch(line);
      newline = this.buffer.indexOf("\n");
    }
    if (this.buffer.length > 32 * 1024 * 1024) this.buffer = "";
  }

  private dispatch(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (isResponse(message)) {
      const response = message as JsonRpcResponse;
      if (response.id === undefined) return;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(response.id);
      if (response.error) {
        pending.reject(new Error(response.error.message || "OpenCode ACP request failed"));
      } else {
        pending.resolve(response.result);
      }
      return;
    }
    const method = message.method;
    if (typeof method !== "string") return;
    if ("id" in message && message.id !== undefined) {
      const id = message.id as number | string;
      if (this.requestHandler) this.requestHandler(id, method, message.params);
      else this.respondError(id, -32601, `Unhandled OpenCode request ${method}`);
      return;
    }
    this.notificationHandler?.(method, message.params);
  }

  private failPending(message: string): void {
    this.stdin = null;
    this.child = null;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message || this.stderr || "OpenCode ACP closed"));
      this.pending.delete(id);
    }
    this.closeHandler?.();
    this.closeHandler = null;
  }
}
