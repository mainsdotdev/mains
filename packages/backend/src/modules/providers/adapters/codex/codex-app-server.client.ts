import type { ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { spawnProvider as spawn, killProviderProcess } from "../provider-process";
import {
  createLogger,
  type AdapterLogger,
} from "../adapter.shared";
import type {
  CodexAppServerMethod,
  CodexAppServerParams,
  CodexAppServerResult,
} from "./codex-app-server-protocol/rpc";

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

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * absent → starting → running → stopping → closed (ownership released).
 * Stop/IO failure can also retire starting; only spawn publishes running and
 * only close releases the child. RPC state and framing belong to that owner.
 */
interface ProcessSession {
  child: ChildProcess;
  phase: "starting" | "running" | "stopping" | "closed";
  started: Promise<void>;
  resolveStarted: () => void;
  rejectStarted: (error: Error) => void;
  closed: Promise<void>;
  resolveClosed: () => void;
  startError?: Error;
  killTimer?: ReturnType<typeof setTimeout>;
  pending: Map<number | string, PendingRequest>;
  jsonBuffer: string;
  decoder: StringDecoder;
}

function isServerRequest(message: unknown): message is JsonRpcRequest {
  return (
    typeof message === "object" &&
    message !== null &&
    "method" in message &&
    "id" in message
  );
}

function isServerNotification(
  message: unknown,
): message is JsonRpcNotification {
  return (
    typeof message === "object" &&
    message !== null &&
    "method" in message &&
    !("id" in message)
  );
}

function isResponse(message: unknown): message is JsonRpcResponse {
  return (
    typeof message === "object" &&
    message !== null &&
    "id" in message &&
    !("method" in message)
  );
}

/**
 * Owns one `codex app-server` child process and its JSON-RPC transport.
 *
 * The interface deliberately keeps protocol semantics out of the client:
 * callers own initialization and method-specific behavior, while this module
 * owns process lifetime, request correlation, buffering, routing, and cleanup.
 */
export class CodexAppServer {
  private process: ProcessSession | null = null;
  private nextId = 1;
  private notificationHandler:
    | ((method: string, params: unknown) => void)
    | null = null;
  private backgroundHandler:
    | ((method: string, params: unknown) => void)
    | null = null;
  private serverRequestHandler:
    | ((
        id: number | string,
        method: string,
        params: unknown,
      ) => void)
    | null = null;
  private onClose: (() => void) | null = null;

  constructor(
    private readonly logger: AdapterLogger = createLogger("[CodexAppServer]"),
  ) {}

  start(
    binaryPath: string,
    cwd: string,
    env?: Record<string, string>,
  ): Promise<void> {
    if (this.process) {
      return this.process.phase === "stopping"
        ? Promise.reject(new Error("App-server stopping"))
        : this.process.started;
    }

    let child: ChildProcess;
    try {
      child = spawn(binaryPath, ["app-server"], {
        cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      return Promise.reject(error);
    }
    let resolveStarted!: () => void;
    let rejectStarted!: (error: Error) => void;
    let resolveClosed!: () => void;
    const started = new Promise<void>((resolve, reject) => {
      resolveStarted = resolve; rejectStarted = reject;
    });
    const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
    const session: ProcessSession = {
      child, phase: "starting", started, resolveStarted, rejectStarted,
      closed, resolveClosed,
      pending: new Map(), jsonBuffer: "", decoder: new StringDecoder("utf8"),
    };
    this.process = session;
    child.once("spawn", () => {
      if (session.phase !== "starting") return;
      session.phase = "running";
      session.resolveStarted();
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (!this.isCurrent(session)) return;
      session.jsonBuffer += session.decoder.write(chunk);
      this.drainJsonBuffer(session);
      if (session.jsonBuffer.length > 32 * 1024 * 1024) {
        this.logger.error(`jsonBuffer exceeded 32MB (${session.jsonBuffer.length} bytes), resetting`);
        session.jsonBuffer = "";
      }
    });
    child.stderr?.resume();
    child.once("close", (code) => {
      const error = session.startError ?? new Error(`Codex app-server exited with code ${code}`);
      session.phase = "closed";
      clearTimeout(session.killTimer);
      this.rejectPending(session, error);
      session.rejectStarted(error);
      session.jsonBuffer = "";
      session.resolveClosed();
      if (this.process !== session) return;
      this.process = null;
      this.logger.info(`App-server process exited with code ${code}`);
      this.onClose?.();
    });
    child.on("error", (error) => {
      if (this.process !== session || session.phase === "closed") return;
      this.logger.error("App-server process error:", error.message);
      void this.stopSession(session, new Error(`Codex app-server process error: ${error.message}`));
    });
    child.once("exit", (code) => {
      // No new RPCs after exit, even if inherited stdio delays the close event.
      if (session.phase !== "closed") {
        void this.stopSession(session, new Error(`Codex app-server exited with code ${code}`));
      }
    });
    for (const [name, stream] of [["stdin", child.stdin], ["stdout", child.stdout], ["stderr", child.stderr]] as const) {
      stream?.on("error", (error: Error) => {
        if (this.process === session && session.phase !== "closed") {
          void this.stopSession(session, new Error(`Codex app-server ${name} error: ${error.message}`));
        }
      });
    }
    if (!child.stdout || !child.stdin) {
      void this.stopSession(session, new Error("Failed to get stdio pipes from codex app-server"));
    }
    return session.started;
  }

  setNotificationHandler(
    handler: (method: string, params: unknown) => void,
  ): void {
    this.notificationHandler = handler;
  }

  /** Persistent handler that runs for all notifications. */
  setBackgroundHandler(
    handler: (method: string, params: unknown) => void,
  ): void {
    this.backgroundHandler = handler;
  }

  setServerRequestHandler(
    handler: (
      id: number | string,
      method: string,
      params: unknown,
    ) => void,
  ): void {
    this.serverRequestHandler = handler;
  }

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  async sendRequest<Method extends CodexAppServerMethod>(
    method: Method,
    params: CodexAppServerParams<Method>,
    timeoutMs = 30000,
  ): Promise<CodexAppServerResult<Method>> {
    const session = this.process;
    if (!session || !this.isCurrent(session)) {
      throw new Error("App-server not running");
    }

    const requestId = this.nextId++;
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: requestId,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    return new Promise<CodexAppServerResult<Method>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settleRequest(session, requestId, new Error(`RPC timeout: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);

      session.pending.set(requestId, {
        resolve: (value) =>
          resolve(value as CodexAppServerResult<Method>),
        reject,
        timer,
      });
      try {
        this.writeMessage(message, session);
      } catch (error) {
        this.settleRequest(session, requestId, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  respondToRequest(id: number | string, result: unknown): void {
    this.writeMessage({ jsonrpc: "2.0", id, result });
  }

  respondToRequestError(
    id: number | string,
    code: number,
    message: string,
  ): void {
    this.writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
  }

  sendNotification(method: string, params?: unknown): void {
    this.writeMessage({
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    });
  }

  get isRunning(): boolean {
    return this.process !== null && this.isCurrent(this.process);
  }

  stop(): Promise<void> {
    return this.process
      ? this.stopSession(this.process, new Error("App-server stopping"))
      : Promise.resolve();
  }

  /** Only this transition retires a live transport. Ownership lasts until close. */
  private stopSession(session: ProcessSession, error: Error): Promise<void> {
    if (session.phase === "closed" || session.phase === "stopping") return session.closed;
    session.phase = "stopping";
    session.startError = error;
    this.rejectPending(session, error);
    session.jsonBuffer = "";
    session.killTimer = setTimeout(() => killProviderProcess(session.child), 3000);
    try { session.child.stdin?.end(); }
    catch { killProviderProcess(session.child); }
    return session.closed;
  }

  private isCurrent(session: ProcessSession): boolean {
    return this.process === session && session.phase === "running" &&
      session.child.exitCode === null && session.child.signalCode === null;
  }

  /** Remove before settling: response, timeout, stop and IO failure compete once. */
  private settleRequest(session: ProcessSession, id: number | string, error?: Error, result?: unknown): void {
    const pending = session.pending.get(id);
    if (!pending) return;
    session.pending.delete(id);
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve(result);
  }

  private rejectPending(session: ProcessSession, error: Error): void {
    for (const id of session.pending.keys()) this.settleRequest(session, id, error);
  }

  private writeMessage(message: unknown, session = this.process): void {
    if (!session || !this.isCurrent(session)) return;
    const payload = `${JSON.stringify(message)}\n`;
    try {
      session.child.stdin!.write(payload, (error) => {
        if (error && this.isCurrent(session)) {
          void this.stopSession(session, new Error(`Codex app-server write failed: ${error.message}`));
        }
      });
    } catch (error) {
      void this.stopSession(session, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleMessage(session: ProcessSession, rawMessage: string): void {
    if (!rawMessage.trim()) return;

    let message: unknown;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      return;
    }

    if (isResponse(message)) {
      this.settleRequest(session, message.id,
        message.error ? new Error(`${message.error.message} (code: ${message.error.code})`) : undefined,
        message.result);
      return;
    }

    if (isServerRequest(message)) {
      this.serverRequestHandler?.(
        message.id,
        message.method,
        message.params,
      );
      return;
    }

    if (isServerNotification(message)) {
      this.notificationHandler?.(message.method, message.params);
      this.backgroundHandler?.(message.method, message.params);
    }
  }

  /**
   * Extract complete JSON objects from stdout without relying on line
   * boundaries. Some app-server payloads can span multiple chunks or lines.
   */
  private drainJsonBuffer(session: ProcessSession): void {
    while (this.isCurrent(session) && session.jsonBuffer.length > 0) {
      const trimStart = session.jsonBuffer.search(/\S/);
      if (trimStart === -1) {
        session.jsonBuffer = "";
        return;
      }
      if (trimStart > 0) {
        session.jsonBuffer = session.jsonBuffer.slice(trimStart);
      }

      if (session.jsonBuffer[0] !== "{") {
        const nextBrace = session.jsonBuffer.indexOf("{", 1);
        if (nextBrace === -1) {
          session.jsonBuffer = "";
          return;
        }
        session.jsonBuffer = session.jsonBuffer.slice(nextBrace);
        continue;
      }

      let depth = 0;
      let inString = false;
      let escaped = false;
      let endIndex = -1;

      for (let index = 0; index < session.jsonBuffer.length; index += 1) {
        const character = session.jsonBuffer[index];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (character === "\\") {
          if (inString) escaped = true;
          continue;
        }
        if (character === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (character === "{") depth += 1;
        else if (character === "}") {
          depth -= 1;
          if (depth === 0) {
            endIndex = index;
            break;
          }
        }
      }

      if (endIndex === -1) return;

      const rawMessage = session.jsonBuffer.slice(0, endIndex + 1);
      session.jsonBuffer = session.jsonBuffer.slice(endIndex + 1);
      this.handleMessage(session, rawMessage);
    }
  }

}
