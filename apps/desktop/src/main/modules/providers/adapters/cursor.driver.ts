// ─────────────────────────────────────────────────────────────
// Cursor ProviderDriver
//
// SDK-specific seam for Cursor. Speaks ACP (JSON-RPC 2.0 over stdio) to a
// `cursor agent acp` subprocess. Wrapped by `createWorkRunAdapter()` in
// work-run-core.ts to expose the WorkRunAdapter interface.
//
// What this file owns:
//   - The ACP subprocess (CursorAcpServer) — single shared server.
//   - MainsMcpStdioServer bridge — single shared server.
//   - Per-run streaming buffers (on the Session object).
//   - ACP session/update → WorkRunEvent mapping (mapNotification, normalizeToolCall).
//   - Server-request handlers for permission approval & cursor extensions.
//   - SDK-shape concerns: session/new, session/load, session/prompt, session/cancel, model/list.
//
// What lives in Core:
//   - runId → session map for abort dispatch
//   - status emission, artifact collection, sessionId persistence
//   - cleanup ordering, cancelPendingRequests
// ─────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";
import { PROVIDER_IDS } from "../../../../shared/provider-ids";
import { emit } from "../../../ipc-kit";
import { findCursorBinaryPath } from "../providers.utils";
import type {
  AcquiredSession,
  CliUpdateResult,
  AccountInfo,
  CommandInfo,
  CursorAdapterConfig,
  DriverOutcome,
  ModelInfo,
  ProviderDriver,
  WorkRunContextItem,
  WorkRunContinueRequest,
  WorkRunEvent,
  WorkRunEventHandler,
  WorkRunForkRequest,
  WorkRunRequest,
} from "../../../../shared/adapter.types";
import { requestToolApproval } from "../../runs/user-input-broker";
import { runsRepo } from "../../runs/runs.repo";
import {
  adoptConfig,
  createLogger,
  appendPromptSections,
  saveAttachments,
  formatContextSection,
  resolveCatalogDefaultId,
} from "./adapter.shared";
import { MainsMcpStdioServer } from "./mains-mcp-server";
import type { ModeId } from "../../../../shared/modes";
import type { MainsToolContext } from "./mains-tools.core";

// ─────────────────────────────────────────────────────────────
// JSON-RPC types
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// Per-run session state (handed back to Core as the opaque `session`)
// ─────────────────────────────────────────────────────────────

interface CursorSession {
  runId: string;
  sessionId: string;
  agentMessageBuffer: string;
  /** Streamed ephemerally, never persisted. */
  agentThoughtBuffer: string;
  /**
   * ACP `tool_call_update` notifications are deltas — only changed fields
   * are present (per spec: "All fields except toolCallId are optional in
   * updates"). We cache the start payload here so the complete branch can
   * restore toolName/input when those fields aren't re-sent.
   */
  toolCallCache: Map<string, { toolName: string; input: Record<string, unknown> }>;
  /**
   * Tool call IDs we deliberately skipped (e.g. cursor extension TODOs,
   * create_plan, MCP). Their `tool_call_update` deltas must also be skipped,
   * even when title/kind aren't re-sent and we can't pattern-match again.
   */
  skippedToolCallIds: Set<string>;
}

const { info: logInfo, error: logError, warn: logWarn } = createLogger("[CursorDriver]");

