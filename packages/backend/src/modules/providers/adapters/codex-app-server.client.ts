import { spawn, type ChildProcess } from "node:child_process";
import {
  createLogger,
  type AdapterLogger,
} from "./adapter.shared";
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
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pendingRequests = new Map<number | string, PendingRequest>();
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
  private stderrBuffer = "";
  private jsonBuffer = "";

  constructor(
    private readonly logger: AdapterLogger = createLogger("[CodexAppServer]"),
  ) {}

  async start(
    binaryPath: string,
    cwd: string,
    env?: Record<string, string>,
  ): Promise<void> {
    if (this.child) return;

    const spawnEnv: Record<string, string | undefined> = {
      ...process.env,
      ...env,
    };

    this.child = spawn(binaryPath, ["app-server"], {
      cwd,
      env: spawnEnv,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    if (!this.child.stdout || !this.child.stdin) {
      throw new Error("Failed to get stdio pipes from codex app-server");
    }

    this.child.stdout.on("data", (chunk: Buffer) => {
      this.jsonBuffer += chunk.toString();
      this.drainJsonBuffer();
      if (this.jsonBuffer.length > 32 * 1024 * 1024) {
        this.logger.error(
          `jsonBuffer exceeded 32MB (${this.jsonBuffer.length} bytes), resetting`,
        );
        this.jsonBuffer = "";
      }
    });

    this.child.stderr?.on("data", (data: Buffer) => {
      this.stderrBuffer += data.toString();
      if (this.stderrBuffer.length > 2048) {
        this.stderrBuffer = this.stderrBuffer.slice(-2048);
      }
    });

    this.child.on("close", (code) => {
      this.logger.info(`App-server process exited with code ${code}`);
      this.cleanup(new Error(`Codex app-server exited with code ${code}`));
      this.onClose?.();
    });

    this.child.on("error", (error) => {
      this.logger.error("App-server process error:", error.message);
      this.cleanup(
        new Error(`Codex app-server process error: ${error.message}`),
      );
    });
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
    if (!this.child?.stdin) {
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
        this.pendingRequests.delete(requestId);
        reject(new Error(`RPC timeout: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: (value) =>
          resolve(value as CodexAppServerResult<Method>),
        reject,
        timer,
      });
      this.writeMessage(message);
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
    return this.child !== null && this.child.exitCode === null;
  }

  async stop(): Promise<void> {
    if (!this.child) return;

    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("App-server stopping"));
    }
    this.pendingRequests.clear();

    const child = this.child;
    this.cleanup();

    try {
      child.stdin?.end();
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
        child.on("close", () => {
          clearTimeout(killTimer);
          resolve();
        });
      });
    } catch {
      child.kill("SIGKILL");
    }
  }

  private writeMessage(message: unknown): void {
    if (!this.child?.stdin) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleMessage(rawMessage: string): void {
    if (!rawMessage.trim()) return;

    let message: unknown;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      return;
    }

    if (isResponse(message)) {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) return;

      this.pendingRequests.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new Error(
            `${message.error.message} (code: ${message.error.code})`,
          ),
        );
      } else {
        pending.resolve(message.result);
      }
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
  private drainJsonBuffer(): void {
    while (this.jsonBuffer.length > 0) {
      const trimStart = this.jsonBuffer.search(/\S/);
      if (trimStart === -1) {
        this.jsonBuffer = "";
        return;
      }
      if (trimStart > 0) {
        this.jsonBuffer = this.jsonBuffer.slice(trimStart);
      }

      if (this.jsonBuffer[0] !== "{") {
        const nextBrace = this.jsonBuffer.indexOf("{", 1);
        if (nextBrace === -1) {
          this.jsonBuffer = "";
          return;
        }
        this.jsonBuffer = this.jsonBuffer.slice(nextBrace);
        continue;
      }

      let depth = 0;
      let inString = false;
      let escaped = false;
      let endIndex = -1;

      for (let index = 0; index < this.jsonBuffer.length; index += 1) {
        const character = this.jsonBuffer[index];
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

      const rawMessage = this.jsonBuffer.slice(0, endIndex + 1);
      this.jsonBuffer = this.jsonBuffer.slice(endIndex + 1);
      this.handleMessage(rawMessage);
    }
  }

  private cleanup(pendingError?: Error): void {
    if (pendingError) {
      for (const pending of this.pendingRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(pendingError);
      }
      this.pendingRequests.clear();
    }

    this.child = null;
    this.jsonBuffer = "";
  }
}
