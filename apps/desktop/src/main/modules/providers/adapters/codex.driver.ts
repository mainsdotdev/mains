// ─────────────────────────────────────────────────────────────
// OpenAI Codex ProviderDriver
//
// SDK-specific seam for `codex app-server` (JSON-RPC over stdio). Wrapped by
// `createWorkRunAdapter()` in work-run-core.ts to expose the WorkRunAdapter
// interface.
//
// Codex is the only driver that exercises all four acquisition verbs
// (createSession + resumeSession + forkSession + reviewSession). Each acquires
// a thread via `thread/start|resume|fork`; `executePrompt` then sends the
// turn (`turn/start` for chat, `review/start` for review) and awaits
// completion through the Codex run coordinator.
//
// Per-run state (streaming buffers, fileChange tracking, sub-agent metadata)
// stays inside the per-driver Codex run coordinator keyed by runId.
// CodexRunSession is
// a thin wrapper carrying runId + a `startTurn` callback that fires the
// right `turn/start` or `review/start` request.
// ─────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { findCodexBinaryPath } from "../providers.utils";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";
import { emit } from "../../../ipc-kit";
import { PROVIDER_IDS } from "../../../../shared/provider-ids";
import type {
  CliUpdateResult,
  AccountInfo,
  CodexAdapterConfig,
  DriverOutcome,
  GoalInfo,
  GoalSetParams,
  ProviderDriver,
  RateLimitInfo,
  WorkRunContextItem,
} from "../../../../shared/adapter.types";
import { runsRepo } from "../../runs/runs.repo";
import { logWorkspaceActivity } from "../../workspace";
// Direct repo import — a known driver egress-seam leak (see CONTEXT.md
// "Repos are module-internal"); goes away when review persistence routes
// through the SaveReview/SaveFinding tools.
import { workspaceRepo } from "../../workspace/workspace.repo";
import { adoptConfig, createLogger, resolveCatalogDefaultId } from "./adapter.shared";
import type { CodexAppServerParams } from "./codex-app-server-protocol/rpc";
import { CodexAppServer } from "./codex-app-server.client";
import {
  createCodexCapabilities,
  mapRateLimitSnapshot,
} from "./codex-capabilities";
import {
  createCodexRunCoordinator,
  type CodexRunSession,
} from "./codex-run-coordinator";
import {
  createCodexSessionAcquisition,
  isCodexUnavailableThreadError,
} from "./codex-session-acquisition";
import type { CodexSubAgentRunMeta } from "./codex-event-mapper";

export {
  CODEX_ARCHIVED_CHAT_MESSAGE,
  buildCodexReviewTarget,
  buildCollaborationMode,
  buildDeveloperInstructionsParam,
  isCodexArchivedThreadError,
  isCodexUnavailableThreadError,
  mapSandboxMode,
  normalizeCodexResumeError,
} from "./codex-session-acquisition";

/** App-server schema version this driver is developed and tested against. */
/** TODO: Move from here */
export const CODEX_APP_SERVER_PROTOCOL_VERSION = "0.153.4";
/** Oldest CLI whose app-server contract Mains accepts. */
export const CODEX_MIN_CLI_VERSION = "0.147.0";