// ─────────────────────────────────────────────────────────────
// ACP server process manager
// ─────────────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class CursorAcpServer {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pendingRequests = new Map<number | string, PendingRequest>();
  private notificationHandler: ((method: string, params: unknown) => void) | null = null;
  private serverRequestHandler:
    | ((id: number | string, method: string, params: unknown) => void)
    | null = null;
  private onClose: (() => void) | null = null;
  private stderrBuffer = "";
  private jsonBuffer = "";

  async start(binaryPath: string, env?: Record<string, string>): Promise<void> {
    if (this.child) return;

    const spawnEnv: Record<string, string | undefined> = {
      ...process.env,
      ...env,
    };

    this.child = spawn(binaryPath, ["acp"], {
      env: spawnEnv,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    if (!this.child.stdout || !this.child.stdin) {
      throw new Error("Failed to get stdio pipes from cursor acp");
    }

    this.child.stdout.on("data", (chunk: Buffer) => {
      this.jsonBuffer += chunk.toString();
      this.drainJsonBuffer();
      if (this.jsonBuffer.length > 32 * 1024 * 1024) {
        logError(
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

    this.child.on("close", (code, signal) => {
      const tail = this.stderrBuffer.trim();
      logInfo(
        `ACP process exited code=${code} signal=${signal ?? "none"}${tail ? ` stderr:\n${tail}` : " (no stderr)"}`,
      );
      for (const [, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error(`ACP server exited (code=${code}, signal=${signal ?? "none"})`),
        );
      }
      this.pendingRequests.clear();
      this.cleanup();
      this.onClose?.();
    });

    this.child.on("error", (err) => {
      logError("ACP process error:", err.message);
      this.cleanup();
    });
  }

  setNotificationHandler(handler: (method: string, params: unknown) => void): void {
    this.notificationHandler = handler;
  }

  setServerRequestHandler(
    handler: (id: number | string, method: string, params: unknown) => void,
  ): void {
    this.serverRequestHandler = handler;
  }

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  async sendRequest(method: string, params?: unknown, timeoutMs = 30000): Promise<unknown> {
    if (!this.child?.stdin) {
      throw new Error("ACP server not running");
    }

    const reqId = this.nextId++;
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: reqId,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`RPC timeout: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pendingRequests.set(reqId, { resolve, reject, timer });
      this.writeMessage(message);
    });
  }

  respondToRequest(id: number | string, result: unknown): void {
    this.writeMessage({ jsonrpc: "2.0", id, result });
  }

  respondToRequestError(id: number | string, code: number, message: string): void {
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

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("ACP server stopping"));
    }
    this.pendingRequests.clear();

    const child = this.child;
    this.cleanup();

    try {
      child.stdin?.end();
      try {
        child.kill("SIGTERM");
      } catch {
        /* already exited */
      }
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already exited */
          }
          resolve();
        }, 500);
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
    const encoded = JSON.stringify(message);
    this.child.stdin.write(`${encoded}\n`);
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    if (isResponse(parsed)) {
      const pending = this.pendingRequests.get(parsed.id);
      if (pending) {
        this.pendingRequests.delete(parsed.id);
        clearTimeout(pending.timer);
        if (parsed.error) {
          pending.reject(
            new Error(`${parsed.error.message} (code: ${parsed.error.code})`),
          );
        } else {
          pending.resolve(parsed.result);
        }
      }
    } else if (isServerRequest(parsed)) {
      this.serverRequestHandler?.(parsed.id, parsed.method, parsed.params);
    } else if (isServerNotification(parsed)) {
      this.notificationHandler?.(parsed.method, parsed.params);
    }
  }

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
      let endIdx = -1;

      for (let i = 0; i < this.jsonBuffer.length; i++) {
        const ch = this.jsonBuffer[i];
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

      const jsonStr = this.jsonBuffer.slice(0, endIdx + 1);
      this.jsonBuffer = this.jsonBuffer.slice(endIdx + 1);

      this.handleLine(jsonStr);
    }
  }

  private cleanup(): void {
    this.child = null;
    this.jsonBuffer = "";
  }
}

// ─────────────────────────────────────────────────────────────
// Parameterized model picker — config option parsing
//
// When the client advertises `_meta.parameterizedModelPicker: true` in the ACP
// `initialize` handshake, `cursor agent` returns a `configOptions` array on the
// `session/new` and `session/set_config_option` responses. Each entry is a
// `select`/`boolean` describing a tunable: the active model, reasoning effort,
// context window, fast mode, thinking. We mine these to (a) surface effort
// levels in the model picker and (b) push the user's effort/fast/thinking
// choices back via `session/set_config_option`. Mirrors t3code's CursorProvider
// parsing (apps/server/src/provider/Layers/CursorProvider.ts).
// ─────────────────────────────────────────────────────────────

export type CursorEffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

/** A single ACP session config option (select/boolean tunable). */
export interface CursorConfigOption {
  id: string;
  name?: string;
  category?: string;
  type?: string;
  currentValue?: unknown;
  options?: Array<
    | { value?: string; name?: string; label?: string }
    | { options?: Array<{ value?: string; name?: string; label?: string }> }
  >;
}

interface CursorSelectChoice {
  value: string;
  name: string;
}

/** The user's tunable selections, resolved from per-run snapshot + provider config. */
export interface CursorSelection {
  effort?: string;
  fastMode?: boolean;
  thinking?: boolean;
}

/** Flatten a `select` config option's (possibly grouped) choices to `{value, name}`. */
export function flattenCursorSelectOptions(
  option: CursorConfigOption | undefined,
): CursorSelectChoice[] {
  if (!option || option.type !== "select" || !Array.isArray(option.options)) return [];
  const out: CursorSelectChoice[] = [];
  for (const entry of option.options) {
    if (!entry || typeof entry !== "object") continue;
    if ("value" in entry && typeof entry.value === "string") {
      const name = entry.name ?? entry.label ?? entry.value;
      out.push({ value: entry.value.trim(), name: name.trim() });
      continue;
    }
    if ("options" in entry && Array.isArray(entry.options)) {
      for (const nested of entry.options) {
        if (nested && typeof nested === "object" && typeof nested.value === "string") {
          const name = nested.name ?? nested.label ?? nested.value;
          out.push({ value: nested.value.trim(), name: name.trim() });
        }
      }
    }
  }
  return out;
}

/** Normalize a cursor reasoning token to mains' canonical effort vocabulary. */
export function normalizeCursorReasoning(value: unknown): CursorEffortLevel | undefined {
  const n = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (n) {
    case "low":
    case "medium":
    case "high":
    case "max":
      return n;
    case "xhigh":
    case "extra-high":
    case "extra high":
      return "xhigh";
    default:
      return undefined;
  }
}

function configOptionCategory(o: CursorConfigOption): string {
  return (o.category ?? "").trim().toLowerCase();
}

function idOrNameMatches(o: CursorConfigOption, ...keywords: string[]): boolean {
  const id = o.id.trim().toLowerCase();
  const name = (o.name ?? "").trim().toLowerCase();
  return keywords.some((k) => id === k || name === k || name.includes(k));
}

export function findCursorModelOption(
  opts: CursorConfigOption[],
): CursorConfigOption | undefined {
  return opts.find((o) => o.category === "model");
}

export function findCursorEffortOption(
  opts: CursorConfigOption[],
): CursorConfigOption | undefined {
  const candidates = opts.filter(
    (o) => o.type === "select" && idOrNameMatches(o, "effort", "reasoning"),
  );
  return (
    candidates.find((o) => configOptionCategory(o) === "model_option") ??
    candidates.find((o) => o.id.trim().toLowerCase() === "effort") ??
    candidates.find((o) => configOptionCategory(o) === "thought_level") ??
    candidates[0]
  );
}

export function findCursorFastOption(
  opts: CursorConfigOption[],
): CursorConfigOption | undefined {
  return opts.find(
    (o) =>
      o.category === "model_config" &&
      (o.id.trim().toLowerCase() === "fast" ||
        (o.name ?? "").trim().toLowerCase() === "fast" ||
        (o.name ?? "").trim().toLowerCase().includes("fast mode")),
  );
}

export function findCursorThinkingOption(
  opts: CursorConfigOption[],
): CursorConfigOption | undefined {
  return opts.find(
    (o) =>
      o.category === "model_config" &&
      (o.id.trim().toLowerCase() === "thinking" ||
        (o.name ?? "").trim().toLowerCase().includes("thinking")),
  );
}

/** Distinct, normalized effort levels advertised by a config-option set (UI order preserved). */
export function extractCursorEffortLevels(
  opts: CursorConfigOption[] | undefined,
): CursorEffortLevel[] {
  if (!opts || opts.length === 0) return [];
  const opt = findCursorEffortOption(opts);
  if (!opt) return [];
  const seen = new Set<CursorEffortLevel>();
  const out: CursorEffortLevel[] = [];
  for (const c of flattenCursorSelectOptions(opt)) {
    const lvl = normalizeCursorReasoning(c.value) ?? normalizeCursorReasoning(c.name);
    if (lvl && !seen.has(lvl)) {
      seen.add(lvl);
      out.push(lvl);
    }
  }
  return out;
}

/** Resolve the advertised `select` value for a requested effort level (or undefined). */
export function resolveCursorEffortValue(
  opt: CursorConfigOption,
  requested: CursorEffortLevel,
): string | undefined {
  return flattenCursorSelectOptions(opt).find(
    (c) =>
      normalizeCursorReasoning(c.value) === requested ||
      normalizeCursorReasoning(c.name) === requested,
  )?.value;
}

/** Resolve the advertised value (select or native boolean) for a requested toggle. */
export function resolveCursorBooleanValue(
  opt: CursorConfigOption,
  requested: boolean,
): string | boolean | undefined {
  if (opt.type === "boolean") return requested;
  return flattenCursorSelectOptions(opt).find(
    (c) => c.value.trim().toLowerCase() === String(requested),
  )?.value;
}

/**
 * Split a mains model spec into its base ACP model id and any encoded `fast`
 * flag. mains' catalog encodes fast mode in the model string itself (e.g.
 * `composer-2.5[fast=true]`), but the parameterized picker advertises the base
 * id (`composer-2.5`) with `fast` as a separate config option — so we strip the
 * `[...]` suffix before sending it and fold the encoded flag into the selection.
 * Mirrors t3code's `resolveCursorAcpBaseModelId`.
 */
export function splitCursorModelSpec(model: string | null | undefined): {
  baseId: string | undefined;
  fast?: boolean;
} {
  const trimmed = typeof model === "string" ? model.trim() : "";
  if (!trimmed) return { baseId: undefined };
  const bracket = trimmed.indexOf("[");
  if (bracket < 0) return { baseId: trimmed };
  const baseId = trimmed.slice(0, bracket).trim() || undefined;
  const suffix = trimmed.slice(bracket).toLowerCase();
  if (/\bfast\s*=\s*true\b/.test(suffix)) return { baseId, fast: true };
  if (/\bfast\s*=\s*false\b/.test(suffix)) return { baseId, fast: false };
  return { baseId };
}

/**
 * Per-model capabilities mined from that model's `configOptions`.
 *
 * IMPORTANT: cursor-agent only exposes the *active* model's effort/fast options,
 * and effort availability is genuinely per-model (e.g. `composer-2.5` exposes
 * `fast` but no reasoning effort; `claude-opus-4-8` exposes `effort`
 * low/medium/high/xhigh/max; `gpt-5.5` exposes `reasoning` none/low/…/extra-high).
 * So caps must be discovered by selecting each model — they cannot be inferred
 * from a single response. This is the cache value the background probe fills.
 */
export interface CursorModelCaps {
  effortLevels: CursorEffortLevel[];
  hasFast: boolean;
}

/** Mine a single model's capabilities from its (post-selection) config options. */
export function extractCursorModelCaps(
  configOptions: CursorConfigOption[] | undefined,
): CursorModelCaps {
  return {
    effortLevels: extractCursorEffortLevels(configOptions),
    hasFast: configOptions ? !!findCursorFastOption(configOptions) : false,
  };
}

/** Build a `ModelInfo` from a model id/name and its discovered capabilities. */
export function buildCursorModelInfo(
  id: string,
  displayName: string,
  isDefault: boolean,
  caps: CursorModelCaps | undefined,
): ModelInfo {
  const effortLevels = caps?.effortLevels ?? [];
  return {
    id,
    displayName: displayName || id,
    isDefault,
    ...(effortLevels.length > 0
      ? { supportsEffort: true, supportedEffortLevels: effortLevels }
      : {}),
    ...(caps?.hasFast ? { supportsFastMode: true } : {}),
  };
}

/** Merge per-run snapshot overrides over provider config into a resolved selection. */
export function resolveCursorSelection(
  overrides: Record<string, unknown>,
  config: Pick<CursorAdapterConfig, "effortLevel" | "fastMode" | "thinking">,
): CursorSelection {
  const effort =
    (typeof overrides.effortLevel === "string" && overrides.effortLevel) ||
    (typeof overrides.reasoning === "string" && overrides.reasoning) ||
    config.effortLevel ||
    undefined;
  const fastMode =
    typeof overrides.fastMode === "boolean"
      ? overrides.fastMode
      : typeof config.fastMode === "boolean"
        ? config.fastMode
        : undefined;
  const thinking =
    typeof overrides.thinking === "boolean"
      ? overrides.thinking
      : typeof overrides.thinkingMode === "boolean"
        ? overrides.thinkingMode
        : typeof config.thinking === "boolean"
          ? config.thinking
          : undefined;
  return { effort, fastMode, thinking };
}

interface CursorModeRequestSender {
  sendRequest(method: string, params?: unknown): Promise<unknown>;
}

/**
 * Apply the requested ACP session mode even when it is Cursor's default
 * "agent" mode. ACP sessions may retain a previous "plan" mode across resume,
 * so omitting the default is not equivalent to resetting the session.
 */
export async function applyCursorSessionMode(
  server: CursorModeRequestSender,
  sessionId: string,
  mode: string | undefined,
): Promise<boolean> {
  if (!mode) return false;
  await server.sendRequest("session/set_mode", {
    sessionId,
    modeId: mode,
  });
  return true;
}

// ─────────────────────────────────────────────────────────────
// Driver factory
// ─────────────────────────────────────────────────────────────

export function createCursorDriver(config: CursorAdapterConfig): ProviderDriver {
  let acpServer: CursorAcpServer | null = null;
  let mcpServer: MainsMcpStdioServer | null = null;

  // Cross-run memos
  const sessionIdMap = new Map<string, string>(); // runId → cursor sessionId

  // Per-model capability cache (modelId → caps). Effort/fast are per-model and
  // cost a ~1.5s round-trip each to discover, so we cache them, persist across
  // launches, and fill them in the background. `capsAttempted` prevents
  // re-probing models that failed/returned nothing within a single session.
  const modelCapsCache = new Map<string, CursorModelCaps>();
  const capsAttempted = new Set<string>();
  let capsCacheLoaded = false;
  let enrichmentInFlight = false;
  const CAPS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  // Slash commands, cached per cwd. Cursor streams them via the
  // `available_commands_update` notification (not in the session/new response).
  const commandCacheByCwd = new Map<string, CommandInfo[]>();

  function findCursorBinary(): string {
    if (config.binary) return config.binary;
    const resolved = findCursorBinaryPath();
    if (resolved) return resolved;
    throw new Error(
      "Cursor Agent CLI not found. Install it with: curl https://cursor.com/install -fsS | bash\n" +
        "Or set config.binary to the full path of the `agent` executable.",
    );
  }

  /**
   * Set up the MCP server (bridge + config file).
   * ACP does not need to be restarted: `session/new` carries the mcpServers
   * config per-session, and the .cursor/mcp.json file is only needed for
   * the user-runs-cursor-manually auto-discovery path.
   */
  async function ensureMcpServer(
    ctx: MainsToolContext,
    mode?: ModeId,
  ): Promise<typeof mcpServer> {
    if (mcpServer?.isRunning) {
      await mcpServer.stop();
    }
    mcpServer = new MainsMcpStdioServer(ctx, mode);
    await mcpServer.start();
    logInfo(`Mains MCP stdio bridge started`);
    return mcpServer;
  }

  function buildAcpEnv(binaryPath: string): Record<string, string> {
    const env: Record<string, string> = {};
    env.HOME = os.homedir();

    const extraPaths = [
      path.dirname(binaryPath),
      path.join(os.homedir(), ".local", "bin"),
      "/usr/local/bin",
      "/opt/homebrew/bin",
    ];
    env.PATH = [...extraPaths, process.env.PATH || ""].join(":");

    if (config.apiKey) {
      env.CURSOR_API_KEY = config.apiKey;
    } else if (process.env.CURSOR_API_KEY) {
      env.CURSOR_API_KEY = process.env.CURSOR_API_KEY;
    }
    return env;
  }

  /**
   * Spawn an `agent acp` process and run the ACP handshake (initialize +
   * authenticate), returning the ready server. Does NOT touch the shared
   * `acpServer` field, so it's safe to use for isolated, throwaway probe
   * processes as well as the long-lived run server.
   */
  async function startInitializedServer(): Promise<CursorAcpServer> {
    const binaryPath = findCursorBinary();
    const server = new CursorAcpServer();
    await server.start(binaryPath, buildAcpEnv(binaryPath));

    // ACP handshake
    const initResult = (await server.sendRequest("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "mains", title: "Mains Desktop", version: "1.0.0" },
      clientCapabilities: {
        // Opt into the parameterized model picker so `session/new` and
        // `session/set_config_option` return a `configOptions` array (model +
        // reasoning effort + fast/thinking tunables). Drives effort discovery
        // in listModels and effort application in configureSession.
        _meta: { parameterizedModelPicker: true },
        cursorExtensions: {
          askQuestion: true,
          createPlan: true,
          updateTodos: true,
          task: true,
          generateImage: true,
        },
      },
    })) as Record<string, unknown>;
    server.sendNotification("initialized");

    const authMethods = initResult?.authMethods as Array<{ id: string }> | undefined;
    if (authMethods && authMethods.length > 0) {
      const methodId = authMethods[0].id;
      await server.sendRequest("authenticate", { methodId });
    }
    return server;
  }

  async function ensureServer(): Promise<CursorAcpServer> {
    if (acpServer?.isRunning) return acpServer;

    logInfo("Starting ACP server: agent acp");
    const server = await startInitializedServer();
    acpServer = server;

    server.setOnClose(() => {
      if (acpServer === server) {
        acpServer = null;
      }
    });

    logInfo("ACP server initialized and authenticated");
    return server;
  }

  // ─────────────────────────────────────────────────────────────
  // Model capability discovery (background, isolated process)
  // ─────────────────────────────────────────────────────────────

  function capsCacheFile(): string {
    try {
      // Lazy require: keeps `electron` out of the module's load-time deps so the
      // pure-function unit tests can import this file without an Electron runtime.
      const { app } = require("electron") as typeof import("electron");
      return path.join(app.getPath("userData"), "cursor-model-caps.json");
    } catch {
      return path.join(os.tmpdir(), "cursor-model-caps.json");
    }
  }

  function loadCapsCache(): void {
    if (capsCacheLoaded) return;
    capsCacheLoaded = true;
    try {
      const raw = fs.readFileSync(capsCacheFile(), "utf8");
      const data = JSON.parse(raw) as {
        ts?: number;
        models?: Record<string, CursorModelCaps>;
      };
      if (!data?.models) return;
      if (data.ts && Date.now() - data.ts > CAPS_TTL_MS) return; // stale → re-probe
      for (const [id, caps] of Object.entries(data.models)) {
        if (caps && Array.isArray(caps.effortLevels)) {
          modelCapsCache.set(id, { effortLevels: caps.effortLevels, hasFast: !!caps.hasFast });
        }
      }
    } catch {
      /* no cache yet — first run */
    }
  }

  function saveCapsCache(): void {
    try {
      const models: Record<string, CursorModelCaps> = {};
      for (const [id, caps] of modelCapsCache) models[id] = caps;
      fs.writeFileSync(
        capsCacheFile(),
        JSON.stringify({ ts: Date.now(), models }),
        "utf8",
      );
    } catch {
      /* best-effort */
    }
  }

  function broadcastModelsUpdated(): void {
    try {
      emit(CHANNELS.providers.modelsUpdated, {
        providerId: PROVIDER_IDS.cursor,
      });
    } catch {
      /* main-process only; ignored in tests */
    }
  }

  /**
   * Probe each model's capabilities on a DEDICATED, throwaway `agent acp`
   * process — never the shared run server. cursor-agent keeps a single global
   * "current model" per process, so switching models on the run server would
   * corrupt an in-flight run. Sequential within the probe (the agent serializes
   * model state); results are cached, persisted, and broadcast on completion.
   */
  async function enrichModelCaps(modelConfigId: string, modelIds: string[]): Promise<void> {
    if (enrichmentInFlight) return;
    const todo = modelIds.filter((id) => !modelCapsCache.has(id) && !capsAttempted.has(id));
    if (todo.length === 0) return;
    enrichmentInFlight = true;
    let probe: CursorAcpServer | null = null;
    try {
      probe = await startInitializedServer();
      const sn = (await probe.sendRequest("session/new", {
        cwd: os.homedir(),
        mcpServers: [],
      })) as Record<string, unknown>;
      const sessionId = sn?.sessionId as string | undefined;
      if (!sessionId) return;

      let changed = false;
      for (const id of todo) {
        capsAttempted.add(id);
        try {
          const res = (await probe.sendRequest(
            "session/set_config_option",
            { sessionId, configId: modelConfigId, value: id },
            15000,
          )) as Record<string, unknown> | undefined;
          const caps = extractCursorModelCaps(
            res?.configOptions as CursorConfigOption[] | undefined,
          );
          modelCapsCache.set(id, caps);
          changed = true;
        } catch {
          /* leave uncached; retried on a future launch */
        }
      }

      if (changed) {
        saveCapsCache();
        broadcastModelsUpdated();
        logInfo(`Enriched ${todo.length} cursor model capabilities`);
      }
    } catch (error) {
      logWarn(
        `Model capability enrichment failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (probe) {
        try {
          await probe.stop();
        } catch {
          /* ignore */
        }
      }
      enrichmentInFlight = false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Event mapping: ACP session/update notifications → WorkRunEvent
  // ─────────────────────────────────────────────────────────────

  /**
   * Tool calls we suppress on the standard session/update channel because
   * they're either richer on a cursor extension method, or aren't real
   * tool invocations from the user's perspective:
   *   - create_plan: surfaced via cursor/create_plan server-request.
   *   - update_todos: surfaced via cursor/update_todos notification.
   *   - mcp_tool_call / mains-*: in-process MCP bridge tracks these itself.
   */
  function shouldSkipToolCall(kind: string | undefined, title: string | undefined): boolean {
    if (kind === "create_plan" || kind === "plan" || /create\s*plan/i.test(title ?? "")) {
      return true;
    }
    if (kind === "update_todos" || /^update\s*todos?$/i.test(title ?? "")) {
      return true;
    }
    if (
      kind === "mcp_tool_call" ||
      /mcp/i.test(kind ?? "") ||
      /mcp/i.test(title ?? "") ||
      /^mains[-_]/i.test(title ?? "")
    ) {
      return true;
    }
    return false;
  }

  function normalizeToolCall(
    kind: string | undefined,
    title: string | undefined,
    rawInput: Record<string, unknown> | undefined,
    locations: Array<{ path?: string; line?: number }> | undefined,
  ): { toolName: string; input: Record<string, unknown> } {
    const input: Record<string, unknown> = { ...rawInput };
    const firstPath = locations?.[0]?.path;

    if (title) input._title = title;

    switch (kind) {
      case "read": {
        if (firstPath) input.file_path = firstPath;
        if (!input.file_path && title) {
          const m = title.match(/(?:Read(?:ing)?(?:\s+File)?)\s+(.+)/i);
          if (m) input.file_path = m[1].trim();
        }
        return { toolName: "Read", input };
      }
      case "edit": {
        if (firstPath) input.file_path = firstPath;
        if (!input.file_path && title) {
          const m = title.match(/(?:Edit(?:ing)?(?:\s+File)?)\s+(.+)/i);
          if (m) input.file_path = m[1].trim();
        }
        return { toolName: "Edit", input };
      }
      case "delete": {
        if (firstPath) input.file_path = firstPath;
        return { toolName: "Delete", input };
      }
      case "execute": {
        if (!input.command && title) {
          const m = title.match(/(?:Execut(?:e|ing)|Running?)[:\s]+(.+)/i);
          if (m) input.command = m[1].trim();
          else input.command = title;
        }
        return { toolName: "Bash", input };
      }
      case "search": {
        if (!input.pattern && title) {
          const m = title.match(/(?:Search(?:ing)?(?:\s+for)?|Grep)\s+['"]?([^'"]+)['"]?/i);
          if (m) input.pattern = m[1].trim();
        }
        if (firstPath) input.path = firstPath;
        return { toolName: "Grep", input };
      }
      case "fetch": {
        if (!input.url && title) {
          const m = title.match(/https?:\/\/\S+/);
          if (m) input.url = m[0];
        }
        return { toolName: "WebFetch", input };
      }
      case "think": {
        return { toolName: title ?? "Think", input };
      }
      default: {
        if (firstPath) input.file_path = firstPath;
        let name = title ?? kind ?? "Tool";
        const mcpMatch = name.match(/^mains[-_](\w+)(?::\s*\w+)?$/i);
        if (mcpMatch) {
          name = mcpMatch[1];
          delete input._title;
        }
        return { toolName: name, input };
      }
    }
  }

  function mapNotification(
    method: string,
    params: unknown,
    cs: CursorSession,
  ): WorkRunEvent[] {
    const ts = Date.now();
    const events: WorkRunEvent[] = [];
    const p = params as Record<string, unknown> | undefined;

    if (method === "cursor/update_todos") {
      const todos = p?.todos as
        | Array<{ id: string; content: string; status: string }>
        | undefined;
      const merge = (p?.merge as boolean) ?? false;
      if (todos && todos.length > 0) {
        const statusIcon = (s: string) =>
          s === "completed"
            ? "✅"
            : s === "in_progress"
              ? "⏳"
              : s === "cancelled"
                ? "❌"
                : "⬜";
        const todosText = todos
          .map((t) => `${statusIcon(t.status)} ${t.content}`)
          .join("\n");
        // Emit start+complete pair: projectToolCall drops complete events
        // without a matching start, so the row would never persist otherwise.
        const extToolCallId = `cursor-todos-${cs.runId}-${ts}`;
        events.push({
          type: "tool_call",
          toolName: "Todos",
          input: { todos: todosText, merge },
          startedAt: ts,
          metadata: {
            phase: "start",
            toolCallId: extToolCallId,
            cursorExtension: "update_todos",
            merge,
            todoItems: todos,
          },
        });
        events.push({
          type: "tool_call",
          toolName: "Todos",
          input: { todos: todosText, merge },
          output: todosText,
          startedAt: ts,
          endedAt: ts,
          metadata: {
            phase: "complete",
            toolCallId: extToolCallId,
            cursorExtension: "update_todos",
            merge,
            todoItems: todos,
          },
        });
      }
      return events;
    }

    if (method === "cursor/task") {
      const description = (p?.description as string) ?? "Subagent task";
      const prompt = p?.prompt as string | undefined;
      const subagentType = p?.subagentType as string | { custom: string } | undefined;
      const model = p?.model as string | undefined;
      const agentId = p?.agentId as string | undefined;
      const durationMs = p?.durationMs as number | undefined;

      const typeLabel =
        typeof subagentType === "object" && subagentType !== null
          ? (subagentType as { custom: string }).custom
          : ((subagentType as string) ?? "unspecified");
      const durationSuffix = durationMs ? ` (${(durationMs / 1000).toFixed(1)}s)` : "";

      events.push({
        type: "log",
        message: `[task:${typeLabel}] ${description}${durationSuffix}`,
        level: "info",
        ts,
        metadata: {
          cursorExtension: "task",
          description,
          prompt,
          subagentType: typeLabel,
          model,
          agentId,
          durationMs,
        },
      });
      return events;
    }

    if (method === "cursor/generate_image") {
      const description = (p?.description as string) ?? "Generated image";
      const filePath = p?.filePath as string | undefined;
      const referenceImagePaths = p?.referenceImagePaths as string[] | undefined;

      events.push({
        type: "artifact",
        kind: "file",
        path: filePath,
        content: description,
        metadata: {
          cursorExtension: "generate_image",
          filePath,
          referenceImagePaths,
        },
      });
      return events;
    }

    if (method !== "session/update") {
      return events;
    }

    const update = p?.update as Record<string, unknown> | undefined;
    if (!update) return events;

    const updateType = update.sessionUpdate as string | undefined;

    switch (updateType) {
      case "agent_message_chunk": {
        const content = update.content as Record<string, unknown> | undefined;
        const text = content?.text as string | undefined;
        if (text) {
          cs.agentMessageBuffer += text;
          events.push({
            type: "artifact",
            kind: "report",
            content: cs.agentMessageBuffer,
            metadata: { source: "agent_message_streaming" },
            ephemeral: true,
            streamId: `cursor-msg-${cs.runId}`,
          });
        }
        break;
      }

      case "agent_thought_chunk": {
        const content = update.content as Record<string, unknown> | undefined;
        const text = content?.text as string | undefined;
        if (text) {
          cs.agentThoughtBuffer += text;
          events.push({
            type: "artifact",
            kind: "report",
            content: cs.agentThoughtBuffer,
            metadata: { source: "agent_thought_streaming" },
            ephemeral: true,
            streamId: `cursor-think-${cs.runId}`,
          });
        }
        break;
      }

      case "tool_call": {
        // Flush agent message buffer before tool events (preserves interleaved order)
        if (cs.agentMessageBuffer.trim()) {
          events.push({
            type: "artifact",
            kind: "report",
            content: cs.agentMessageBuffer.trim(),
            metadata: { source: "agent_message" },
          });
          cs.agentMessageBuffer = "";
        }

        const toolCallId = update.toolCallId as string | undefined;
        const title = update.title as string | undefined;
        const kind = update.kind as string | undefined;
        const status = update.status as string | undefined;
        const rawInput = update.rawInput as Record<string, unknown> | undefined;
        const locations = update.locations as
          | Array<{ path?: string; line?: number }>
          | undefined;

        if (shouldSkipToolCall(kind, title)) {
          if (toolCallId) cs.skippedToolCallIds.add(toolCallId);
          break;
        }

        const { toolName, input: normalizedInput } = normalizeToolCall(
          kind,
          title,
          rawInput,
          locations,
        );

        if (status === "pending" || status === "in_progress") {
          if (toolCallId) {
            cs.toolCallCache.set(toolCallId, { toolName, input: normalizedInput });
          }
          cs.agentThoughtBuffer = "";
          events.push({
            type: "artifact",
            kind: "report",
            content: "",
            metadata: { source: "agent_thought_streaming" },
            ephemeral: true,
            streamId: `cursor-think-${cs.runId}`,
          });
          events.push({
            type: "tool_call",
            toolName,
            input: normalizedInput,
            startedAt: ts,
            metadata: { phase: "start", toolCallId, title, kind },
          });
        }
        break;
      }

      case "tool_call_update": {
        const toolCallId = update.toolCallId as string | undefined;
        const title = update.title as string | undefined;
        const kind = update.kind as string | undefined;
        const status = update.status as string | undefined;
        const rawOutput = update.rawOutput as unknown;
        const rawInput = update.rawInput as Record<string, unknown> | undefined;
        const locations = update.locations as
          | Array<{ path?: string; line?: number }>
          | undefined;
        const content = update.content as Array<Record<string, unknown>> | undefined;

        // Skip deltas for tool calls whose start was deliberately suppressed
        // (TODOs handled via extension, create_plan, MCP). Title/kind may be
        // absent on the delta — fall back to the cached set keyed by ID.
        if (toolCallId && cs.skippedToolCallIds.has(toolCallId)) {
          if (status === "completed" || status === "failed") {
            cs.skippedToolCallIds.delete(toolCallId);
          }
          break;
        }
        if (shouldSkipToolCall(kind, title)) break;

        const { toolName, input: normalizedInput } = normalizeToolCall(
          kind,
          title,
          rawInput,
          locations,
        );

        if (status === "completed" || status === "failed") {
          const cached = toolCallId ? cs.toolCallCache.get(toolCallId) : undefined;
          const diffBlock = content?.find((c) => c.type === "diff");
          if (diffBlock) {
            if (typeof diffBlock.path === "string") normalizedInput.file_path = diffBlock.path;
            if (typeof diffBlock.oldText === "string")
              normalizedInput.old_string = diffBlock.oldText;
            if (typeof diffBlock.newText === "string")
              normalizedInput.new_string = diffBlock.newText;
          }

          // ACP `tool_call_update` is a delta — only changed fields are
          // re-sent. If none of the input-bearing fields are present, leave
          // `input` undefined so the start-time value is preserved in DB.
          const hasInputDelta =
            rawInput !== undefined ||
            title !== undefined ||
            kind !== undefined ||
            locations?.[0]?.path !== undefined ||
            diffBlock !== undefined;
          const finalInput = hasInputDelta
            ? { ...(cached?.input ?? {}), ...normalizedInput }
            : undefined;
          // Likewise restore toolName from cache when delta omits kind/title.
          const finalToolName =
            kind !== undefined || title !== undefined
              ? toolName
              : (cached?.toolName ?? toolName);

          let outputText: unknown;
          if (content && content.length > 0) {
            const textParts = content
              .filter((c) => c.type === "text")
              .map((c) => c.text as string);
            outputText = textParts.length > 0 ? textParts.join("\n") : diffBlock ? "" : undefined;
          }
          if (outputText === undefined) {
            if (rawOutput && typeof rawOutput === "object" && (rawOutput as { content?: unknown }).content) {
              outputText = (rawOutput as { content: unknown }).content;
            } else {
              outputText = rawOutput;
            }
          }

          events.push({
            type: "tool_call",
            toolName: finalToolName,
            input: finalInput,
            output: outputText,
            error:
              status === "failed"
                ? (title ?? cached?.toolName ?? "Tool call failed")
                : undefined,
            endedAt: ts,
            metadata: {
              phase: "complete",
              toolCallId,
              title: title ?? cached?.toolName,
              kind,
            },
          });

          if (toolCallId) cs.toolCallCache.delete(toolCallId);
        }
        break;
      }

      case "plan": {
        const planContent = update.content as Array<Record<string, unknown>> | undefined;
        if (planContent) {
          const planText = planContent
            .filter((c) => c.type === "text")
            .map((c) => c.text as string)
            .join("\n");
          if (planText) {
            events.push({
              type: "tool_call",
              toolName: "Plan",
              input: { plan: planText },
              output: { planStatus: "pending" },
              startedAt: ts,
              endedAt: ts,
              metadata: { phase: "complete" },
            });
          }
        }
        break;
      }

      case "session_info_update": {
        const title = update.title as string | undefined;
        if (title) {
          events.push({
            type: "log",
            message: title,
            level: "sdk-user",
            ts,
            metadata: { sessionTitle: title },
          });
          runsRepo.updateRun(cs.runId, { title }).catch((err) =>
            logError("Failed to update run title:", err),
          );
        }
        break;
      }

      case "available_commands_update":
      case "current_mode_update":
      case "config_option_update":
      case "user_message_chunk":
        break;

      default:
        logInfo(`[ACP] Unhandled sessionUpdate type: ${updateType}`);
        break;
    }

    return events;
  }

  // ─────────────────────────────────────────────────────────────
  // Server-request handler — permission approval & cursor extensions
  // ─────────────────────────────────────────────────────────────

  function buildServerRequestHandler(
    server: CursorAcpServer,
    cs: CursorSession,
    onEvent: WorkRunEventHandler,
  ): (id: number | string, method: string, params: unknown) => Promise<void> {
    return async (id, method, params) => {
      const p = params as Record<string, unknown> | undefined;

      switch (method) {
        case "session/request_permission": {
          const options = p?.options as Array<Record<string, unknown>> | undefined;
          const allowOnceId =
            (options?.find((o) => o.kind === "allow_once")?.optionId as string) ??
            "allow-once";
          const allowAlwaysId =
            (options?.find((o) => o.kind === "allow_always")?.optionId as string) ??
            "allow-always";
          const rejectOnceId =
            (options?.find((o) => o.kind === "reject_once")?.optionId as string) ??
            "reject-once";

          const toolCall = p?.toolCall as Record<string, unknown> | undefined;
          const acpKind = toolCall?.kind as string | undefined;
          const acpTitle = toolCall?.title as string | undefined;
          const acpLocations = toolCall?.locations as Array<{ path?: string }> | undefined;

          if (acpTitle && /^mains[-_]/i.test(acpTitle)) {
            server.respondToRequest(id, {
              outcome: { outcome: "selected", optionId: allowAlwaysId },
            });
            break;
          }

          const { toolName: approvalToolName, input: approvalInput } = normalizeToolCall(
            acpKind,
            acpTitle,
            undefined,
            acpLocations,
          );

          try {
            const result = await requestToolApproval({
              requestId: String(id),
              runId: cs.runId,
              toolName: approvalToolName,
              toolInput: approvalInput,
              kind: "tool_approval",
              timestamp: Date.now(),
            });

            if (!result.approved) {
              server.respondToRequest(id, {
                outcome: { outcome: "selected", optionId: rejectOnceId },
              });
            } else if (result.answer === "acceptForSession") {
              server.respondToRequest(id, {
                outcome: { outcome: "selected", optionId: allowAlwaysId },
              });
            } else {
              server.respondToRequest(id, {
                outcome: { outcome: "selected", optionId: allowOnceId },
              });
            }
          } catch {
            server.respondToRequest(id, { outcome: { outcome: "cancelled" } });
          }
          break;
        }

        case "cursor/ask_question": {
          const questions = p?.questions as Array<Record<string, unknown>> | undefined;
          const title = p?.title as string | undefined;

          if (!questions || questions.length === 0) {
            server.respondToRequest(id, {
              outcome: { outcome: "skipped", reason: "No questions provided" },
            });
            break;
          }

          const q = questions[0];
          const qId = q.id as string;
          const prompt = (q.prompt as string) ?? title ?? "Question from Cursor";
          const qOptions = q.options as Array<{ id: string; label: string }> | undefined;
          const allowMultiple = (q.allowMultiple as boolean) ?? false;

          try {
            const result = await requestToolApproval({
              requestId: String(id),
              runId: cs.runId,
              toolName: title ?? "Question",
              toolInput: {},
              kind: "ask_user",
              question: prompt,
              options: qOptions?.map((o) => ({ label: o.label, description: undefined })),
              multiSelect: allowMultiple,
              timestamp: Date.now(),
            });

            if (!result.approved) {
              server.respondToRequest(id, { outcome: { outcome: "cancelled" } });
            } else if (result.answer) {
              const answerLabels = result.answer.split(", ");
              const selectedOptionIds = qOptions
                ? (answerLabels
                    .map((label) => qOptions.find((o) => o.label === label)?.id)
                    .filter(Boolean) as string[])
                : [];

              if (selectedOptionIds.length === 0 && qOptions && qOptions.length > 0) {
                const byId = qOptions.find((o) => answerLabels.includes(o.id));
                if (byId) selectedOptionIds.push(byId.id);
              }

              if (selectedOptionIds.length > 0) {
                server.respondToRequest(id, {
                  outcome: {
                    outcome: "answered",
                    answers: [{ questionId: qId, selectedOptionIds }],
                  },
                });
              } else {
                server.respondToRequest(id, {
                  outcome: { outcome: "skipped", reason: result.answer },
                });
              }
            } else {
              server.respondToRequest(id, { outcome: { outcome: "skipped" } });
            }
          } catch {
            server.respondToRequest(id, { outcome: { outcome: "cancelled" } });
          }
          break;
        }

        case "cursor/create_plan": {
          const planName = p?.name as string | undefined;
          const planOverview = p?.overview as string | undefined;
          const planMarkdown = p?.plan as string | undefined;
          const planTodos = p?.todos as
            | Array<{ id: string; content: string; status: string }>
            | undefined;
          const planPhases = p?.phases as
            | Array<{
                name: string;
                todos: Array<{ id: string; content: string; status: string }>;
              }>
            | undefined;
          const isProject = (p?.isProject as boolean) ?? false;

          const sections: string[] = [];
          if (planName) sections.push(`## ${planName}`);
          if (planOverview) sections.push(planOverview);
          if (planMarkdown) sections.push(planMarkdown);

          const statusIcon = (s: string) =>
            s === "completed"
              ? "✅"
              : s === "in_progress"
                ? "⏳"
                : s === "cancelled"
                  ? "❌"
                  : "⬜";

          if (planPhases && planPhases.length > 0) {
            for (const phase of planPhases) {
              sections.push(`\n### ${phase.name}`);
              for (const t of phase.todos) {
                sections.push(`${statusIcon(t.status)} ${t.content}`);
              }
            }
          } else if (planTodos && planTodos.length > 0) {
            sections.push("");
            for (const t of planTodos) {
              sections.push(`${statusIcon(t.status)} ${t.content}`);
            }
          }

          const content = sections.join("\n").trim();

          if (content) {
            const planToolCallId =
              (p?.toolCallId as string | undefined) ?? `cursor-plan-${Date.now()}`;
            const startedAt = Date.now();
            await onEvent({
              type: "tool_call",
              toolName: "Plan",
              input: { plan: content },
              startedAt,
              metadata: {
                phase: "start",
                toolCallId: planToolCallId,
                isProject,
                cursorExtension: "create_plan",
              },
            });
            await onEvent({
              type: "tool_call",
              toolName: "Plan",
              input: { plan: content },
              output: { planStatus: "pending" },
              startedAt,
              endedAt: Date.now(),
              metadata: {
                phase: "complete",
                toolCallId: planToolCallId,
                isProject,
                cursorExtension: "create_plan",
              },
            });
          }

          server.respondToRequest(id, { outcome: { outcome: "accepted" } });
          break;
        }

        default: {
          logWarn(`Unsupported ACP server request: ${method}`);
          server.respondToRequestError(id, -32601, `Unsupported: ${method}`);
          break;
        }
      }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Prompt building
  // ─────────────────────────────────────────────────────────────

  function buildStartPrompt(request: WorkRunRequest): string {
    // Cursor's ACP surface has no system-prompt slot, so the mode/space
    // instruction delta rides the first prompt; the session transcript
    // carries it for follow-up turns.
    const modePrefix = request.extraInstructions
      ? `<mode_instructions>\n${request.extraInstructions}\n</mode_instructions>\n\n`
      : "";
    const workspaceInfo = `${modePrefix}Working directory: ${request.execution.cwd}`;
    let prompt: string;

    if (request.context && request.context.length > 0) {
      const contextParts = formatContextSection(request.context);
      prompt = `${workspaceInfo}\n\nContext:\n${contextParts}\n\n---\n\n ${request.goal}`;
    } else {
      prompt = `${workspaceInfo}\n\n ${request.goal}`;
    }

    prompt = appendPromptSections(prompt, {
      contextIssues: request.contextIssues,
      contextSignals: request.contextSignals,
      contextFiles: request.contextFiles,
      runId: request.runId,
    });

    if (request.attachments && request.attachments.length > 0) {
      const { savedPaths, inlineTexts } = saveAttachments(request.attachments, request.runId);
      if (inlineTexts.length > 0) {
        prompt = `${prompt}\n\n---\n\nAttached documents:\n${inlineTexts.join("\n\n")}`;
      }
      if (savedPaths.length > 0) {
        prompt = `${prompt}\n\n---\n\nAttached files:\n${savedPaths.map((p) => `- ${p}`).join("\n")}`;
      }
    }

    return prompt;
  }

  function buildContinuePrompt(request: WorkRunContinueRequest): string {
    let prompt = request.message;
    prompt = appendPromptSections(prompt, {
      contextIssues: request.contextIssues,
      contextSignals: request.contextSignals,
      contextFiles: request.contextFiles,
      runId: request.runId,
    });

    if (request.attachments && request.attachments.length > 0) {
      const { savedPaths, inlineTexts } = saveAttachments(request.attachments, request.runId);
      if (inlineTexts.length > 0) {
        prompt = `${prompt}\n\n---\n\nAttached documents:\n${inlineTexts.join("\n\n")}`;
      }
      if (savedPaths.length > 0) {
        prompt = `${prompt}\n\n---\n\nAttached files:\n${savedPaths.map((p) => `- ${p}`).join("\n")}`;
      }
    }

    return prompt;
  }

  /**
   * Reconstruct a compact transcript of a source run from mains' stored data —
   * the original goal plus the assistant's persisted messages. Used to seed a
   * forked session, since cursor-agent has no native server-side fork.
   */
  async function buildSourceTranscript(sourceRunId: string): Promise<string | null> {
    try {
      const [run, artifacts] = await Promise.all([
        runsRepo.findRunById(sourceRunId),
        runsRepo.findArtifactsByRun(sourceRunId),
      ]);
      const parts: string[] = [];
      if (run?.goal?.trim()) parts.push(`## Original task\n${run.goal.trim()}`);

      const assistantMessages = artifacts
        .filter(
          (a) =>
            a.kind === "report" &&
            (a.metadata as { source?: string } | null)?.source === "agent_message" &&
            a.content?.trim(),
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((a) => (a.content ?? "").trim());

      if (assistantMessages.length > 0) {
        let joined = assistantMessages.join("\n\n");
        const MAX = 6000;
        if (joined.length > MAX) {
          joined = `…(earlier output truncated)…\n\n${joined.slice(-MAX)}`;
        }
        parts.push(`## Previous assistant work\n${joined}`);
      }
      return parts.length > 0 ? parts.join("\n\n") : null;
    } catch {
      return null;
    }
  }

  async function buildForkPrompt(request: WorkRunForkRequest): Promise<string> {
    // A fork is a fresh Cursor session, so the mode/space delta must ride this
    // prompt too — the replayed transcript alone doesn't carry it.
    const modePrefix = request.extraInstructions
      ? `<mode_instructions>\n${request.extraInstructions}\n</mode_instructions>\n\n`
      : "";
    const transcript = await buildSourceTranscript(request.sourceRunId);
    const preamble = modePrefix + (transcript
      ? "This run was forked from a previous Cursor conversation. Cursor has no native " +
        "session fork, so the prior context is replayed below for continuity.\n\n" +
        `${transcript}\n\n---\n\n`
      : "");

    let body = request.message;
    if (request.context && request.context.length > 0) {
      body = `Context:\n${formatContextSection(request.context)}\n\n---\n\n${request.message}`;
    }

    let prompt = `${preamble}${body}`;
    if (request.attachments && request.attachments.length > 0) {
      const { savedPaths, inlineTexts } = saveAttachments(request.attachments, request.runId);
      if (inlineTexts.length > 0) {
        prompt = `${prompt}\n\n---\n\nAttached documents:\n${inlineTexts.join("\n\n")}`;
      }
      if (savedPaths.length > 0) {
        prompt = `${prompt}\n\n---\n\nAttached files:\n${savedPaths.map((p) => `- ${p}`).join("\n")}`;
      }
    }
    return prompt;
  }

  // ─────────────────────────────────────────────────────────────
  // Acquire a session — shared by createSession + resumeSession
  // ─────────────────────────────────────────────────────────────

  async function setConfigOption(
    server: CursorAcpServer,
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<CursorConfigOption[] | undefined> {
    const res = (await server.sendRequest("session/set_config_option", {
      sessionId,
      configId,
      value,
    })) as Record<string, unknown> | undefined;
    const updated = res?.configOptions as CursorConfigOption[] | undefined;
    return Array.isArray(updated) && updated.length > 0 ? updated : undefined;
  }

  async function configureSession(
    server: CursorAcpServer,
    sessionId: string,
    model: string | undefined,
    mode: string | undefined,
    sessionConfigOptions: CursorConfigOption[] | undefined,
    selection: CursorSelection,
  ): Promise<void> {
    // configOptions reflect the *active* model. Setting the model returns the
    // freshly-parameterized set, which we then mine for the effort/fast options.
    let configOptions = sessionConfigOptions ?? [];
    const spec = splitCursorModelSpec(model);

    if (spec.baseId) {
      try {
        const modelOption = findCursorModelOption(configOptions);
        const updated = await setConfigOption(
          server,
          sessionId,
          modelOption?.id ?? "model",
          spec.baseId,
        );
        if (updated) configOptions = updated;
      } catch {
        logWarn(`Failed to set model to ${spec.baseId}, using default`);
      }
    }

    // Reasoning / effort
    const effort = normalizeCursorReasoning(selection.effort);
    if (effort) {
      const opt = findCursorEffortOption(configOptions);
      const value = opt ? resolveCursorEffortValue(opt, effort) : undefined;
      if (opt && value !== undefined) {
        try {
          await setConfigOption(server, sessionId, opt.id, value);
        } catch {
          logWarn(`Failed to set reasoning effort to ${effort}`);
        }
      }
    }

    // Fast mode — explicit selection wins; otherwise honor a `[fast=…]` suffix
    // encoded in the model spec (e.g. the catalog default `composer-2.5[fast=true]`).
    const fastMode = typeof selection.fastMode === "boolean" ? selection.fastMode : spec.fast;
    if (typeof fastMode === "boolean") {
      const opt = findCursorFastOption(configOptions);
      const value = opt ? resolveCursorBooleanValue(opt, fastMode) : undefined;
      if (opt && value !== undefined) {
        try {
          await setConfigOption(server, sessionId, opt.id, value);
        } catch {
          logWarn("Failed to set fast mode");
        }
      }
    }

    // Thinking
    if (typeof selection.thinking === "boolean") {
      const opt = findCursorThinkingOption(configOptions);
      const value = opt ? resolveCursorBooleanValue(opt, selection.thinking) : undefined;
      if (opt && value !== undefined) {
        try {
          await setConfigOption(server, sessionId, opt.id, value);
        } catch {
          logWarn("Failed to set thinking");
        }
      }
    }

    if (mode) {
      try {
        await applyCursorSessionMode(server, sessionId, mode);
      } catch {
        logWarn(`Failed to set mode to ${mode}`);
      }
    }
  }

  /**
   * Run `agent about`, preferring `--format json` and falling back to plain
   * text when an older CLI doesn't recognize the flag/subcommand.
   */
  async function runAgentAbout(): Promise<{ stdout: string; stderr: string }> {
    const binaryPath = findCursorBinary();
    const env: Record<string, string | undefined> = {
      ...process.env,
      HOME: os.homedir(),
      PATH: [
        path.dirname(binaryPath),
        path.join(os.homedir(), ".local", "bin"),
        "/usr/local/bin",
        "/opt/homebrew/bin",
        process.env.PATH || "",
      ].join(":"),
    };
    if (config.apiKey) env.CURSOR_API_KEY = config.apiKey;

    const run = (args: string[]) =>
      new Promise<{ stdout: string; stderr: string }>((resolve) => {
        const child = spawn(binaryPath, args, {
          env,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 8000,
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
        child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
        child.on("close", () => resolve({ stdout, stderr }));
        child.on("error", (err) => resolve({ stdout, stderr: String(err) }));
      });

    const json = await run(["about", "--format", "json"]);
    if (parseCursorAbout(json.stdout, json.stderr).commandUnsupported) {
      return run(["about"]);
    }
    return json;
  }

  // ─────────────────────────────────────────────────────────────
  // ProviderDriver implementation
  // ─────────────────────────────────────────────────────────────

  return {
    async createSession(request: WorkRunRequest): Promise<AcquiredSession> {
      const { runId } = request;
      const resolvedModel = request.model || config.defaultModel || undefined;
      const overrides = (request.configSnapshot ?? {}) as Record<string, unknown>;
      const overrideMode = overrides.mode;
      const effectiveMode =
        (typeof overrideMode === "string" && overrideMode) || config.mode;
      const selection = resolveCursorSelection(overrides, config);

      const mainsCtx: MainsToolContext = {
        workspaceId: request.execution.workspaceId,
        rootPath: request.execution.cwd,
        runId,
      };
      const mainsMcp = await ensureMcpServer(mainsCtx, request.mode);
      const server = await ensureServer();

      logInfo(
        `Creating session (model: ${resolvedModel || "default"}, cwd: ${request.execution.cwd})`,
      );
      const sessionResult = (await server.sendRequest("session/new", {
        cwd: request.execution.cwd,
        mcpServers: mainsMcp ? [mainsMcp.mcpConfig] : [],
      })) as Record<string, unknown>;
      const sessionId = sessionResult?.sessionId as string | undefined;

      if (!sessionId) {
        throw new Error("Cursor did not return a sessionId from session/new");
      }
      sessionIdMap.set(runId, sessionId);

      const sessionConfigOptions = sessionResult?.configOptions as
        | CursorConfigOption[]
        | undefined;
      await configureSession(
        server,
        sessionId,
        resolvedModel,
        effectiveMode,
        sessionConfigOptions,
        selection,
      );

      const session: CursorSession = {
        runId,
        sessionId,
        agentMessageBuffer: "",
        agentThoughtBuffer: "",
        toolCallCache: new Map(),
        skippedToolCallIds: new Set(),
      };

      return {
        session,
        prompt: buildStartPrompt(request),
        sessionId,
      };
    },

    async resumeSession(request: WorkRunContinueRequest): Promise<AcquiredSession> {
      const { runId } = request;
      const resolvedModel = request.model || config.defaultModel || undefined;

      const mainsCtx: MainsToolContext = {
        workspaceId: request.execution.workspaceId,
        rootPath: request.execution.cwd,
        runId,
      };
      const mainsMcp = await ensureMcpServer(mainsCtx, request.mode);
      const mcpServersConfig = mainsMcp ? [mainsMcp.mcpConfig] : [];
      const server = await ensureServer();

      let sessionId = sessionIdMap.get(runId);
      if (!sessionId) {
        const run = await runsRepo.findRunById(runId);
        if (run?.sessionId) {
          sessionId = run.sessionId;
          sessionIdMap.set(runId, sessionId);
        }
      }
      if (!sessionId) {
        throw new Error(`No session found for run ${runId}. Cannot resume.`);
      }

      let loadResult: Record<string, unknown> | undefined;
      try {
        loadResult = (await server.sendRequest(
          "session/load",
          {
            sessionId,
            cwd: request.execution.cwd,
            mcpServers: mcpServersConfig,
          },
          30000,
        )) as Record<string, unknown>;
      } catch (loadErr) {
        const errMsg = loadErr instanceof Error ? loadErr.message : String(loadErr);
        if (/not found|unknown|does not exist/i.test(errMsg)) {
          logWarn(`Session load failed (${errMsg}), creating new session`);
          const newResult = (await server.sendRequest("session/new", {
            cwd: request.execution.cwd,
            mcpServers: mcpServersConfig,
          })) as Record<string, unknown>;
          loadResult = newResult;
          const newId = newResult?.sessionId as string | undefined;
          if (newId) {
            sessionId = newId;
            sessionIdMap.set(runId, newId);
          }
        } else {
          throw loadErr;
        }
      }

      // Same precedence as createSession: the run's config snapshot beats the
      // provider config, so a resumed chat run stays in "ask" mode.
      const resumeOverrides = (request.configSnapshot ?? {}) as Record<string, unknown>;
      const resumeMode =
        (typeof resumeOverrides.mode === "string" && resumeOverrides.mode) || config.mode;
      const sessionConfigOptions = loadResult?.configOptions as
        | CursorConfigOption[]
        | undefined;
      await configureSession(
        server,
        sessionId,
        resolvedModel,
        resumeMode,
        sessionConfigOptions,
        resolveCursorSelection(resumeOverrides, config),
      );

      const session: CursorSession = {
        runId,
        sessionId,
        agentMessageBuffer: "",
        agentThoughtBuffer: "",
        toolCallCache: new Map(),
        skippedToolCallIds: new Set(),
      };

      return {
        session,
        prompt: buildContinuePrompt(request),
        sessionId,
      };
    },

    async forkSession(request: WorkRunForkRequest): Promise<AcquiredSession> {
      const { runId, sourceRunId } = request;
      const resolvedModel = request.model || config.defaultModel || undefined;

      // Cursor ACP has no native fork (`session/fork` is unsupported), so we
      // create a fresh session and seed it with the source run's transcript.
      // The original session is never touched — no cross-run contamination.
      logInfo(
        `Forking run ${sourceRunId} → ${runId} (seeded new session; cursor has no native fork)`,
      );

      const mainsCtx: MainsToolContext = {
        workspaceId: request.execution.workspaceId,
        rootPath: request.execution.cwd,
        runId,
      };
      const mainsMcp = await ensureMcpServer(mainsCtx, request.mode);
      const server = await ensureServer();

      const sessionResult = (await server.sendRequest("session/new", {
        cwd: request.execution.cwd,
        mcpServers: mainsMcp ? [mainsMcp.mcpConfig] : [],
      })) as Record<string, unknown>;
      const sessionId = sessionResult?.sessionId as string | undefined;
      if (!sessionId) {
        throw new Error("Cursor did not return a sessionId from session/new");
      }
      sessionIdMap.set(runId, sessionId);

      // The fork inherits the source run's harness snapshot.
      const forkOverrides = (request.configSnapshot ?? {}) as Record<string, unknown>;
      const forkMode =
        (typeof forkOverrides.mode === "string" && forkOverrides.mode) || config.mode;
      const sessionConfigOptions = sessionResult?.configOptions as
        | CursorConfigOption[]
        | undefined;
      await configureSession(
        server,
        sessionId,
        resolvedModel,
        forkMode,
        sessionConfigOptions,
        resolveCursorSelection(forkOverrides, config),
      );

      const session: CursorSession = {
        runId,
        sessionId,
        agentMessageBuffer: "",
        agentThoughtBuffer: "",
        toolCallCache: new Map(),
        skippedToolCallIds: new Set(),
      };

      return {
        session,
        prompt: await buildForkPrompt(request),
        sessionId,
      };
    },

    async executePrompt(
      session,
      prompt,
      onEvent,
      signal,
    ): Promise<DriverOutcome> {
      const cs = session as CursorSession;
      const timeout = config.timeout ?? 3_600_000;

      const server = acpServer;
      if (!server || !server.isRunning) {
        return { status: "failed", summary: "ACP server not running" };
      }

      // Wire abort: when signal fires, send session/cancel notification
      const onAbort = () => {
        if (server.isRunning) {
          try {
            server.sendNotification("session/cancel", { sessionId: cs.sessionId });
          } catch (err) {
            logError("Failed to cancel session:", err);
          }
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });

      // Wire streaming notification + server-request handlers
      server.setNotificationHandler((method, params) => {
        const events = mapNotification(method, params, cs);
        for (const event of events) {
          // Best-effort: events emitted from notifications are async-fired; await would
          // require restructuring drainJsonBuffer. Track promise chain rejections.
          void Promise.resolve(onEvent(event)).catch((err) =>
            logError("onEvent threw:", err),
          );
        }
      });
      server.setServerRequestHandler(buildServerRequestHandler(server, cs, onEvent));

      // Wire MCP bridge events
      mcpServer?.setEventHandler(onEvent);

      try {
        const promptResult = (await server.sendRequest(
          "session/prompt",
          {
            sessionId: cs.sessionId,
            prompt: [{ type: "text", text: prompt }],
          },
          timeout,
        )) as Record<string, unknown>;

        const stopReason = promptResult?.stopReason as string | undefined;

        // Flush remaining agent message buffer
        if (cs.agentMessageBuffer.trim()) {
          await onEvent({
            type: "artifact",
            kind: "report",
            content: cs.agentMessageBuffer.trim(),
            metadata: { source: "agent_message" },
          });
          cs.agentMessageBuffer = "";
        }
        cs.agentThoughtBuffer = "";
        await onEvent({
          type: "artifact",
          kind: "report",
          content: "",
          metadata: { source: "agent_thought_streaming" },
          ephemeral: true,
          streamId: `cursor-think-${cs.runId}`,
        });

        const { status, summary } = mapStopReasonToOutcome(stopReason);
        return { status, summary, stopReason };
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    },

    async cleanup(_session): Promise<void> {
      // Per-run state lives on the Session object Core is about to drop.
      // Long-lived sessionIdMap memos survive (deleteSession clears them explicitly).
    },

    async canResumeSession(runId: string): Promise<boolean> {
      if (sessionIdMap.has(runId)) return true;
      const run = await runsRepo.findRunById(runId);
      if (run?.sessionId) {
        sessionIdMap.set(runId, run.sessionId);
        return true;
      }
      return false;
    },

    async deleteSession(runId: string): Promise<void> {
      sessionIdMap.delete(runId);
    },

    // Same reason as Codex: this driver owns a long-lived ACP server process,
    // so config changes refresh the instance instead of replacing it.
    updateConfig(next) {
      adoptConfig(config, next as CursorAdapterConfig);
    },

    async shutdown(): Promise<void> {
      sessionIdMap.clear();

      if (mcpServer) {
        await mcpServer.stop().catch(() => {});
        mcpServer = null;
      }

      if (acpServer) {
        await acpServer.stop();
        acpServer = null;
      }

      logInfo("Shutdown complete");
    },

    async listModels(): Promise<ModelInfo[]> {
      try {
        loadCapsCache();
        const server = await ensureServer();
        const result = (await server.sendRequest("session/new", {
          cwd: os.homedir(),
          mcpServers: [],
        })) as Record<string, unknown>;

        const configOptions = result?.configOptions as CursorConfigOption[] | undefined;
        const modelOption = configOptions ? findCursorModelOption(configOptions) : undefined;
        const modelConfigId = modelOption?.id ?? "model";

        // Model choices: prefer the parameterized model option; fall back to the
        // legacy flat `models.availableModels` list (older CLI / untrusted cwd).
        let choices = flattenCursorSelectOptions(modelOption);
        const modelsObj = result?.models as Record<string, unknown> | undefined;
        const legacyModels = modelsObj?.availableModels as
          | Array<Record<string, unknown>>
          | undefined;
        if (choices.length === 0 && Array.isArray(legacyModels)) {
          choices = legacyModels
            .map((m) => ({
              value: String(m.modelId ?? m.id ?? ""),
              name: String(m.name ?? m.modelId ?? ""),
            }))
            .filter((c) => c.value);
        }
        if (choices.length === 0) return [];

        const currentModelId =
          (typeof modelOption?.currentValue === "string"
            ? modelOption.currentValue.trim()
            : undefined) ?? (modelsObj?.currentModelId as string | undefined);

        // The current model's options are already in this response — cache for free.
        if (currentModelId && configOptions) {
          modelCapsCache.set(currentModelId, extractCursorModelCaps(configOptions));
        }

        const seen = new Set<string>();
        const deduped: Array<{ id: string; name: string }> = [];
        for (const c of choices) {
          const id = c.value.trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          deduped.push({ id, name: c.name });
        }

        // Match the catalog default against the *base* id (defaults may carry a
        // `[fast=true]` suffix the advertised model values don't have).
        //
        // Cursor advertises its plan-agnostic auto-routing model under the id
        // `default` (display name "Auto") — not `auto`, which is only the CLI
        // *flag* spelling.
        //
        // `currentModelId` is deliberately NOT a fallback here. The CLI persists
        // it globally, and `enrichModelCaps` rewrites it once per model as it
        // probes capabilities, so it settles on whichever id happened to be
        // probed last — it surfaced in the picker as a random model. The
        // catalog's first entry is a real preference-order signal; that value
        // is not.
        const defaultBase = resolveCatalogDefaultId(
          deduped.map((c) => c.id),
          config.defaultModel
            ? splitCursorModelSpec(config.defaultModel).baseId
            : undefined,
          ["default", "auto"],
        );

        const models = deduped.map((c) =>
          buildCursorModelInfo(c.id, c.name, c.id === defaultBase, modelCapsCache.get(c.id)),
        );

        // Discover the remaining models' capabilities in the background (isolated
        // process). On completion it persists the cache and emits `modelsUpdated`,
        // prompting the renderer to refetch with full effort/fast metadata.
        const missing = deduped.map((c) => c.id).filter((id) => !modelCapsCache.has(id));
        if (missing.length > 0) {
          void enrichModelCaps(modelConfigId, missing);
        }

        return models;
      } catch (error) {
        logError("Failed to list models:", error);
        const msg = error instanceof Error ? error.message : String(error);
        if (/auth|login|unauthorized|token/i.test(msg)) {
          throw new Error('Not authenticated. Run "agent login" to sign in.');
        }
        return [];
      }
    },

    async listCommands(workspacePath?: string): Promise<CommandInfo[]> {
      const cwd = workspacePath || os.homedir();
      const cached = commandCacheByCwd.get(cwd);
      if (cached) return cached;

      // Cursor streams commands via the `available_commands_update` notification
      // shortly after `session/new`. Probe on a dedicated, throwaway process so
      // we don't disturb the shared run server's notification routing.
      let probe: CursorAcpServer | null = null;
      try {
        probe = await startInitializedServer();
        const p = probe;
        const commands = await new Promise<CommandInfo[]>((resolve) => {
          let settled = false;
          const finish = (cmds: CommandInfo[]) => {
            if (settled) return;
            settled = true;
            resolve(cmds);
          };
          const timer = setTimeout(() => finish([]), 6000);
          p.setNotificationHandler((method, params) => {
            if (method !== "session/update") return;
            const update = (params as Record<string, unknown>)?.update as
              | Record<string, unknown>
              | undefined;
            if (update?.sessionUpdate === "available_commands_update") {
              clearTimeout(timer);
              finish(parseCursorCommands(update.availableCommands));
            }
          });
          p.sendRequest("session/new", { cwd, mcpServers: [] }).catch(() => {
            clearTimeout(timer);
            finish([]);
          });
        });
        if (commands.length > 0) commandCacheByCwd.set(cwd, commands);
        return commands;
      } catch (error) {
        logWarn(
          `listCommands failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      } finally {
        if (probe) {
          try {
            await probe.stop();
          } catch {
            /* ignore */
          }
        }
      }
    },

    async getAccountInfo(): Promise<AccountInfo> {
      try {
        const { stdout, stderr } = await runAgentAbout();
        const info = parseCursorAbout(stdout, stderr);
        const cli = {
          version: info.version,
          channel: readCursorCliChannel(),
          // Only flag genuinely-old CLIs (where `agent about` itself is
          // unsupported); recent CLIs run the parameterized picker without `lab`.
          outdated: info.commandUnsupported,
        };
        if (info.authenticated && info.email) {
          return {
            account: {
              type: "cursor",
              email: info.email,
              planType: info.subscriptionTier ?? "",
            },
            requiresOpenaiAuth: false,
            cli,
          };
        }
        return { account: null, requiresOpenaiAuth: false, cli };
      } catch (error) {
        logWarn(
          `getAccountInfo failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return { account: null, requiresOpenaiAuth: false };
    },

    async updateCli(): Promise<CliUpdateResult> {
      const binaryPath = findCursorBinary();
      const env: Record<string, string | undefined> = {
        ...process.env,
        HOME: os.homedir(),
        PATH: [
          path.dirname(binaryPath),
          path.join(os.homedir(), ".local", "bin"),
          "/usr/local/bin",
          "/opt/homebrew/bin",
          process.env.PATH || "",
        ].join(":"),
      };

      return new Promise<CliUpdateResult>((resolve) => {
        const child = spawn(binaryPath, ["update"], {
          env,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 120000,
        });
        let out = "";
        child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
        child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
        child.on("close", (code) => resolve({ success: code === 0, output: out.trim() }));
        child.on("error", (err) =>
          resolve({ success: false, output: String(err instanceof Error ? err.message : err) }),
        );
      });
    },

    async generateTitle(goal: string, context?: WorkRunContextItem[]): Promise<string> {
      try {
        const binaryPath = findCursorBinary();

        let contextSnippet = "";
        if (context && context.length > 0) {
          contextSnippet = context
            .map((ctx) => {
              const header = ctx.ref ? `[${ctx.kind}: ${ctx.ref}]` : `[${ctx.kind}]`;
              return `${header} ${(ctx.content || "").substring(0, 200)}`;
            })
            .join("\n")
            .substring(0, 500);
        }

        const titlePrompt = [
          "Generate a concise title (2-5 words) for this task.",
          "Use title case: capitalize the first letter of each word.",
          "Reply with ONLY the title text, nothing else.",
          "No quotes, no punctuation, no prefixes.",
          "",
          `User message: ${goal}`,
          contextSnippet ? `\nContext:\n${contextSnippet}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        const spawnTitleOnce = () =>
          new Promise<string>((resolve, reject) => {
            const env: Record<string, string | undefined> = {
              ...process.env,
              HOME: os.homedir(),
              PATH: [
                path.dirname(binaryPath),
                path.join(os.homedir(), ".local", "bin"),
                "/usr/local/bin",
                "/opt/homebrew/bin",
                process.env.PATH || "",
              ].join(":"),
            };
            if (config.apiKey) env.CURSOR_API_KEY = config.apiKey;

            const child = spawn(
              binaryPath,
              [
                "--print",
                "--mode",
                "ask",
                "--trust",
                "--output-format",
                "text",
                // Without --model the CLI uses the persisted user config, which
                // may name a model the account's plan can't access (free plans
                // are auto-only). Auto is available on every plan.
                "--model",
                "auto",
                titlePrompt,
              ],
              // 30s: the CLI's "Connection lost, reconnecting..." cycle needs
              // more than one 15s window to recover.
              { env, stdio: ["ignore", "pipe", "pipe"], timeout: 30000 },
            );

            let stdout = "";
            let stderr = "";
            child.stdout?.on("data", (d: Buffer) => {
              stdout += d.toString();
            });
            child.stderr?.on("data", (d: Buffer) => {
              stderr += d.toString();
            });
            child.on("close", (code) => {
              if (code === 0 && stdout.trim()) {
                resolve(stdout.trim());
              } else {
                reject(new Error(stderr.trim() || `Exit code ${code}`));
              }
            });
            child.on("error", reject);
          });

        let titleText: string;
        try {
          titleText = await spawnTitleOnce();
        } catch {
          // Transient backend disconnects are common on cold spawns; a fresh
          // process usually succeeds. Title updates are fire-and-forget, so
          // the extra attempt doesn't delay the run.
          titleText = await spawnTitleOnce();
        }

        const title = titleText
          .split("\n")[0]
          .trim()
          .replace(/^(title:\s*)/i, "")
          .replace(/^["'`]|["'`]$/g, "")
          .replace(/[.!?]$/, "")
          .trim();

        if (!title) throw new Error("Empty title generated");

        return title.slice(0, 50);
      } catch (err) {
        logWarn("Title generation failed, using fallback:", err);
        return goal.slice(0, 50);
      }
    },

    async generateText(
      prompt: string,
      opts?: { system?: string; model?: string },
    ): Promise<string> {
      const binaryPath = findCursorBinary();
      const fullPrompt = opts?.system ? `${opts.system}\n\n${prompt}` : prompt;

      return await new Promise<string>((resolve, reject) => {
        const env: Record<string, string | undefined> = {
          ...process.env,
          HOME: os.homedir(),
          PATH: [
            path.dirname(binaryPath),
            path.join(os.homedir(), ".local", "bin"),
            "/usr/local/bin",
            "/opt/homebrew/bin",
            process.env.PATH || "",
          ].join(":"),
        };
        if (config.apiKey) env.CURSOR_API_KEY = config.apiKey;

        const cursorArgs = [
          "--print",
          "--mode",
          "ask",
          "--trust",
          "--output-format",
          "text",
          // Same reasoning as generateTitle: default to auto rather than the
          // persisted CLI model, which may be plan-restricted.
          "--model",
          opts?.model ?? "auto",
          fullPrompt,
        ];

        const child = spawn(binaryPath, cursorArgs, {
          env,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30000,
        });

        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (d: Buffer) => {
          stdout += d.toString();
        });
        child.stderr?.on("data", (d: Buffer) => {
          stderr += d.toString();
        });
        child.on("close", (code) => {
          if (code === 0 && stdout.trim()) {
            resolve(stdout.trim());
          } else {
            reject(new Error(stderr.trim() || `Exit code ${code}`));
          }
        });
        child.on("error", reject);
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Pure helpers exported for testing
// ─────────────────────────────────────────────────────────────

/**
 * Map cursor's `available_commands_update` payload (`[{name, description}]`)
 * to canonical `CommandInfo[]`, deduped by name.
 */
export function parseCursorCommands(raw: unknown): CommandInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: CommandInfo[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const name =
      typeof (entry as { name?: unknown }).name === "string"
        ? (entry as { name: string }).name.trim()
        : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const rawDesc = (entry as { description?: unknown }).description;
    out.push({
      name,
      description: typeof rawDesc === "string" ? rawDesc.trim() || undefined : undefined,
      userFacing: true,
    });
  }
  return out;
}

/** Map cursor's stopReason taxonomy to a DriverOutcome. */
export function mapStopReasonToOutcome(stopReason: string | undefined): {
  status: DriverOutcome["status"];
  summary?: string;
} {
  if (stopReason === "cancelled") return { status: "canceled" };
  if (stopReason === "refusal")
    return { status: "failed", summary: "Agent refused the request" };
  if (stopReason === "max_tokens")
    return { status: "succeeded", summary: "Response truncated (max tokens)" };
  return { status: "succeeded" };
}

// ─────────────────────────────────────────────────────────────
// `agent about` parsing — auth / account / version probing
//
// `agent about [--format json]` reports the installed CLI version plus the
// logged-in account (email + subscription tier). We use it for real auth
// detection (vs. regex-on-error) and to surface account info in Settings.
// Mirrors t3code's parseCursorAboutOutput (CursorProvider.ts).
// ─────────────────────────────────────────────────────────────

/** Parsed view of `agent about` output. `email` is null unless truly signed in. */
export interface CursorAboutInfo {
  version: string | null;
  email: string | null;
  subscriptionTier: string | null;
  authenticated: boolean;
  /** The CLI is too old to support `about` / `--format json`. */
  commandUnsupported: boolean;
}

const CURSOR_NOT_LOGGED_IN_RE = /^not logged in$|login required|authentication required/i;

function stripCursorAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?\x07/g, "");
}

/** Pull a value from `agent about` plain-text output: `CLI Version   2026.05.09`. */
function extractCursorAboutField(plain: string, key: string): string | undefined {
  return new RegExp(`^${key}\\s{2,}(.+)$`, "mi").exec(plain)?.[1]?.trim();
}

function normalizeCursorEmail(raw: string | undefined): string | null {
  const email = (raw ?? "").trim();
  return email && !CURSOR_NOT_LOGGED_IN_RE.test(email) ? email : null;
}

/** Best-effort read of the `channel` field from `~/.cursor/cli-config.json` (or null). */
function readCursorCliChannel(): string | null {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), ".cursor", "cli-config.json"), "utf8");
    const json = JSON.parse(raw) as { channel?: unknown };
    return typeof json.channel === "string" && json.channel.trim() ? json.channel.trim() : null;
  } catch {
    return null;
  }
}

/** Parse `agent about` output (JSON form preferred, plain-text key/value fallback). */
export function parseCursorAbout(stdout: string, stderr = ""): CursorAboutInfo {
  const trimmed = (stdout ?? "").trim();

  // Preferred: `--format json`
  if (trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed) as Record<string, unknown>;
      const version = typeof j.cliVersion === "string" ? j.cliVersion.trim() : null;
      const tier =
        typeof j.subscriptionTier === "string" ? j.subscriptionTier.trim() || null : null;
      const email = normalizeCursorEmail(
        typeof j.userEmail === "string" ? j.userEmail : undefined,
      );
      return {
        version,
        subscriptionTier: tier,
        email,
        authenticated: !!email,
        commandUnsupported: false,
      };
    } catch {
      /* fall through to text parsing */
    }
  }

  const combined = `${stdout ?? ""}\n${stderr ?? ""}`;
  const lower = combined.toLowerCase();
  if (
    lower.includes("unknown command") ||
    lower.includes("unrecognized command") ||
    lower.includes("unexpected argument") ||
    lower.includes("unknown option '--format'") ||
    lower.includes("unrecognized option '--format'")
  ) {
    return {
      version: null,
      email: null,
      subscriptionTier: null,
      authenticated: false,
      commandUnsupported: true,
    };
  }

  const plain = stripCursorAnsi(combined);
  const version = extractCursorAboutField(plain, "CLI Version") ?? null;
  const tier = extractCursorAboutField(plain, "Subscription Tier") ?? null;
  const email = normalizeCursorEmail(extractCursorAboutField(plain, "User Email"));
  return {
    version,
    subscriptionTier: tier,
    email,
    authenticated: !!email,
    commandUnsupported: false,
  };
}