function compareCodexVersions(left: string, right: string): number | null {
  const parse = (value: string): [number, number, number] | null => {
    const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
    return match
      ? [Number(match[1]), Number(match[2]), Number(match[3])]
      : null;
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────
// Thread item types (mirroring SDK types for event mapping)
// ─────────────────────────────────────────────────────────────

type CodexGoalStatus = NonNullable<
  CodexAppServerParams<"thread/goal/set">["status"]
>;

// ─────────────────────────────────────────────────────────────
// Codex review text parser
// ─────────────────────────────────────────────────────────────

interface ParsedReviewFinding {
  severity: "critical" | "warning" | "info";
  title: string;
  file: string;
  lineStart?: number;
  lineEnd?: number;
  message: string;
  reason: string;
}

const PRIORITY_MAP: Record<string, "critical" | "warning" | "info"> = {
  P1: "critical",
  P2: "warning",
  P3: "info",
};

/**
 * Parse Codex review/start output into structured findings.
 *
 * Format:
 *   - [P1] Title — /path/to/file.ts:50-51
 *     Description text spanning one or more lines...
 */
export function parseCodexReviewFindings(reviewText: string): ParsedReviewFinding[] {
  try {
    if (!reviewText || typeof reviewText !== "string") return [];

    const findings: ParsedReviewFinding[] = [];

    // Split on finding headers: "- [P1]", "- [P2]", "- [P3]"
    const blocks = reviewText.split(/\n(?=- \[P[123]\] )/);

    for (const block of blocks) {
      try {
        // Match: - [P1] Title — file/path:lineStart-lineEnd
        const headerMatch = block.match(
          /^- \[(P[123])]\s+(.+?)\s+[—-]+\s+(.+?)(?::(\d+)(?:-(\d+))?)?\s*\n([\s\S]*)/,
        );
        if (!headerMatch) continue;

        const [, priority, title, filePath, lineStartStr, lineEndStr, body] = headerMatch;
        if (!title || !filePath) continue;

        const severity = PRIORITY_MAP[priority] ?? "info";
        const description = (body ?? "").replace(/^ {2}/gm, "").trim();

        findings.push({
          severity,
          title: title.trim(),
          file: filePath.trim(),
          lineStart: lineStartStr ? parseInt(lineStartStr, 10) : undefined,
          lineEnd: lineEndStr ? parseInt(lineEndStr, 10) : undefined,
          message: title.trim(),
          reason: description || title.trim(),
        });
      } catch {
        // Skip malformed finding block
      }
    }

    return findings;
  } catch {
    // If parsing fails entirely, return empty — review text still shows as report artifact
    return [];
  }
}

// Track saved review item IDs to prevent duplicate persistence
const savedReviewItems = new Set<string>();

const codexLogger = createLogger("[CodexDriver]");
const { info: logInfo, error: logError, warn: logWarn } = codexLogger;

function persistCodexReviewFindings(
  runId: string,
  itemId: string,
  reviewText: string,
): void {
  if (savedReviewItems.has(itemId)) return;
  savedReviewItems.add(itemId);
  const findings = parseCodexReviewFindings(reviewText);
  if (findings.length === 0) return;

  void (async () => {
    try {
      const run = await runsRepo.findRunById(runId);
      if (!run?.workspaceId) return;

      const reviewId = await workspaceRepo.insertReview({
        workspaceId: run.workspaceId,
        title: "Code Review",
        summary: reviewText,
        runId,
      });
      await workspaceRepo.insertManyFindings(
        findings.map((finding) => ({
          reviewId,
          severity: finding.severity as any,
          file: finding.file,
          lineStart: finding.lineStart,
          lineEnd: finding.lineEnd,
          message: finding.message,
          reason: finding.reason,
        })),
      );

      logWorkspaceActivity({
        workspaceId: run.workspaceId,
        type: "review",
        title: "Code Review",
        summary: reviewText,
        refId: reviewId,
      });
      logWorkspaceActivity({
        workspaceId: run.workspaceId,
        type: "finding",
        title: `${findings.length} finding(s) saved`,
        refId: reviewId,
        metadata: {
          count: findings.length,
          critical: findings.filter(
            (finding) => finding.severity === "critical",
          ).length,
          warning: findings.filter(
            (finding) => finding.severity === "warning",
          ).length,
          info: findings.filter(
            (finding) => finding.severity === "info",
          ).length,
        },
      });

      logInfo(
        `Saved review ${reviewId} with ${findings.length} finding(s) for run ${runId}`,
      );
    } catch (error) {
      logError("Failed to persist review findings:", error);
    }
  })();
}

// ─────────────────────────────────────────────────────────────
// Rate-limit live push
// ─────────────────────────────────────────────────────────────

/** Push a fresh rate-limit snapshot to every client via the event bus. */
function broadcastRateLimits(providerId: string, rateLimits: RateLimitInfo | null): void {
  if (!rateLimits) return;
  emit(CHANNELS.providers.rateLimitsUpdated, { providerId, rateLimits });
}

/**
 * Map a raw Codex goal object (from `thread/goal/*` results or the
 * `thread/goal/updated` notification — identical wire shape) into `GoalInfo`.
 */
function mapGoalSnapshot(raw: Record<string, unknown> | null | undefined): GoalInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const threadId = raw.threadId as string | undefined;
  if (!threadId) return null;
  return {
    threadId,
    objective: (raw.objective as string) ?? "",
    status: (raw.status as string) ?? "active",
    tokenBudget: raw.tokenBudget as number | undefined,
    tokensUsed: raw.tokensUsed as number | undefined,
    timeUsedSeconds: raw.timeUsedSeconds as number | undefined,
    createdAt: raw.createdAt as number | undefined,
    updatedAt: raw.updatedAt as number | undefined,
  };
}

/**
 * Push a goal change to every live renderer window. `goal === null` signals the
 * goal was cleared. Carries `runId` so the renderer can match it to the active
 * run's card. Mirrors {@link broadcastRateLimits}.
 */
function broadcastGoal(providerId: string, runId: string | null, goal: GoalInfo | null): void {
  emit(CHANNELS.providers.goalUpdated, { providerId, runId, goal }, runId ? { runId } : undefined);
}

/**
 * Make `@<absolute path>` file mentions in a goal objective relative to the
 * workspace root, so the goal reads `@src/foo.ts` instead of the long worktree
 * prefix (e.g. ~/Library/Application Support/mains/worktrees/…). Relative paths
 * are also more useful to the agent, which runs with cwd = rootPath. Mentions
 * pointing outside the workspace are left untouched.
 */
export function relativizeGoalMentions(goal: string, rootPath: string | undefined): string {
  if (!rootPath || !goal) return goal;
  // Literal replace (not regex) so roots containing spaces — e.g. macOS
  // "Application Support" in the worktree path — are matched correctly.
  const root = rootPath.endsWith("/") ? rootPath : rootPath + "/";
  return goal.split("@" + root).join("@");
}

/**
 * Register a run's prompt as the thread's goal when goal mode is on.
 *
 * - New threads (`createSession`) pass `overwrite=true` — the first prompt IS
 *   the goal, set it unconditionally.
 * - Continue / fork pass `overwrite=false` — a goal is thread-scoped and meant
 *   to persist across turns, so we must NOT clobber an in-progress goal with
 *   every follow-up. We only (re)set when there's no goal yet or the previous
 *   one already completed; an active/paused/blocked goal is left as-is for the
 *   new turn to keep pursuing.
 */
async function maybeSetThreadGoal(
  server: CodexAppServer,
  threadId: string | undefined,
  goalMode: boolean,
  rawObjective: string | undefined,
  rootPath: string | undefined,
  overwrite: boolean,
): Promise<void> {
  if (!goalMode || !threadId || !rawObjective?.trim()) return;
  if (!overwrite) {
    try {
      const existing = await server.sendRequest("thread/goal/get", {
        threadId,
      });
      if (existing.goal && existing.goal.status !== "complete") return;
    } catch {
      /* no goal / get failed — fall through and set */
    }
  }
  const objective = relativizeGoalMentions(rawObjective, rootPath);
  await server
    .sendRequest("thread/goal/set", { threadId, objective })
    .catch((err) => logWarn("thread/goal/set failed:", err instanceof Error ? err.message : err));
}

// ─────────────────────────────────────────────────────────────
// Adapter factory
// ─────────────────────────────────────────────────────────────

/** Reconstruct resumable child-thread state from the persisted spawn rows. */
export function mapPersistedCodexSubAgents(
  calls: Array<{
    toolId: string | null;
    metadata: unknown;
  }>,
): CodexSubAgentRunMeta[] {
  const byThreadId = new Map<string, CodexSubAgentRunMeta>();
  for (const call of calls) {
    const lifecycle = (
      call.metadata as Record<string, unknown> | null
    )?.subagent as
      | {
          phase?: string;
          agentId?: string;
          agentType?: string;
          prompt?: string;
          result?: string;
        }
      | undefined;
    if (
      !lifecycle?.agentId ||
      !call.toolId ||
      byThreadId.has(lifecycle.agentId)
    ) {
      continue;
    }
    const terminalPhase =
      lifecycle.phase === "completed" ||
      lifecycle.phase === "failed" ||
      lifecycle.phase === "stopped"
        ? lifecycle.phase
        : undefined;
    const normalizedAgentType = lifecycle.agentType?.trim();
    const nickname =
      normalizedAgentType &&
      normalizedAgentType.toLowerCase() !== "agent" &&
      normalizedAgentType.toLowerCase() !== "subagent"
        ? normalizedAgentType
        : undefined;
    byThreadId.set(lifecycle.agentId, {
      threadId: lifecycle.agentId,
      nickname,
      prompt: lifecycle.prompt,
      spawnItemId: call.toolId,
      terminalEmitted: terminalPhase !== undefined,
      terminalPhase,
      lastMessage: lifecycle.result,
    });
  }
  return [...byThreadId.values()];
}

/**
 * Creates a Codex driver using `codex app-server` JSON-RPC protocol.
 * Spawns `codex app-server` as a subprocess and communicates via
 * newline-delimited JSON-RPC over stdin/stdout.
 *
 * Key advantage over @openai/codex-sdk: model selection works per-turn,
 * bypassing ~/.codex/config.toml precedence issues.
 */
export function createCodexDriver(config: CodexAdapterConfig): ProviderDriver {
  let appServer: CodexAppServer | null = null;
  let appServerStartPromise: Promise<CodexAppServer> | null = null;
  let codexVersionPromise: Promise<string | null> | null = null;
  let codexCompatibilityPromise: Promise<void> | null = null;
  // One-shot generation model (titles, commit messages, PR bodies): Codex's
  // "fast and affordable agentic coding model" tier, at medium effort.
  const titleGenerationModel = "gpt-5.6-luna";
  const runCoordinator = createCodexRunCoordinator({
    getDefaultModel: () => config.defaultModel,
    onReviewCompleted: persistCodexReviewFindings,
    logger: codexLogger,
  });
  const sessionAcquisition = createCodexSessionAcquisition({
    config,
    ensureServer: (cwd) => ensureServer(cwd),
    runCoordinator,
    findPersistedSession: async (runId) =>
      (await runsRepo.findRunById(runId))?.sessionId ??
      undefined,
    findPersistedSubAgents: async (runId) => {
      const calls = await runsRepo.findToolCallsByRun(runId);
      return mapPersistedCodexSubAgents(calls);
    },
    persistSession: async (runId, threadId) => {
      await runsRepo.updateRun(runId, { sessionId: threadId });
    },
    establishGoal: maybeSetThreadGoal,
    resolveDefaultModel: catalogDefaultModel,
    logger: codexLogger,
  });
  const capabilities = createCodexCapabilities({
    getDefaultModel: () => config.defaultModel,
    ensureServer: (cwd) => ensureServer(cwd),
    getRunningServer: () =>
      appServer?.isRunning ? appServer : null,
    getCliHealth: () => getCodexCliHealth(),
    logger: codexLogger,
  });

  /**
   * The catalog's own default — what the other drivers reach through
   * `resolveCatalogDefaultId`, and what a turn falls back to when neither the
   * run nor the config names a model. Cached briefly: `model/list` is a round
   * trip to the app-server, and the answer only moves when models rotate.
   */
  const CATALOG_DEFAULT_TTL_MS = 5 * 60_000;
  let catalogDefault: { at: number; value: Promise<string | undefined> } | null =
    null;
  function catalogDefaultModel(): Promise<string | undefined> {
    const now = Date.now();
    if (catalogDefault && now - catalogDefault.at < CATALOG_DEFAULT_TTL_MS) {
      return catalogDefault.value;
    }
    const value = capabilities
      .listModels()
      .then((models) => {
        const flagged = models.find((model) => model.isDefault)?.id;
        return resolveCatalogDefaultId(
          models.map((model) => model.id),
          config.defaultModel,
          flagged ? [flagged] : [],
        );
      })
      .catch((error: unknown) => {
        codexLogger.warn(
          `Could not resolve a default model from the catalog: ${error instanceof Error ? error.message : String(error)}`,
        );
        catalogDefault = null;
        return undefined;
      });
    catalogDefault = { at: now, value };
    return value;
  }

  // ─────────────────────────────────────────────────────────────
  // Find codex binary
  // ─────────────────────────────────────────────────────────────

  function findCodexBinary(): string {
    if (config.binary) return config.binary;

    const resolved = findCodexBinaryPath();
    if (resolved) return resolved;

    throw new Error(
      "Codex CLI not found. Please install Codex and ensure `codex` is in your PATH, " +
      "or set config.binary to the full path of the codex executable."
    );
  }

  /**
   * Build the spawn env: HOME, an extended PATH (nvm node bins + common dirs so
   * the packaged app can find `codex`), and the OpenAI/Codex API key.
   */
  function buildCodexEnv(binaryPath: string): Record<string, string> {
    const env: Record<string, string> = {};
    env.HOME = os.homedir();

    const homedir = os.homedir();
    const extraPaths = [
      path.dirname(binaryPath),
      path.join(homedir, ".nvm", "versions", "node"),
      "/usr/local/bin",
      "/opt/homebrew/bin",
    ];
    try {
      const nvmDir = process.env.NVM_DIR || path.join(homedir, ".nvm");
      const nodeVersions = fs.readdirSync(path.join(nvmDir, "versions", "node"));
      for (const v of nodeVersions) {
        extraPaths.push(path.join(nvmDir, "versions", "node", v, "bin"));
      }
    } catch { /* no nvm */ }
    env.PATH = [...extraPaths, process.env.PATH || ""].join(":");

    if (config.apiKey) {
      env.OPENAI_API_KEY = config.apiKey;
    } else if (process.env.OPENAI_API_KEY) {
      env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    } else if (process.env.CODEX_API_KEY) {
      env.CODEX_API_KEY = process.env.CODEX_API_KEY;
    }
    return env;
  }

  /** Run a one-shot `codex <args>` CLI command (not the app-server). */
  function runCodexCli(
    args: string[],
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const binaryPath = findCodexBinary();
    const env = { ...process.env, ...buildCodexEnv(binaryPath) };
    return new Promise((resolve) => {
      const child = spawn(binaryPath, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("close", (code) => resolve({ stdout, stderr, code }));
      child.on("error", (err) =>
        resolve({ stdout, stderr: String(err instanceof Error ? err.message : err), code: null }),
      );
    });
  }

  /** Read the installed Codex CLI version (e.g. "0.147.0" from "codex-cli 0.147.0"). */
  function getCodexVersion(): Promise<string | null> {
    codexVersionPromise ??= (async () => {
      try {
        const { stdout } = await runCodexCli(["--version"], 8000);
        const match = stdout.trim().match(/(\d+\.\d+\.\d+[^\s]*)/);
        return match ? match[1] : stdout.trim() || null;
      } catch {
        return null;
      }
    })();
    return codexVersionPromise;
  }

  function ensureCompatibleCodexVersion(): Promise<void> {
    codexCompatibilityPromise ??= (async () => {
      const version = await getCodexVersion();
      if (!version) {
        logWarn(
          "Could not determine the Codex CLI version; app-server compatibility is unverified.",
        );
        return;
      }

      const minimumComparison = compareCodexVersions(
        version,
        CODEX_MIN_CLI_VERSION,
      );
      if (minimumComparison !== null && minimumComparison < 0) {
        throw new Error(
          `Codex CLI ${version} is not supported. Mains requires ${CODEX_MIN_CLI_VERSION} or newer.`,
        );
      }

      const schemaComparison = compareCodexVersions(
        version,
        CODEX_APP_SERVER_PROTOCOL_VERSION,
      );
      if (schemaComparison !== null && schemaComparison > 0) {
        logWarn(
          `Codex CLI ${version} is newer than Mains' tested app-server schema ${CODEX_APP_SERVER_PROTOCOL_VERSION}; continuing in forward-compatible mode.`,
        );
      }
    })();
    return codexCompatibilityPromise;
  }

  async function getCodexCliHealth(): Promise<
    NonNullable<AccountInfo["cli"]>
  > {
    const version = await getCodexVersion();
    const minimumComparison = version
      ? compareCodexVersions(version, CODEX_MIN_CLI_VERSION)
      : null;
    const schemaComparison = version
      ? compareCodexVersions(version, CODEX_APP_SERVER_PROTOCOL_VERSION)
      : null;
    const compatibility =
      !version || minimumComparison === null || schemaComparison === null
        ? "unknown"
        : minimumComparison < 0
          ? "unsupported"
          : schemaComparison > 0
            ? "newer"
            : "supported";
    return {
      version,
      channel: null,
      outdated: compatibility === "unsupported",
      compatibility,
      minimumVersion: CODEX_MIN_CLI_VERSION,
      testedProtocolVersion: CODEX_APP_SERVER_PROTOCOL_VERSION,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Ensure app-server is running
  // ─────────────────────────────────────────────────────────────

  async function startServer(cwd?: string): Promise<CodexAppServer> {
    const binaryPath = findCodexBinary();
    const spawnCwd = cwd ?? os.homedir();
    logInfo(`Starting app-server: ${binaryPath} app-server (cwd: ${spawnCwd}, HOME=${process.env.HOME}, homedir=${os.homedir()})`);

    const server = new CodexAppServer(codexLogger);
    const env = buildCodexEnv(binaryPath);

    await server.start(binaryPath, spawnCwd, env);
    appServer = server;
    runCoordinator.installDispatcher(server);

    server.setOnClose(() => {
      if (appServer === server) {
        appServer = null;
      }
      capabilities.onServerClosed();
      runCoordinator.handleServerClose();
    });

    // Handshake: initialize → initialized (required before any other RPC)
    const initializeResponse = await server.sendRequest("initialize", {
      clientInfo: {
        name: "mains",
        title: "Mains Desktop",
        version: app.getVersion(),
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });
    if (
      typeof initializeResponse.userAgent !== "string" ||
      typeof initializeResponse.codexHome !== "string" ||
      typeof initializeResponse.platformFamily !== "string" ||
      typeof initializeResponse.platformOs !== "string"
    ) {
      throw new Error(
        `Codex app-server initialize response is incompatible with protocol ${CODEX_APP_SERVER_PROTOCOL_VERSION}`,
      );
    }
    server.sendNotification("initialized");

    // Background handler: captures notifications that arrive after turn completes
    // (e.g. thread/name/updated for auto-generated titles)
    server.setBackgroundHandler((method, params) => {
      if (method === "thread/name/updated" || method === "thread/nameUpdated") {
        const p = params as Record<string, unknown> | undefined;
        const threadName = p?.threadName as string | undefined;
        const threadId = p?.threadId as string | undefined;
        if (threadName && threadId) {
          const runId =
            runCoordinator.findRunIdForThread(threadId);
          if (runId) {
            runsRepo.updateRun(runId, { title: threadName }).catch((err) =>
              logError("Failed to update run title:", err),
            );
          }
        }
      }

      // Live rate-limit snapshot — push to the renderer so the Codex settings
      // panel (and any future indicator) refreshes immediately instead of
      // waiting for its 60s poll. Account-scoped, so it lives in the background
      // handler and fires regardless of run lifecycle.
      if (method === "account/rateLimits/updated") {
        const rl = (params as Record<string, unknown> | undefined)?.rateLimits as
          | Record<string, unknown>
          | undefined;
        broadcastRateLimits(PROVIDER_IDS.codex, mapRateLimitSnapshot(rl));
      }

      // Live goal updates — push to the renderer so the goal card above the
      // input reflects status/usage as Codex tracks the objective. Thread-
      // scoped, so we reverse-map threadId → runId for the card to match.
      if (method === "thread/goal/updated") {
        const p = params as Record<string, unknown> | undefined;
        const goal = mapGoalSnapshot(p?.goal as Record<string, unknown> | undefined);
        const threadId = (p?.threadId ?? goal?.threadId) as string | undefined;
        broadcastGoal(
          PROVIDER_IDS.codex,
          runCoordinator.findRunIdForThread(threadId),
          goal,
        );
      }
      if (method === "thread/goal/cleared") {
        const p = params as Record<string, unknown> | undefined;
        const threadId = p?.threadId as string | undefined;
        broadcastGoal(
          PROVIDER_IDS.codex,
          runCoordinator.findRunIdForThread(threadId),
          null,
        );
      }
    });

    logInfo("App-server initialized successfully");
    return server;
  }

  async function ensureServer(cwd?: string): Promise<CodexAppServer> {
    if (appServer?.isRunning) return appServer;
    if (appServerStartPromise) return appServerStartPromise;

    const startPromise = ensureCompatibleCodexVersion().then(() =>
      startServer(cwd),
    );
    appServerStartPromise = startPromise;
    try {
      return await startPromise;
    } catch (error) {
      const failedServer = appServer;
      if (failedServer) {
        await failedServer.stop().catch(() => undefined);
        if (appServer === failedServer) {
          appServer = null;
        }
      }
      throw error;
    } finally {
      if (appServerStartPromise === startPromise) {
        appServerStartPromise = null;
      }
    }
  }

  async function findThreadIdForRun(runId: string): Promise<string | null> {
    return (
      runCoordinator.getSessionThread(runId) ??
      (await runsRepo.findRunById(runId))?.sessionId ??
      null
    );
  }

  // ─────────────────────────────────────────────────────────────
  // WorkRunAdapter implementation
  // ─────────────────────────────────────────────────────────────

  return {
    createSession: sessionAcquisition.createSession,
    resumeSession: sessionAcquisition.resumeSession,
    forkSession: sessionAcquisition.forkSession,
    reviewSession: sessionAcquisition.reviewSession,

    async executePrompt(
      sessionParam,
      _prompt,
      onEvent,
      signal,
    ): Promise<DriverOutcome> {
      return runCoordinator.executeTurn(
        appServer,
        sessionParam as CodexRunSession,
        onEvent,
        signal,
      );
    },

    async cleanup(sessionParam): Promise<void> {
      const session = sessionParam as CodexRunSession;
      await runCoordinator.cleanupRun(
        appServer,
        session.runId,
      );
    },

    async canResumeSession(runId: string): Promise<boolean> {
      if (runCoordinator.getSessionThread(runId)) return true;
      // DB fallback
      const run = await runsRepo.findRunById(runId);
      if (run?.sessionId) {
        runCoordinator.attachThread(runId, run.sessionId);
        return true;
      }
      return false;
    },

    async archiveSession(runId: string): Promise<void> {
      const threadId = await findThreadIdForRun(runId);
      if (!threadId) return;

      const server = await ensureServer();
      await server.sendRequest("thread/archive", { threadId });
      runCoordinator.deleteRun(runId);
    },

    async unarchiveSession(runId: string): Promise<void> {
      const threadId = await findThreadIdForRun(runId);
      if (!threadId) return;

      const server = await ensureServer();
      await server.sendRequest("thread/unarchive", { threadId });
      runCoordinator.attachThread(runId, threadId);
    },

    async deleteSession(runId: string): Promise<void> {
      const threadId = await findThreadIdForRun(runId);
      if (threadId) {
        const server = await ensureServer();
        await server.sendRequest("thread/delete", { threadId });
      }
      runCoordinator.deleteRun(runId);
    },

    // Settings writes land here instead of rebuilding the driver: a second
    // instance would spawn a second `codex app-server`, and the first still
    // holds the writer lock on every thread it opened, so the next
    // `thread/resume` fails with "already has an active writer".
    updateConfig(next) {
      adoptConfig(config, next as CodexAdapterConfig);
    },

    async shutdown(): Promise<void> {
      runCoordinator.shutdown();
      capabilities.shutdown();

      if (appServer) {
        await appServer.stop();
        appServer = null;
      }

      logInfo("Shutdown complete");
    },

    listModels: capabilities.listModels,

    getAccountInfo: capabilities.getAccountInfo,

    async updateCli(): Promise<CliUpdateResult> {
      const { stdout, stderr, code } = await runCodexCli(["update"], 120000);
      // The binary may have changed — drop the cached version/compatibility
      // probes so the next health check (and version gate) re-reads it.
      codexVersionPromise = null;
      codexCompatibilityPromise = null;
      return { success: code === 0, output: `${stdout}${stderr}`.trim() };
    },

    getRateLimits: capabilities.getRateLimits,

    // ── Thread goal controls (Codex `thread/goal/*`) ──
    // threadId is resolved from the coordinator, falling back to the
    // run's persisted sessionId (survives an app restart). We also broadcast the
    // result directly so the caller's card converges even if the matching
    // `thread/goal/updated` notification races or is missed.

    async setGoal(runId: string, params: GoalSetParams): Promise<GoalInfo | null> {
      try {
        const threadId =
          runCoordinator.getSessionThread(runId) ??
          (await runsRepo.findRunById(runId))?.sessionId ??
          undefined;
        if (!threadId) {
          logWarn(`setGoal: no thread for run ${runId}`);
          return null;
        }
        const server = await ensureServer();
        const goalParams: CodexAppServerParams<"thread/goal/set"> = {
          threadId,
          ...(params.objective !== undefined ? { objective: params.objective } : {}),
          ...(params.status !== undefined
            ? { status: params.status as CodexGoalStatus }
            : {}),
          ...(params.tokenBudget !== undefined ? { tokenBudget: params.tokenBudget } : {}),
        };
        const result = await server.sendRequest(
          "thread/goal/set",
          goalParams,
        );
        const goal = mapGoalSnapshot(
          result.goal as unknown as Record<string, unknown>,
        );
        broadcastGoal(PROVIDER_IDS.codex, runId, goal);
        return goal;
      } catch (error) {
        logError("setGoal failed:", error);
        return null;
      }
    },

    async getGoal(runId: string): Promise<GoalInfo | null> {
      try {
        const threadId =
          runCoordinator.getSessionThread(runId) ??
          (await runsRepo.findRunById(runId))?.sessionId ??
          undefined;
        if (!threadId || !appServer?.isRunning) return null;
        const result = await appServer.sendRequest("thread/goal/get", {
          threadId,
        });
        return mapGoalSnapshot(
          result.goal as unknown as Record<string, unknown> | undefined,
        );
      } catch (error) {
        if (isCodexUnavailableThreadError(error)) return null;
        logError("getGoal failed:", error);
        return null;
      }
    },

    async clearGoal(runId: string): Promise<boolean> {
      try {
        const threadId =
          runCoordinator.getSessionThread(runId) ??
          (await runsRepo.findRunById(runId))?.sessionId ??
          undefined;
        if (!threadId) return false;
        const server = await ensureServer();
        const result = await server.sendRequest("thread/goal/clear", {
          threadId,
        });
        const cleared = result.cleared;
        if (cleared) broadcastGoal(PROVIDER_IDS.codex, runId, null);
        return cleared;
      } catch (error) {
        logError("clearGoal failed:", error);
        return false;
      }
    },

    listSkills: capabilities.listSkills,

    async generateTitle(goal: string, context?: WorkRunContextItem[]): Promise<string> {
      try {
        const binaryPath = findCodexBinary();

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
          "Generate a concise title (2-5 words) that summarizes what the user wants.",
          "Rules:",
          "- Reply with ONLY the title text, nothing else",
          "- Use title case: capitalize the first letter of each word, e.g. \"Fix Login Redirect\", \"Add Dark Mode\", \"Hello Greeting\"",
          "- Do NOT use generic descriptions of the request type, e.g. NOT \"Title Generation\"",
          "- No quotes, no punctuation at the end, no prefixes",
          "",
          `User message: ${goal}`,
          contextSnippet ? `\nContext:\n${contextSnippet}` : "",
        ].filter(Boolean).join("\n");

        const titleText = await new Promise<string>((resolve, reject) => {
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-title-"));
          const outputPath = path.join(tmpDir, "title.txt");
          let settled = false;
          let stdout = "";
          let stderr = "";

          const cleanup = () => {
            try {
              fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch {
              // Ignore temp cleanup failures.
            }
          };

          const env: Record<string, string | undefined> = {
            ...process.env,
            HOME: os.homedir(),
            PATH: [
              path.dirname(binaryPath),
              path.join(os.homedir(), ".nvm", "versions", "node"),
              "/usr/local/bin",
              "/opt/homebrew/bin",
              process.env.PATH || "",
            ].join(":"),
          };
          if (config.apiKey) {
            env.OPENAI_API_KEY = config.apiKey;
          } else if (process.env.OPENAI_API_KEY) {
            env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
          } else if (process.env.CODEX_API_KEY) {
            env.CODEX_API_KEY = process.env.CODEX_API_KEY;
          }

          const args = [
            "exec",
            "--ephemeral",
            "--skip-git-repo-check",
            "--ignore-rules",
            "--sandbox", "read-only",
            "--color", "never",
            "--output-last-message", outputPath,
            "--model", titleGenerationModel,
            // ~/.codex/config.toml leaks into ephemeral execs: a user-level
            // reasoning effort can be unsupported by the title model (400),
            // and configured MCP servers stall/spam a one-shot run.
            "--ignore-user-config",
            "-c", "model_reasoning_effort=medium",
            "-",
          ];

          const child = spawn(binaryPath, args, {
            cwd: os.homedir(),
            env,
            stdio: ["pipe", "pipe", "pipe"],
          });

          const timer = setTimeout(() => {
            try { child.kill("SIGKILL"); } catch { /* already exited */ }
            finish(() => {
              cleanup();
              reject(new Error("Codex title generation timed out"));
            });
          }, 15000);

          function finish(fn: () => void) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn();
          }

          child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
          child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
          child.on("error", (err) => {
            finish(() => {
              cleanup();
              reject(err);
            });
          });
          child.on("close", (code) => {
            finish(() => {
              try {
                const output = fs.existsSync(outputPath)
                  ? fs.readFileSync(outputPath, "utf-8").trim()
                  : stdout.trim();
                cleanup();
                if (code === 0 && output) {
                  resolve(output);
                } else {
                  reject(new Error(stderr.trim() || `Exit code ${code}`));
                }
              } catch (err) {
                cleanup();
                reject(err);
              }
            });
          });

          child.stdin?.end(titlePrompt);
        });

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
      const binaryPath = findCodexBinary();
      const fullPrompt = opts?.system
        ? `${opts.system}\n\n${prompt}`
        : prompt;

      return await new Promise<string>((resolve, reject) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-gen-"));
        const outputPath = path.join(tmpDir, "out.txt");
        let settled = false;
        let stdout = "";
        let stderr = "";

        const cleanup = () => {
          try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          } catch {
            // Ignore temp cleanup failures.
          }
        };

        const env: Record<string, string | undefined> = {
          ...process.env,
          HOME: os.homedir(),
          PATH: [
            path.dirname(binaryPath),
            path.join(os.homedir(), ".nvm", "versions", "node"),
            "/usr/local/bin",
            "/opt/homebrew/bin",
            process.env.PATH || "",
          ].join(":"),
        };
        if (config.apiKey) {
          env.OPENAI_API_KEY = config.apiKey;
        } else if (process.env.OPENAI_API_KEY) {
          env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        } else if (process.env.CODEX_API_KEY) {
          env.CODEX_API_KEY = process.env.CODEX_API_KEY;
        }

        const args = [
          "exec",
          "--ephemeral",
          "--skip-git-repo-check",
          "--ignore-rules",
          "--sandbox", "read-only",
          "--color", "never",
          "--output-last-message", outputPath,
          "--model", opts?.model ?? titleGenerationModel,
          // Same overrides as title generation — see comment there.
          "--ignore-user-config",
          "-c", "model_reasoning_effort=medium",
          "-",
        ];

        const child = spawn(binaryPath, args, {
          cwd: os.homedir(),
          env,
          stdio: ["pipe", "pipe", "pipe"],
        });

        const timer = setTimeout(() => {
          try { child.kill("SIGKILL"); } catch { /* already exited */ }
          finish(() => {
            cleanup();
            reject(new Error("Codex text generation timed out"));
          });
        }, 30000);

        function finish(fn: () => void) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn();
        }

        child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
        child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
        child.on("error", (err) => {
          finish(() => {
            cleanup();
            reject(err);
          });
        });
        child.on("close", (code) => {
          finish(() => {
            try {
              const output = fs.existsSync(outputPath)
                ? fs.readFileSync(outputPath, "utf-8").trim()
                : stdout.trim();
              cleanup();
              if (code === 0 && output) {
                resolve(output);
              } else {
                reject(new Error(stderr.trim() || `Exit code ${code}`));
              }
            } catch (err) {
              cleanup();
              reject(err);
            }
          });
        });

        child.stdin?.end(fullPrompt);
      });
    },

    listPlugins: capabilities.listPlugins,
    listInstalledPlugins: capabilities.listInstalledPlugins,
    readPlugin: capabilities.readPlugin,
    installPlugin: capabilities.installPlugin,
    uninstallPlugin: capabilities.uninstallPlugin,
    setPluginEnabled: capabilities.setPluginEnabled,
  };
}
