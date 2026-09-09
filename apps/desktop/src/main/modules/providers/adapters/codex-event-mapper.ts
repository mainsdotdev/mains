import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  WorkRunEvent,
  WorkRunPlanStep,
  WorkRunPlanUpdateEvent,
  WorkRunUsage,
} from "../../../../shared/adapter.types";
import type { MainsToolContext } from "./mains-tools.core";
import { safeJson } from "./adapter.shared";
import type { CodexAppServer } from "./codex-app-server.client";

export interface CodexThreadItem {
  id: string;
  type: string;
  [key: string]: unknown;
}

export type CodexThreadItemPhase = "start" | "update" | "complete";
type ThreadItem = CodexThreadItem;
type ThreadItemPhase = CodexThreadItemPhase;

interface CodexAsyncQuestion {
  title: string;
  options: string[] | null;
}

function normalizeAsyncQuestions(value: unknown): CodexAsyncQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const question = entry as Record<string, unknown>;
    const title = typeof question.title === "string"
      ? question.title.trim()
      : "";
    if (!title) return [];
    const options = Array.isArray(question.options)
      ? question.options.flatMap((option) =>
          typeof option === "string" && option.trim() ? [option.trim()] : [])
      : null;
    return [{ title, options }];
  });
}

function formatAsyncQuestions(questions: CodexAsyncQuestion[]): string {
  return questions.map((question) => {
    const title = `**${question.title}**`;
    if (!question.options?.length) return title;
    return `${title}\n${question.options.map((option) => `- ${option}`).join("\n")}`;
  }).join("\n\n");
}

/**
 * Sub-thread item types that surface as child tool calls of the spawning
 * collabAgentToolCall (via `metadata.parentToolUseId`), so the session panel
 * can show a subagent's flow. Message / reasoning / plan items are NOT here on
 * purpose: they would stream into the parent's buffers — the pollution the
 * sub-thread filter exists to prevent.
 */
export const SUB_THREAD_TOOL_ITEM_TYPES = new Set([
  "command_execution", "commandExecution",
  "file_read", "fileRead",
  "file_change", "fileChange",
  "mcp_tool_call", "mcpToolCall",
  "web_search", "webSearch",
  "dynamic_tool_call", "dynamicToolCall",
]);

/**
 * Normalize a `CollabAgentStatus` into a terminal subagent phase — the one
 * place the mapping lives, shared by every settle path.
 *
 * completed/shutdown → completed (a shut-down agent ended normally),
 * errored → failed, interrupted → stopped (cut short is not success, but not
 * the agent's own failure either). pendingInit/running are live and notFound
 * means the app-server doesn't know the thread — settling either would be a
 * guess, so they return null.
 */
function collabTerminalPhase(
  status: string,
): "completed" | "failed" | "stopped" | null {
  switch (status) {
    case "completed":
    case "shutdown":
      return "completed";
    case "errored":
      return "failed";
    case "interrupted":
      return "stopped";
    default:
      return null;
  }
}

type SubAgentRunMeta = NonNullable<
  ReturnType<CodexEventRunState["subAgents"]["get"]>
>;

/**
 * The ONE constructor for a sub-agent's terminal lifecycle event. Guards the
 * anchor and the once-only settlement (`terminalEmitted`) and shapes the
 * event uniformly; callers keep only their per-path phase/result/error
 * decisions. Returns null when there is nothing to settle.
 */
function settleSubAgent(
  meta: SubAgentRunMeta,
  threadId: string,
  phase: "completed" | "failed" | "stopped",
  ts: number,
  opts: {
    result?: string;
    error?: string;
    extraMetadata?: Record<string, unknown>;
  } = {},
): WorkRunEvent | null {
  if (!meta.spawnItemId || meta.terminalEmitted) return null;
  meta.terminalEmitted = true;
  meta.terminalPhase = phase;
  meta.activeTurnId = undefined;
  return {
    type: "subagent",
    phase,
    agentType: meta.nickname ?? meta.role ?? "agent",
    agentId: threadId,
    parentToolUseId: meta.spawnItemId,
    result: opts.result,
    error: opts.error,
    ts,
    metadata: { toolCallId: meta.spawnItemId, threadId, ...opts.extraMetadata },
  };
}

/**
 * Web-search-backed answers carry OpenAI's citation annotations inline:
 * private-use markers wrap a payload the ChatGPT UI resolves into source
 * chips — U+E200 `cite` U+E202 `turn1view0` … U+E201. They are transport
 * syntax, not prose, and no client outside ChatGPT can resolve them, so here
 * they render as tofu glyphs mid-sentence ("play on PC ṆciteÖturn1view0Ọ").
 *
 * Strip the whole block plus the space that preceded it (the marker sits
 * after the sentence's punctuation, so leaving it behind adds a stray trailing
 * space that markdown may read as a hard break). An unterminated block is
 * stripped too: streaming deltas cut a marker mid-payload, and the live
 * preview must not flash the raw syntax while waiting for U+E201.
 */
const ANNOTATION_MARKER = /[\uE200-\uE20F]/;
const ANNOTATION_BLOCK = /[ \t]*\uE200[\s\S]*?(?:\uE201|$)/g;

export function stripAnnotationMarkers(text: string): string {
  if (!ANNOTATION_MARKER.test(text)) return text;
  return text.replace(ANNOTATION_BLOCK, "").replace(/[\uE200-\uE20F]/g, "");
}

interface Usage {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

export interface CodexEventRunState {
  threadId: string | null;
  turnId: string | null;
  currentMessageItemId: string | null;
  agentMessageBuffer: string;
  /** Prevents completed-item replay from duplicating persisted assistant text. */
  emittedAgentMessageItemIds: Set<string>;
  /** Questions can arrive after a message's text was flushed by a competing item. */
  emittedAsyncQuestionItemIds: Set<string>;
  pendingFlush: WorkRunEvent[];
  mainsCtx: MainsToolContext;
  fileChangeBuffers: Map<string, string>;
  fileChangeItems: Map<
    string,
    Array<{ path: string; kind: string; diff?: string }>
  >;
  commandOutputBuffers: Map<string, string>;
  emittedImagePaths: Set<string>;
  emittedDocPaths: Set<string>;
  runStartedAt: number;
  planBuffers: Map<string, string>;
  lastPlanSnapshot: string | null;
  subAgents: Map<string, CodexSubAgentRunMeta>;
}

export interface CodexSubAgentRunMeta {
  threadId: string;
  nickname?: string;
  role?: string;
  prompt?: string;
  /**
   * Id of the collabAgentToolCall item (spawnAgent, or resumeAgent for
   * threads spawned outside this run) this sub-agent is anchored to.
   * Child tool calls and lifecycle events attach to it via
   * `parentToolUseId`, which is what the session panel's flow view keys on.
   */
  spawnItemId?: string;
  /** Guards against re-emitting the terminal subagent event on every
   * wait/close agentsStates snapshot. */
  terminalEmitted?: boolean;
  /** Last terminal outcome, retained across parent-turn cleanup so a
   * continuation knows which children require an explicit resume. */
  terminalPhase?: "completed" | "failed" | "stopped";
  /** The child turn currently eligible for run-level interruption. */
  activeTurnId?: string;
  /** Prevents duplicate `running` lifecycle events for one child turn. */
  lastRunningTurnId?: string;
  /**
   * multi_agent v1 (`subAgentActivity` items) now has an explicit completed
   * kind, but older servers and interrupted event streams may omit it. Its
   * registration therefore keeps the child turn as a terminal fallback.
   * v2 collab agents are multi-turn and settle from agentsStates instead.
   */
  settleOnTurnEnd?: boolean;
  /**
   * The sub-thread's latest completed agentMessage — its report. The
   * message items themselves are filtered from the parent timeline, so
   * this is the only place the text survives to become the terminal
   * subagent event's `result`.
   */
  lastMessage?: string;
}

export function createCodexEventRunState(
  threadId: string | null,
  mainsCtx: MainsToolContext,
  runStartedAt = Date.now(),
): CodexEventRunState {
  return {
    threadId,
    turnId: null,
    currentMessageItemId: null,
    agentMessageBuffer: "",
    emittedAgentMessageItemIds: new Set(),
    emittedAsyncQuestionItemIds: new Set(),
    pendingFlush: [],
    mainsCtx,
    fileChangeBuffers: new Map(),
    fileChangeItems: new Map(),
    commandOutputBuffers: new Map(),
    emittedImagePaths: new Set(),
    emittedDocPaths: new Set(),
    runStartedAt,
    planBuffers: new Map(),
    lastPlanSnapshot: null,
    subAgents: new Map(),
  };
}

interface CodexEventMapperOptions {
  getRunState: (
    runId: string,
  ) => CodexEventRunState | undefined;
  onReviewCompleted?: (
    runId: string,
    itemId: string,
    reviewText: string,
  ) => void;
  onParentThreadStarted?: (
    runId: string,
    threadId: string,
  ) => void;
  getDefaultModel?: () => string | undefined;
}

/**
 * Translate one image-generation item lifecycle into renderer events.
 *
 * This pure helper remains exported because image generation has no run-state
 * dependency beyond the stable stream id.
 */
export function mapImageGenerationLifecycle(
  item: Pick<CodexThreadItem, "id"> & { status?: unknown },
  phase: CodexThreadItemPhase,
  runId: string,
  ts: number,
): WorkRunEvent[] {
  const streamId = `codex-image-generation-${runId}-${item.id}`;

  if (phase === "start") {
    return [{
      type: "artifact",
      kind: "image_generation",
      content: "Generating image",
      metadata: {
        source: "codex_image_generation",
        itemId: item.id,
        status:
          typeof item.status === "string"
            ? item.status
            : "inProgress",
      },
      ephemeral: true,
      streamId,
      ts,
    }];
  }

  if (phase !== "complete") return [];

  const events: WorkRunEvent[] = [{
    type: "artifact",
    kind: "image_generation",
    content: "",
    metadata: {
      source: "codex_image_generation",
      itemId: item.id,
      status:
        typeof item.status === "string"
          ? item.status
          : "completed",
    },
    ephemeral: true,
    streamId,
    ts,
  }];

  if (item.status === "failed") {
    events.push({
      type: "log",
      message: "Codex image generation failed",
      level: "error",
      ts,
      metadata: { itemId: item.id },
    });
  }

  return events;
}

/**
 * Stateful Codex item projection module.
 *
 * The driver owns run/session lifecycle and persistence side effects. This
 * module owns the protocol-item → WorkRunEvent implementation and its
 * projection buffers.
 */
export function createCodexEventMapper(
  options: CodexEventMapperOptions,
) {
  const getRunState = options.getRunState;
  const onReviewCompleted = options.onReviewCompleted;

  // Usage accumulation per run
  const usageAccumulator = new Map<string, {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    totalCostUsd: number;
    numTurns: number;
    model: string;
    modelUsage: Record<string, { costUSD: number; inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>;
  }>();
  const usageSnapshots = new Map<string, Map<string, {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
  }>>();

  function getOrCreateUsage(runId: string) {
    if (!usageAccumulator.has(runId)) {
      usageAccumulator.set(runId, {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        totalCostUsd: 0,
        numTurns: 0,
        model: "",
        modelUsage: {},
      });
    }
    return usageAccumulator.get(runId)!;
  }

  function flushUsage(runId: string): WorkRunUsage | undefined {
    const acc = usageAccumulator.get(runId);
    usageAccumulator.delete(runId);
    usageSnapshots.delete(runId);
    if (!acc || (acc.inputTokens === 0 && acc.outputTokens === 0)) {
      return undefined;
    }
    return {
      inputTokens: acc.inputTokens,
      outputTokens: acc.outputTokens,
      cacheReadTokens: acc.cachedInputTokens,
      cacheWriteTokens: acc.cacheWriteTokens,
      numTurns: acc.numTurns,
      model: acc.model || undefined,
      modelUsage: Object.keys(acc.modelUsage).length > 0 ? acc.modelUsage : undefined,
    };
  }

  function usageNumber(
    usage: Usage,
    camelCaseKey: keyof Usage,
    snakeCaseKey: keyof Usage,
  ): number {
    const value = usage[camelCaseKey] ?? usage[snakeCaseKey];
    return typeof value === "number" ? value : 0;
  }

  /**
   * Keep the latest usage snapshot for a turn and apply only its delta. Codex
   * may publish thread/tokenUsage/updated more than once while a turn runs;
   * treating every notification as a new turn would double-count usage.
   */
  function trackUsageSnapshot(
    runId: string,
    turnId: string,
    usage: Usage,
    model?: string,
  ): void {
    const next = {
      inputTokens: usageNumber(usage, "inputTokens", "input_tokens"),
      outputTokens: usageNumber(usage, "outputTokens", "output_tokens"),
      cachedInputTokens: usageNumber(
        usage,
        "cachedInputTokens",
        "cached_input_tokens",
      ),
      cacheWriteTokens: usageNumber(
        usage,
        "cacheWriteInputTokens",
        "cache_write_input_tokens",
      ),
    };

    let runSnapshots = usageSnapshots.get(runId);
    if (!runSnapshots) {
      runSnapshots = new Map();
      usageSnapshots.set(runId, runSnapshots);
    }
    const previous = runSnapshots.get(turnId);
    runSnapshots.set(turnId, next);

    const acc = getOrCreateUsage(runId);
    const inputDelta = next.inputTokens - (previous?.inputTokens ?? 0);
    const outputDelta = next.outputTokens - (previous?.outputTokens ?? 0);
    const cacheReadDelta =
      next.cachedInputTokens - (previous?.cachedInputTokens ?? 0);
    const cacheWriteDelta =
      next.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0);

    acc.inputTokens += inputDelta;
    acc.outputTokens += outputDelta;
    acc.cachedInputTokens += cacheReadDelta;
    acc.cacheWriteTokens += cacheWriteDelta;
    if (!previous) acc.numTurns++;

    const modelName = model || options.getDefaultModel?.() || "codex";
    acc.model = modelName;
    if (!acc.modelUsage[modelName]) {
      acc.modelUsage[modelName] = {
        costUSD: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      };
    }
    acc.modelUsage[modelName].inputTokens += inputDelta;
    acc.modelUsage[modelName].outputTokens += outputDelta;
    acc.modelUsage[modelName].cacheReadInputTokens += cacheReadDelta;
    acc.modelUsage[modelName].cacheCreationInputTokens += cacheWriteDelta;
  }

  /** Compatibility fallback for older app-server turn/completed payloads. */
  function trackUsage(runId: string, params: unknown, model?: string): void {
    const p = params as Record<string, unknown> | undefined;
    if (!p) return;

    const turnObj = p.turn as Record<string, unknown> | undefined;
    const usage = (turnObj?.usage ?? p.usage) as Usage | undefined;
    if (!usage) return;
    const turnId = ((turnObj?.id ?? p.turnId ?? p.turn_id) as string | undefined)
      ?? `legacy-${runId}`;
    trackUsageSnapshot(runId, turnId, usage, model);
  }

  // Image path scanning helpers — used to surface generated images from tool outputs
  // even when the agent doesn't mention the path in chat text.
  const IMAGE_PATH_SCAN_REGEX = /([~/][\w./\- ]+\.(?:png|jpe?g|webp|gif))/gi;

  function expandHomeTilde(p: string): string {
    if (p === "~") return os.homedir();
    if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
    return p;
  }

  function findImagePathsInValue(value: unknown): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const visit = (v: unknown, depth: number): void => {
      if (v == null || depth > 6) return;
      if (typeof v === "string") {
        for (const m of v.matchAll(IMAGE_PATH_SCAN_REGEX)) {
          const p = m[1];
          if (!p || p.includes("://")) continue;
          const idx = m.index ?? 0;
          const before = v.slice(Math.max(0, idx - 12), idx);
          if (before.includes("://")) continue;
          if (seen.has(p)) continue;
          seen.add(p);
          out.push(p);
        }
        return;
      }
      if (Array.isArray(v)) {
        for (const item of v) visit(item, depth + 1);
        return;
      }
      if (typeof v === "object") {
        for (const item of Object.values(v as Record<string, unknown>)) {
          visit(item, depth + 1);
        }
      }
    };
    visit(value, 0);
    return out;
  }

  /**
   * Only surface images that come from Codex's own generated_images dir or live
   * inside the active workspace. Random PNG path references picked up from grep
   * / file reads (e.g. icons in the codebase) would otherwise produce noisy
   * artifact cards.
   */
  function isAllowedImagePath(resolved: string, workspaceRoot: string | null): boolean {
    const codexGenDir = path.join(os.homedir(), ".codex", "generated_images");
    if (resolved === codexGenDir || resolved.startsWith(codexGenDir + path.sep)) {
      return true;
    }
    if (workspaceRoot) {
      const root = path.resolve(workspaceRoot);
      if (resolved === root || resolved.startsWith(root + path.sep)) {
        return true;
      }
    }
    return false;
  }

  function emitImageArtifacts(
    events: WorkRunEvent[],
    runId: string | undefined,
    source: unknown,
    ts: number,
  ): void {
    if (!runId) return;
    const rs = getRunState(runId);
    if (!rs) return;
    for (const raw of findImagePathsInValue(source)) {
      const expanded = expandHomeTilde(raw);
      if (!path.isAbsolute(expanded)) continue;
      const resolved = path.resolve(expanded);
      if (rs.emittedImagePaths.has(resolved)) continue;
      if (!isAllowedImagePath(resolved, rs.mainsCtx.rootPath)) continue;
      try {
        const stat = fs.lstatSync(resolved);
        if (stat.isSymbolicLink() || !stat.isFile()) continue;
      } catch {
        continue;
      }
      rs.emittedImagePaths.add(resolved);
      events.push({
        type: "artifact",
        kind: "image",
        content: "",
        metadata: { kind: "image", path: resolved, fileName: path.basename(resolved) },
        ts,
      });
    }
  }

  // Office document path scanning — mirror of the image scanner above. Surfaces
  // generated .pptx/.docx/.xlsx files as artifact cards even when the agent only
  // references them in prose. Reuses the same workspace allowlist + symlink guard.
  function docTypeFromPath(p: string): "pptx" | "docx" | "xlsx" | null {
    const ext = path.extname(p).toLowerCase();
    if (ext === ".pptx") return "pptx";
    if (ext === ".docx") return "docx";
    if (ext === ".xlsx") return "xlsx";
    return null;
  }

  /** Collect every string value in an arbitrary object/array tree (bounded depth). */
  function collectStrings(value: unknown, out: string[], depth: number): void {
    if (value == null || depth > 6) return;
    if (typeof value === "string") {
      out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) collectStrings(v, out, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) {
        collectStrings(v, out, depth + 1);
      }
    }
  }

  /** Clock-skew slack so a doc written moments before the run's recorded start
   * still counts as "created this run". */
  const DOC_MTIME_SKEW_MS = 10_000;

  /** Emit a `document` artifact for one resolved absolute path, applying the
   * workspace allowlist + symlink/existence guards, a "created this run" mtime
   * gate, and per-run dedup. */
  function emitDocAtResolvedPath(
    events: WorkRunEvent[],
    rs: { emittedDocPaths: Set<string>; mainsCtx: MainsToolContext; runStartedAt: number },
    resolved: string,
    ts: number,
  ): void {
    if (rs.emittedDocPaths.has(resolved)) return;
    if (!isAllowedImagePath(resolved, rs.mainsCtx.rootPath)) return;
    const docType = docTypeFromPath(resolved);
    if (!docType) return;
    try {
      const stat = fs.lstatSync(resolved);
      if (stat.isSymbolicLink() || !stat.isFile()) return;
      // Only surface docs created/modified during this run — not pre-existing
      // files the agent merely referenced (e.g. an `ls outputs/documents`).
      if (stat.mtimeMs < rs.runStartedAt - DOC_MTIME_SKEW_MS) return;
    } catch {
      return;
    }
    rs.emittedDocPaths.add(resolved);
    events.push({
      type: "artifact",
      kind: "document",
      content: "",
      metadata: {
        kind: "document",
        path: resolved,
        fileName: path.basename(resolved),
        docType,
      },
      ts,
    });
  }

  function emitDocumentArtifacts(
    events: WorkRunEvent[],
    runId: string | undefined,
    source: unknown,
    ts: number,
  ): void {
    // Flatten the item tree to its strings and run the permissive, workspace-
    // root-resolving scan over them — this catches both absolute paths in tool
    // output and bare/relative names mentioned in item fields.
    const strings: string[] = [];
    collectStrings(source, strings, 0);
    if (strings.length === 0) return;
    emitDocumentArtifactsFromText(events, runId, strings.join("\n"), ts);
  }

  /**
   * Scan free text (e.g. the agent's final "Done: report.docx" message) for
   * document references, resolving bare/relative names against the workspace
   * root. More permissive than the item scanner — the existence + allowlist
   * checks in {@link emitDocAtResolvedPath} keep prose false-positives out. This
   * is the reliable path when the rendered .png previews live in
   * ~/.codex/generated_images while the real document sits in the workspace.
   */
  // No spaces in the name portion so prose ("the report.docx") splits on the
  // word boundary and yields just "report.docx" rather than swallowing the
  // preceding word. (Paths with spaces are rare for generated docs.)
  const DOC_NAME_SCAN_REGEX = /([~/]?[\w.\-/]*[\w-]\.(?:pptx|docx|xlsx))/gi;

  function emitDocumentArtifactsFromText(
    events: WorkRunEvent[],
    runId: string | undefined,
    text: string | undefined | null,
    ts: number,
  ): void {
    if (!runId || !text) return;
    const rs = getRunState(runId);
    if (!rs) return;
    const root = rs.mainsCtx.rootPath ? path.resolve(rs.mainsCtx.rootPath) : null;
    const seen = new Set<string>();
    for (const m of text.matchAll(DOC_NAME_SCAN_REGEX)) {
      const raw = m[1]?.trim();
      if (!raw || raw.includes("://") || seen.has(raw)) continue;
      seen.add(raw);
      const expanded = expandHomeTilde(raw);
      let resolved: string;
      if (path.isAbsolute(expanded)) {
        resolved = path.resolve(expanded);
      } else if (root) {
        resolved = path.resolve(root, expanded);
      } else {
        continue;
      }
      emitDocAtResolvedPath(events, rs, resolved, ts);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Event mapping: app-server notifications → WorkRunEvent
  // ─────────────────────────────────────────────────────────────

  /**
   * Resolve the thread item id for streamed output chunks.
   * Canonical Codex notification: `item/commandExecution/outputDelta` with
   * `CommandExecutionOutputDeltaNotification` JSON fields `threadId`, `turnId`, `itemId`, `delta`
   * (camelCase on the wire — see `codex-rs/app-server-protocol` v2).
   * Docs: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#events
   * (`item.id` from `item/started` matches delta `itemId`.)
   * Also accepts snake_case / nested `item` for tolerance.
   */
  function resolveStreamOutputItemId(p: Record<string, unknown> | undefined): string | undefined {
    if (!p) return undefined;
    const cand =
      (typeof p.itemId === "string" && p.itemId) ||
      (typeof p.item_id === "string" && p.item_id) ||
      (typeof p.threadItemId === "string" && p.threadItemId) ||
      (typeof p.thread_item_id === "string" && p.thread_item_id) ||
      (typeof (p as { commandExecutionId?: string }).commandExecutionId === "string" &&
        (p as { commandExecutionId: string }).commandExecutionId) ||
      (typeof (p as { command_execution_id?: string }).command_execution_id === "string" &&
        (p as { command_execution_id: string }).command_execution_id);
    if (cand) return cand;
    const item = p.item as ThreadItem | undefined;
    return item?.id && typeof item.id === "string" ? item.id : undefined;
  }

  function notificationOutputDeltaText(p: Record<string, unknown> | undefined): string | undefined {
    if (!p) return undefined;
    const raw = p.delta ?? p.content ?? p.text ?? p.output ?? p.stdout;
    if (typeof raw === "string" && raw.length) return raw;
    if (raw && typeof raw === "object" && "text" in raw && typeof (raw as { text: unknown }).text === "string") {
      const t = (raw as { text: string }).text;
      return t.length ? t : undefined;
    }
    return undefined;
  }

  /** Shell / file-read output: aggregatedOutput plus alternate Codex shapes */
  function extractThreadItemStreamedText(item: ThreadItem): string | undefined {
    const tryStr = (v: unknown): string | undefined =>
      typeof v === "string" && v.trim() ? v : undefined;

    const direct =
      tryStr(item.aggregatedOutput) ??
      tryStr(item.aggregated_output) ??
      tryStr(item.output) ??
      tryStr(item.stdout) ??
      tryStr(item.stderr);
    if (direct) return direct;

    const nestedKeys = ["result", "commandOutput", "command_output"] as const;
    for (const k of nestedKeys) {
      const v = item[k];
      if (typeof v === "string" && v.trim()) return v;
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        const inner =
          tryStr(o.text) ??
          tryStr(o.content) ??
          tryStr(o.stdout) ??
          tryStr(o.output) ??
          tryStr(o.aggregatedOutput) ??
          tryStr(o.aggregated_output);
        if (inner) return inner;
      }
    }
    return undefined;
  }

  function appendCommandOutputBuffer(runId: string, itemId: string | undefined, delta: string | undefined): string | undefined {
    if (!delta || !itemId) return undefined;
    const runState = getRunState(runId);
    if (!runState) return undefined;
    const cur = runState.commandOutputBuffers.get(itemId) ?? "";
    const next = cur + delta;
    runState.commandOutputBuffers.set(itemId, next);
    return next;
  }

  /**
   * Compact a command's stdout/stderr buffer into a single status line for the
   * AsciiLoader. Long outputs (think `npm install`) get reduced to the last
   * non-empty line so the user sees live progress without a wall of text.
   */
  function streamingStatusLine(buffer: string | undefined): string {
    if (!buffer) return "";
    const lines = buffer.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (trimmed) return trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed;
    }
    return "";
  }

  /**
   * Detect a `collabAgentToolCall` item completing on the parent thread, then
   * fetch each new sub-thread's nickname/role via `thread/read` and cache it
   * on runState. Runs before `mapNotification` so subsequent emissions have
   * names available. Fires for ALL collab variants (spawn/wait/close/
   * sendInput/resumeAgent) — wait/close events for sub-threads we never saw
   * a spawn for (e.g. resumed a thread from a past run) still need a name.
   * Best-effort — silent on failure (UI falls back to a short threadId).
   */
  async function maybeResolveCollabSubAgents(
    server: CodexAppServer,
    params: unknown,
    runId: string,
  ): Promise<void> {
    const p = params as Record<string, unknown> | undefined;
    const item = (p?.item ?? p) as Record<string, unknown> | undefined;
    const itemType = item?.type as string | undefined;
    if (itemType !== "collabAgentToolCall" && itemType !== "collab_agent_tool_call") return;

    const eventThreadId = (p?.threadId ?? p?.thread_id) as string | undefined;
    const runState = getRunState(runId);
    // Only run for the parent thread's collab events
    if (!runState || (runState.threadId && eventThreadId && runState.threadId !== eventThreadId)) {
      return;
    }

    const receiverThreadIds =
      ((item?.receiverThreadIds ?? item?.receiver_thread_ids) as string[] | undefined) ?? [];
    // Receiver ids are synchronously pre-registered by the coordinator for
    // routing. Presence in this map therefore does not mean the child identity
    // has already been resolved.
    const unresolvedIds = receiverThreadIds.filter((id) => {
      const meta = runState.subAgents.get(id);
      const nickname = meta?.nickname?.trim().toLowerCase();
      const role = meta?.role?.trim().toLowerCase();
      return (
        (!nickname || nickname === "agent" || nickname === "subagent") &&
        (!role || role === "agent" || role === "subagent")
      );
    });
    if (unresolvedIds.length === 0) return;

    await Promise.all(
      unresolvedIds.map(async (threadId) => {
        try {
          const response = await server.sendRequest("thread/read", {
            threadId,
            includeTurns: false,
          });
          const nickname = response.thread.agentNickname ?? undefined;
          const role = response.thread.agentRole ?? undefined;
          const existing = runState.subAgents.get(threadId);
          runState.subAgents.set(threadId, {
            ...existing,
            threadId,
            ...(nickname ? { nickname } : {}),
            ...(role ? { role } : {}),
          });
        } catch {
          // App-server doesn't know the thread yet, or read failed — keep
          // placeholder; the artifact will fall back to a short threadId.
          if (!runState.subAgents.has(threadId)) {
            runState.subAgents.set(threadId, { threadId });
          }
        }
      }),
    );
  }

  function mapNotification(method: string, params: unknown, runId: string, model?: string): WorkRunEvent[] {
    const ts = Date.now();
    const events: WorkRunEvent[] = [];
    const p = params as Record<string, unknown> | undefined;

    switch (method) {
      case "thread/started": {
        const thread = p?.thread as Record<string, unknown> | undefined;
        const threadId = (thread?.id ?? p?.threadId) as string | undefined;
        if (threadId) {
          const runState = getRunState(runId);

          // Sub-agent thread (AgentControl-spawned). The parent thread for this
          // run was already captured on the first thread/started; subsequent
          // thread/started notifications correspond to spawned sub-threads and
          // carry agentNickname/agentRole metadata we need to render
          // "Spawned <Nickname> <Role>" lines.
          const isSubThread =
            runState?.threadId !== undefined &&
            runState.threadId !== null &&
            runState.threadId !== threadId;
          const nickname = thread?.agentNickname as string | undefined;
          const role = thread?.agentRole as string | undefined;
          if (runState && isSubThread && (nickname || role)) {
            // Merge — a spawnAgent completion may already have anchored this
            // thread (spawnItemId) before its thread/started arrives.
            runState.subAgents.set(threadId, {
              ...runState.subAgents.get(threadId),
              threadId,
              nickname,
              role,
            });
          } else if (!isSubThread) {
            options.onParentThreadStarted?.(runId, threadId);
            if (runState) runState.threadId = threadId;
          }
        }
        break;
      }

      case "turn/started": {
        const turn = p?.turn as Record<string, unknown> | undefined;
        const turnId = (turn?.id ?? p?.turnId) as string | undefined;
        if (turnId) {
          const runState = getRunState(runId);
          const threadId = (p?.threadId ?? p?.thread_id) as
            | string
            | undefined;
          if (
            runState &&
            (
              !threadId ||
              !runState.threadId ||
              threadId === runState.threadId
            )
          ) {
            runState.turnId = turnId;
            runState.lastPlanSnapshot = null;
          } else if (runState && threadId) {
            const meta = runState.subAgents.get(threadId);
            if (
              meta?.spawnItemId &&
              meta.lastRunningTurnId !== turnId &&
              meta.terminalEmitted !== false
            ) {
              meta.activeTurnId = turnId;
              meta.lastRunningTurnId = turnId;
              meta.terminalEmitted = false;
              meta.terminalPhase = undefined;
              events.push({
                type: "subagent",
                phase: "running",
                agentType: meta.nickname ?? meta.role ?? "agent",
                agentId: threadId,
                parentToolUseId: meta.spawnItemId,
                ts,
                metadata: {
                  toolCallId: meta.spawnItemId,
                  threadId,
                  turnId,
                },
              });
            }
          }
        }
        break;
      }

      case "turn/plan/updated": {
        const turnId = (p?.turnId ?? p?.turn_id) as
          | string
          | undefined;
        const runState = getRunState(runId);
        if (
          !turnId ||
          (runState?.turnId && turnId !== runState.turnId)
        ) {
          break;
        }

        const plan = Array.isArray(p?.plan) ? p.plan : [];
        const steps = plan.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const candidate = entry as Record<string, unknown>;
          if (typeof candidate.step !== "string") return [];

          let status: WorkRunPlanStep["status"];
          if (candidate.status === "inProgress") {
            status = "in_progress";
          } else if (
            candidate.status === "pending" ||
            candidate.status === "in_progress" ||
            candidate.status === "completed"
          ) {
            status = candidate.status;
          } else {
            return [];
          }
          return [{
            step: candidate.step,
            status,
          }];
        });

        const event: WorkRunPlanUpdateEvent = {
          type: "plan_update",
          providerTurnId: turnId,
          ...(typeof p?.explanation === "string"
            ? { explanation: p.explanation }
            : {}),
          steps,
        };
        const snapshot = JSON.stringify(event);
        if (runState?.lastPlanSnapshot === snapshot) break;
        if (runState) runState.lastPlanSnapshot = snapshot;
        events.push(event);
        break;
      }

      case "turn/completed": {
        // Sub-thread (subagent) turn completions stream into the same handler;
        // they must not flush the parent's agentMessage buffer or count their
        // usage twice. Only the parent thread's turn/completed advances the run.
        const tcThreadId = (p?.threadId ?? p?.thread_id) as string | undefined;
        const tcParentRs = getRunState(runId);
        const tcTurn = p?.turn as Record<string, unknown> | undefined;
        const tcStatus = (tcTurn?.status ?? p?.status) as string | undefined;
        const tcError = (tcTurn?.error as { message?: string } | undefined)
          ?.message;
        if (
          tcThreadId &&
          tcParentRs?.threadId &&
          tcThreadId !== tcParentRs.threadId
        ) {
          // A v1 sub-agent may emit an explicit completed activity, but its
          // own turn remains the compatibility fallback. A failed or
          // interrupted turn must not read as success.
          const subMeta = tcParentRs.subAgents.get(tcThreadId);
          if (subMeta?.settleOnTurnEnd) {
            const phase =
              tcStatus === "failed"
                ? "failed"
                : tcStatus === "interrupted"
                  ? "stopped"
                  : "completed";
            const settled = settleSubAgent(subMeta, tcThreadId, phase, ts, {
              result: phase === "completed" ? subMeta.lastMessage : undefined,
              error:
                phase === "failed"
                  ? (tcError ?? "Sub-agent turn failed")
                  : undefined,
              extraMetadata: { turnStatus: tcStatus },
            });
            if (settled) events.push(settled);
          }
          break;
        }

        trackUsage(runId, p, model);

        // Backstop: the parent's turn only completes once its coordination is
        // over, so any agent still unsettled (terminal notification lost, or a
        // provider variant that never sends one) settles here — a finished run
        // must not show agents running forever. A parent turn that failed or
        // was interrupted cut its agents short, so they settle as stopped, not
        // as successes.
        if (tcParentRs) {
          const parentCutShort =
            tcStatus === "failed" || tcStatus === "interrupted";
          for (const meta of tcParentRs.subAgents.values()) {
            const settled = settleSubAgent(
              meta,
              meta.threadId,
              parentCutShort ? "stopped" : "completed",
              ts,
              {
                result: parentCutShort ? undefined : meta.lastMessage,
                extraMetadata: { turnStatus: tcStatus },
              },
            );
            if (settled) events.push(settled);
          }
        }

        // Flush any remaining agent message buffer
        const runState = getRunState(runId);
        if (runState) {
          // Emit any pending flushed messages first
          events.push(...runState.pendingFlush);
          runState.pendingFlush = [];

          // Emit remaining buffer
          const messageText = stripAnnotationMarkers(
            runState.agentMessageBuffer,
          ).trim();
          if (messageText) {
            const messageItemId = runState.currentMessageItemId;
            events.push({
              type: "artifact",
              kind: "report",
              content: messageText,
              metadata: { source: "agent_message", itemId: messageItemId },
            });
            if (messageItemId) {
              runState.emittedAgentMessageItemIds.add(messageItemId);
            }
            // The agent's closing summary is the most reliable reference to a
            // generated document (e.g. "Done: report.docx") — surface it as a
            // document artifact card even when the .png previews it produced
            // live elsewhere.
            emitDocumentArtifactsFromText(
              events,
              runId,
              messageText,
              ts,
            );
            runState.agentMessageBuffer = "";
            runState.currentMessageItemId = null;
          }
        }

        const turn = p?.turn as Record<string, unknown> | undefined;
        const status = (turn?.status ?? p?.status) as string | undefined;
        const error = turn?.error as { message?: string } | undefined;
        if (status === "failed" && error?.message) {
          events.push({ type: "log", message: `Codex turn failed: ${error.message}`, level: "error", ts });
        }
        break;
      }

      case "item/started":
      case "item/updated":
      case "item/completed": {
        const item = (p?.item ?? p) as ThreadItem | undefined;
        const eventThreadId = (p?.threadId ?? p?.thread_id) as string | undefined;
        const parentRs = getRunState(runId);
        const isSubThreadItem =
          eventThreadId !== undefined &&
          parentRs?.threadId !== undefined &&
          parentRs.threadId !== null &&
          eventThreadId !== parentRs.threadId;

        // Sub-thread items pollute parent's streaming UI (agentMessage deltas
        // mix into parent's buffer, command output appears as parent's, etc.).
        // The parent thread shows sub-agent activity via `collabAgentToolCall`
        // items on its own thread, so safely skip everything else here.
        // `collabAgentToolCall` is only emitted on the parent thread.
        if (isSubThreadItem) {
          // Emit a heartbeat into the AsciiLoader so the user can see
          // background subagent activity even though the items themselves
          // are filtered out of the parent timeline.
          if (eventThreadId) {
            const meta = parentRs?.subAgents.get(eventThreadId);
            const label = meta?.nickname ?? eventThreadId.slice(-8);
            const role = meta?.role ? ` (${meta.role})` : "";
            events.push({
              type: "artifact",
              kind: "report",
              content: `Subagent ${label}${role} working…`,
              metadata: { source: "codex_subagent_heartbeat", subThreadId: eventThreadId },
              ephemeral: true,
              streamId: `codex-cmd-subagent-${runId}-${eventThreadId}`,
            });

            // The sub-thread's completed messages are its conversation.
            // Remember the latest for the terminal subagent event's `result`,
            // and persist each as an artifact tagged with the spawn anchor —
            // that is what the subagent detail tab renders as chat flow. The
            // main transcript's grouping drops `isFromSubagent` artifacts.
            const subMessage =
              typeof item?.text === "string"
                ? stripAnnotationMarkers(item.text).trim()
                : "";
            const subQuestions = normalizeAsyncQuestions(item?.questions);
            if (
              meta &&
              method === "item/completed" &&
              (item?.type === "agentMessage" || item?.type === "agent_message") &&
              (subMessage || subQuestions.length > 0)
            ) {
              if (subMessage) meta.lastMessage = subMessage;
              if (meta.spawnItemId) {
                if (subMessage) {
                  events.push({
                    type: "artifact",
                    kind: "report",
                    content: subMessage,
                    metadata: {
                      source: "codex_subagent_message",
                      isFromSubagent: true,
                      parentToolUseId: meta.spawnItemId,
                      subThreadId: eventThreadId,
                      itemId: item.id,
                    },
                  });
                }
                if (subQuestions.length > 0) {
                  events.push({
                    type: "artifact",
                    kind: "report",
                    content: formatAsyncQuestions(subQuestions),
                    metadata: {
                      source: "codex_async_questions",
                      isFromSubagent: true,
                      parentToolUseId: meta.spawnItemId,
                      subThreadId: eventThreadId,
                      itemId: item.id,
                      questions: subQuestions,
                    },
                  });
                }
              }
            }

            // Tool-like sub-thread items become child tool calls of the
            // spawning collabAgentToolCall so the subagent's flow is
            // persisted and viewable. Everything else stays filtered.
            //
            // The item is re-keyed to `threadId:itemId` BEFORE it reaches
            // mapThreadItem: item ids are only trusted to be unique within a
            // thread, and mapThreadItem's streaming buffers and correlation
            // ids are keyed by item id — a bare sub-thread id could consume
            // or delete a parent item's buffered output. The qualified id
            // flows into every derived key (toolCallId, per-file fileChange
            // ids, output buffers), which is also what makes it safe to run
            // `item/updated` snapshots through here — the command/file
            // handlers rely on them when completion payloads are sparse.
            const spawnItemId = meta?.spawnItemId;
            if (item?.type && spawnItemId && SUB_THREAD_TOOL_ITEM_TYPES.has(item.type)) {
              const qualified = { ...item, id: `${eventThreadId}:${item.id}` };
              for (const mapped of mapThreadItem(qualified, method, ts, runId)) {
                if (mapped.type !== "tool_call") continue;
                events.push({
                  ...mapped,
                  metadata: {
                    ...mapped.metadata,
                    parentToolUseId: spawnItemId,
                    isFromSubagent: true,
                    subThreadId: eventThreadId,
                  },
                });
              }
            }
          }
          break;
        }

        // Only flush the agent message buffer when a COMPETING agentMessage
        // item starts (different itemId, same type) — that's the only signal
        // that the previous message is done. Codex runs Plan / Reasoning /
        // CollabAgent items concurrently with AgentMessage and interleaves
        // their deltas (see codex-rs/core/tests/suite/items.rs:779-839), so
        // flushing on any non-own item splits the running paragraph into two
        // bubbles ("There's a prior" + "commit named …"). The agentMessage's
        // own `item/completed` and `turn/completed` paths handle the normal
        // end-of-message flush.
        const rsItem = parentRs;
        const incomingId = (item?.id ?? null) as string | null;
        const incomingType = item?.type as string | undefined;
        const isAsyncDelivery = item?.delivery === "async";
        const isCompetingAgentMessage =
          rsItem?.currentMessageItemId !== null &&
          rsItem?.currentMessageItemId !== undefined &&
          incomingId !== rsItem.currentMessageItemId &&
          (incomingType === "agentMessage" || incomingType === "agent_message") &&
          // Async messages may complete out of order while a foreground
          // response is still streaming. They are standalone deliveries, not
          // evidence that the foreground buffer ended.
          !isAsyncDelivery;

        const competingText = rsItem
          ? stripAnnotationMarkers(rsItem.agentMessageBuffer).trim()
          : "";
        if (rsItem && competingText && isCompetingAgentMessage) {
          const completedItemId = rsItem.currentMessageItemId;
          events.push({
            type: "artifact",
            kind: "report",
            content: competingText,
            metadata: { source: "agent_message", itemId: completedItemId },
          });
          if (completedItemId) {
            rsItem.emittedAgentMessageItemIds.add(completedItemId);
          }
          rsItem.agentMessageBuffer = "";
          rsItem.currentMessageItemId = null;
        }

        if (item?.type) {
          events.push(
            ...mapThreadItem(item, method, ts, runId),
          );
        }
        break;
      }

      // Streaming delta: accumulate agent message text per itemId
      case "item/agentMessage/delta": {
        // Skip sub-thread deltas — they would garble the parent's streaming buffer
        const deltaThreadId = (p?.threadId ?? p?.thread_id) as string | undefined;
        const parentForDelta = getRunState(runId);
        if (
          deltaThreadId !== undefined &&
          parentForDelta?.threadId !== undefined &&
          parentForDelta.threadId !== null &&
          deltaThreadId !== parentForDelta.threadId
        ) {
          break;
        }

        const delta = p?.delta as string | undefined;
        const itemId = p?.itemId as string | undefined;
        if (delta) {
          const runState = getRunState(runId);
          if (runState) {
            // New message item started — flush previous one
            if (itemId && runState.currentMessageItemId && itemId !== runState.currentMessageItemId) {
              const text = stripAnnotationMarkers(
                runState.agentMessageBuffer,
              ).trim();
              if (text) {
                const completedItemId = runState.currentMessageItemId;
                runState.pendingFlush.push({
                  type: "artifact",
                  kind: "report",
                  content: text,
                  metadata: { source: "agent_message", itemId: completedItemId },
                });
                runState.emittedAgentMessageItemIds.add(completedItemId);
              }
              runState.agentMessageBuffer = "";
            }
            runState.currentMessageItemId = itemId ?? runState.currentMessageItemId;
            runState.agentMessageBuffer += delta;

            // Emit ephemeral event with accumulated text so far (for streaming UI)
            events.push({
              type: "artifact",
              kind: "report",
              content: stripAnnotationMarkers(runState.agentMessageBuffer),
              metadata: { source: "agent_message_streaming" },
              ephemeral: true,
              streamId: `codex-msg-${runId}-${runState.currentMessageItemId ?? "default"}`,
            });
          }
        }
        break;
      }

      // Accumulate file change diff output per itemId
      case "item/fileChange/output/delta":
      case "item/fileChange/outputDelta": {
        const fcThreadId = (p?.threadId ?? p?.thread_id) as string | undefined;
        const parentForFc = getRunState(runId);
        if (
          fcThreadId !== undefined &&
          parentForFc?.threadId !== undefined &&
          parentForFc.threadId !== null &&
          fcThreadId !== parentForFc.threadId
        ) {
          break;
        }

        const delta = notificationOutputDeltaText(p) ?? ((p?.delta ?? p?.content) as string | undefined);
        const itemId = resolveStreamOutputItemId(p) ?? (p?.itemId as string | undefined);
        if (delta && itemId) {
          const runState = getRunState(runId);
          if (runState) {
            const current = runState.fileChangeBuffers.get(itemId) ?? "";
            runState.fileChangeBuffers.set(itemId, current + delta);
          }
        }
        break;
      }

      // commandExecution stdout/stderr: README + protocol use `item/commandExecution/outputDelta` with plain `delta` string.
      // (`command/exec/outputDelta` is separate: base64 chunks keyed by processId, not thread item id — not handled here.)
      // Extra case labels are defensive aliases; ThreadItem reads in Codex are normally `type: commandExecution` (e.g. cat/rg).
      case "item/commandExecution/output/delta":
      case "item/commandExecution/outputDelta":
      case "item/command_execution/output/delta":
      case "item/command_execution/outputDelta":
      case "item/fileRead/output/delta":
      case "item/fileRead/outputDelta":
      case "item/file_read/output/delta":
      case "item/file_read/outputDelta":
      case "item/shell/output/delta":
      case "item/shell/outputDelta": {
        const cmdThreadId = (p?.threadId ?? p?.thread_id) as string | undefined;
        const parentForCmd = getRunState(runId);
        if (
          cmdThreadId !== undefined &&
          parentForCmd?.threadId !== undefined &&
          parentForCmd.threadId !== null &&
          cmdThreadId !== parentForCmd.threadId
        ) {
          break;
        }

        const delta = notificationOutputDeltaText(p);
        const itemId = resolveStreamOutputItemId(p);
        const next = appendCommandOutputBuffer(runId, itemId, delta);

        // Push a live progress line into the AsciiLoader so long-running
        // commands (npm install, builds, etc.) don't make the run look frozen.
        // The renderer maps streamId prefix `codex-cmd-` to the thinking lane.
        if (next && itemId) {
          const status = streamingStatusLine(next);
          if (status) {
            events.push({
              type: "artifact",
              kind: "report",
              content: status,
              metadata: { source: "codex_cmd_streaming", itemId },
              ephemeral: true,
              streamId: `codex-cmd-${runId}-${itemId}`,
            });
          }
        }
        break;
      }

      // Streaming plan deltas: accumulate per itemId and emit ephemeral
      // streaming artifact so the user sees the plan being written in real time.
      // Final flush happens on item/completed for the plan item itself.
      case "item/plan/delta": {
        const delta = p?.delta as string | undefined;
        const itemId = p?.itemId as string | undefined;
        if (delta && itemId) {
          const runState = getRunState(runId);
          if (runState) {
            const prev = runState.planBuffers.get(itemId) ?? "";
            const next = prev + delta;
            runState.planBuffers.set(itemId, next);
            events.push({
              type: "artifact",
              kind: "report",
              content: next,
              metadata: { source: "codex_plan_streaming", itemId },
              ephemeral: true,
              streamId: `codex-plan-${runId}-${itemId}`,
            });
          }
        }
        break;
      }

      // Other streaming deltas — ignore (reasoning summaries, command output, etc.)
      case "item/commandExecution/terminalInteraction":
      case "item/reasoning/delta":
      case "item/reasoning/summaryPartAdded":
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
      case "item/mcpToolCall/progress":
        break;

      case "error": {
        const msg = (p?.error as { message?: string })?.message ?? p?.message ?? "unknown";
        events.push({ type: "log", message: `Codex error: ${msg}`, level: "error", ts });
        break;
      }

      case "account/rateLimits/updated":
        // Pushed to the renderer from the background handler (window broadcast,
        // not a per-run WorkRunEvent) — nothing to emit into the run timeline.
        break;

      case "thread/tokenUsage/updated": {
        // Live context-window indicator. Codex reports the context currently
        // occupied as the last turn's total_tokens
        // (codex-rs/tui/src/token_usage.rs::tokens_in_context_window), and
        // `modelContextWindow` as the window size. Emit the same renderer-only
        // ephemeral `context_usage` event the Claude driver uses so the
        // ContextUsageRing lights up for Codex runs too.
        // Payload: ThreadTokenUsageUpdatedNotification
        //   { threadId, turnId, tokenUsage: { total, last, modelContextWindow } }
        const tuThreadId = (p?.threadId ?? p?.thread_id) as string | undefined;
        const parentForTu = getRunState(runId);
        if (
          tuThreadId !== undefined &&
          parentForTu?.threadId != null &&
          tuThreadId !== parentForTu.threadId
        ) {
          // Sub-agent thread — don't clobber the parent's indicator.
          break;
        }
        // Tolerate both serializations: the app-server wrapper keys come over
        // camelCase, but the inner per-turn `TokenUsage` is the core type and
        // serializes snake_case (same object `trackUsage` reads as
        // `input_tokens`/`output_tokens`/`cached_input_tokens`). Accept either.
        const tokenUsage = (p?.tokenUsage ?? p?.token_usage) as
          | {
              last?: Usage & { totalTokens?: number; total_tokens?: number };
              modelContextWindow?: number | null;
              model_context_window?: number | null;
            }
          | undefined;
        const usageTurnId = (p?.turnId ?? p?.turn_id) as string | undefined;
        if (tokenUsage?.last && usageTurnId) {
          trackUsageSnapshot(runId, usageTurnId, tokenUsage.last, model);
        }
        const rawMax = tokenUsage?.modelContextWindow ?? tokenUsage?.model_context_window;
        const maxTokens = typeof rawMax === "number" ? rawMax : 0;
        const rawOccupied = tokenUsage?.last?.totalTokens ?? tokenUsage?.last?.total_tokens;
        const occupied = typeof rawOccupied === "number" ? rawOccupied : 0;
        if (maxTokens > 0 && occupied > 0) {
          const total = Math.min(occupied, maxTokens);
          events.push({
            type: "context_usage",
            totalTokens: total,
            maxTokens,
            percentage: (total / maxTokens) * 100,
            model: model ?? undefined,
            ts,
          });
        }
        break;
      }

      case "thread/status/changed":
      case "thread/name/updated": {
        // Codex CLI auto-generates a thread title
        const threadName = p?.threadName as string | undefined;
        if (threadName) {
          events.push({
            type: "log",
            message: threadName,
            level: "sdk-user",
            ts,
            metadata: { threadTitle: threadName },
          });
        }
        break;
      }

      case "thread/closed":
        // Thread lifecycle — internal, no UI event
        break;

      default:
        // Ignore all streaming deltas, internal lifecycle, and noisy notifications
        if (
          method.startsWith("thread/") ||
          method.startsWith("turn/") ||
          method.startsWith("account/") ||
          method.startsWith("skills/") ||
          method.startsWith("config/") ||
          method.startsWith("plugin/") ||
          method.startsWith("hook/") ||
          method.startsWith("mcpServer/") ||
          method.startsWith("serverRequest/") ||
          method.includes("Delta") ||
          method.includes("delta") ||
          method.includes("progress") ||
          method.includes("terminalInteraction") ||
          method.includes("guardian")
        ) {
          break;
        }
        events.push({ type: "log", message: `[codex:${method}] ${safeJson(p)}`, level: "info", ts });
        break;
    }

    return events;
  }

  // ─────────────────────────────────────────────────────────────
  // Codex command_execution → Read / Grep / Glob / Bash (UI tool rows)
  // ─────────────────────────────────────────────────────────────

  function unquoteOuterShellArg(s: string): string {
    const t = s.trim();
    if (t.length >= 2) {
      const a = t[0];
      const b = t[t.length - 1];
      if ((a === "'" && b === "'") || (a === '"' && b === '"')) return t.slice(1, -1);
    }
    return t;
  }

  /** Strip nested `zsh -lc '…'` / `bash -c "…"` wrappers Codex often uses. */
  function unwrapNestedShellCommand(raw: string): string {
    const marker = /\s-(?:lc|c)\s+/i;
    let s = raw.trim();
    for (let d = 0; d < 4; d++) {
      const idx = s.search(marker);
      if (idx === -1) break;
      const inner = s.slice(idx).replace(/^\s*-\w*c\s+/i, "").trim();
      const next = unquoteOuterShellArg(inner);
      if (!next || next === s) break;
      s = next;
    }
    return s.trim();
  }

  function tokenizeShell(cmd: string): string[] {
    const out: string[] = [];
    let cur = "";
    let quote: "'" | '"' | null = null;
    for (let i = 0; i < cmd.length; i++) {
      const ch = cmd[i];
      if (quote) {
        if (ch === "\\" && quote === '"') {
          cur += ch;
          if (i + 1 < cmd.length) cur += cmd[++i];
          continue;
        }
        if (ch === quote) {
          out.push(cur);
          cur = "";
          quote = null;
        } else {
          cur += ch;
        }
        continue;
      }
      if (ch === "'" || ch === '"') {
        if (cur.trim()) {
          out.push(cur.trim());
          cur = "";
        }
        quote = ch;
        continue;
      }
      if (/\s/.test(ch)) {
        if (cur.trim()) {
          out.push(cur.trim());
          cur = "";
        }
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function stripQuotesToken(t: string): string {
    return unquoteOuterShellArg(t);
  }

  function extractReadFilePath(inner: string): string | null {
    const matches = [...inner.matchAll(/'([^']*)'|"([^"]*)"/g)];
    for (let i = matches.length - 1; i >= 0; i--) {
      const p = (matches[i][1] || matches[i][2] || "").trim();
      if (!p) continue;
      if (/^\d+(?:,\d+)?p?$/.test(p)) continue;
      if (p.startsWith("$")) continue;
      if (
        p.includes("/") ||
        /\.[a-zA-Z0-9]{1,12}$/.test(p) ||
        /^[\w.-]+\.(tsx?|jsx?|jsonc?|md|css|html|vue|svelte)$/i.test(p)
      ) {
        return p;
      }
    }
    const tok = tokenizeShell(inner);
    const bin = stripQuotesToken(tok[0] || "")
      .toLowerCase()
      .replace(/^.*\//, "");
    if (!["cat", "sed", "head", "tail", "less", "more"].includes(bin)) return null;
    for (let j = tok.length - 1; j >= 1; j--) {
      const last = stripQuotesToken(tok[j]);
      if (last.startsWith("-")) continue;
      if (/^\d+$/.test(last)) continue;
      if (last.includes("/") || /\.[a-zA-Z]{2,10}$/i.test(last)) return last;
    }
    return null;
  }

  function extractRgPatternAndPath(inner: string): { pattern?: string; path?: string } {
    const tokens = tokenizeShell(inner);
    if (!tokens.length) return {};
    const bin = stripQuotesToken(tokens[0]).replace(/^.*\//, "");
    if (bin !== "rg" && bin !== "ripgrep") return {};
    let i = 1;
    let pattern: string | undefined;
    while (i < tokens.length) {
      const t = stripQuotesToken(tokens[i]);
      if (!t.startsWith("-")) break;
      if (t === "-e" || t === "--regexp") {
        i++;
        if (i < tokens.length) pattern = stripQuotesToken(tokens[i]);
        i++;
        continue;
      }
      if (t === "--glob" || t === "-g" || t === "-t" || t === "--type") {
        i += 2;
        continue;
      }
      i++;
    }
    if (i < tokens.length && !pattern) {
      pattern = stripQuotesToken(tokens[i]);
      i++;
    }
    let path: string | undefined;
    if (i < tokens.length) path = stripQuotesToken(tokens[i]);
    return { pattern, path };
  }

  function extractRgGlobPattern(inner: string): string {
    const tokens = tokenizeShell(inner);
    const bin = stripQuotesToken(tokens[0] || "").replace(/^.*\//, "");
    if (bin !== "rg" && bin !== "ripgrep") return "**/*";
    const pos: string[] = [];
    let i = 1;
    while (i < tokens.length) {
      const t = stripQuotesToken(tokens[i]);
      if (!t.startsWith("-")) {
        pos.push(t);
        i++;
        continue;
      }
      if (t === "--glob" || t === "-g" || t === "-t" || t === "--type" || t === "-e" || t === "--regexp") {
        i += 2;
        continue;
      }
      i++;
    }
    const roots = pos.filter((p) => p !== "rg" && p !== "ripgrep");
    return roots.length ? roots[roots.length - 1] : "**/*";
  }

  function extractGrepClassicPatternPath(inner: string): { pattern?: string; path?: string } {
    const tokens = tokenizeShell(inner);
    let i = 0;
    const bin = stripQuotesToken(tokens[0] || "").replace(/^.*\//, "");
    if (bin !== "grep") return {};
    i = 1;
    let pattern: string | undefined;
    while (i < tokens.length) {
      const t = stripQuotesToken(tokens[i]);
      if (!t.startsWith("-")) break;
      if (t === "-e") {
        i++;
        if (i < tokens.length) pattern = stripQuotesToken(tokens[i++]);
        continue;
      }
      if (t === "-f" || t === "--file") {
        i += 2;
        continue;
      }
      i++;
    }
    if (!pattern && i < tokens.length) pattern = stripQuotesToken(tokens[i++]);
    const path = i < tokens.length ? stripQuotesToken(tokens[i]) : undefined;
    return { pattern, path };
  }

  function extractFindNamePattern(inner: string): string {
    const m = inner.match(/-name\s+(['"])((?:\\.|(?!\1).)*)\1/);
    if (m) return m[2].replace(/\\\./g, ".");
    if (/\s-name\s+/i.test(inner)) return "*";
    return "**/*";
  }

  function classifyCodexShellCommand(rawCommand: string): { toolName: string; input: Record<string, unknown> } {
    const inner = unwrapNestedShellCommand(rawCommand);
    const lower = inner.toLowerCase();

    if (/^\s*(cat|sed|head|tail|less|more)\s/i.test(inner)) {
      const filePath = extractReadFilePath(inner);
      if (filePath) return { toolName: "Read", input: { file_path: filePath } };
    }

    if (/^\s*find\s/.test(lower)) {
      return { toolName: "Glob", input: { pattern: extractFindNamePattern(inner) } };
    }

    if (/\brg\b/.test(lower) || /\bripgrep\b/.test(lower)) {
      const filesOnly =
        /\s--files\b/.test(lower) &&
        !/\s--files-with-matches\b/.test(lower);
      if (filesOnly) {
        return { toolName: "Glob", input: { pattern: extractRgGlobPattern(inner) } };
      }
      const { pattern, path } = extractRgPatternAndPath(inner);
      if (pattern || path) {
        return {
          toolName: "Grep",
          input: {
            ...(pattern ? { pattern } : {}),
            ...(path ? { path } : {}),
          },
        };
      }
    }

    if (/\bgrep\b/.test(lower) && !/\brg\b/.test(lower)) {
      const { pattern, path } = extractGrepClassicPatternPath(inner);
      if (pattern) {
        return {
          toolName: "Grep",
          input: {
            pattern,
            ...(path ? { path } : {}),
          },
        };
      }
    }

    if (/^\s*git\s+grep\s/.test(lower)) {
      const tokens = tokenizeShell(inner);
      let i = 0;
      if (stripQuotesToken(tokens[0] || "").replace(/^.*\//, "") === "git") i = 1;
      if (stripQuotesToken(tokens[i] || "") === "grep") i++;
      while (i < tokens.length) {
        const t = stripQuotesToken(tokens[i]);
        if (!t.startsWith("-")) break;
        i++;
      }
      let pattern: string | undefined;
      if (i < tokens.length) pattern = stripQuotesToken(tokens[i++]);
      const gpath = i < tokens.length ? stripQuotesToken(tokens[i]) : undefined;
      if (pattern) {
        return {
          toolName: "Grep",
          input: {
            pattern,
            ...(gpath ? { path: gpath } : {}),
          },
        };
      }
    }

    return { toolName: "Bash", input: { command: rawCommand } };
  }

  /**
   * Reshape raw shell stdout into the JSON envelope each tool's renderer
   * expects. Codex maps ad-hoc shell commands to logical tools (Glob/Grep/…)
   * via classifyCodexShellCommand, but their stdout is just newline-separated
   * text — GlobDisplay/GrepDisplay need a structured object.
   *
   * Returns a stringified JSON envelope when normalization applies, otherwise
   * the raw stdout (or a fallback exit-code marker when stdout is empty).
   */
  function formatShellOutputForTool(
    toolName: string,
    stdout: string | undefined,
    exitCode: number | undefined,
  ): string {
    const raw = stdout?.trim() ?? "";

    if (toolName === "Glob") {
      const filenames = raw
        ? raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
        : [];
      return JSON.stringify({ filenames, numFiles: filenames.length });
    }

    if (toolName === "Grep") {
      const lines = raw ? raw.split(/\r?\n/) : [];
      return JSON.stringify({
        content: raw || null,
        numLines: lines.length,
      });
    }

    return raw ? raw : `exit code: ${exitCode ?? "unknown"}`;
  }

  /**
   * Map Codex ThreadItem to WorkRunEvents.
   * Matches the app-server's item schema (same structure as SDK ThreadItem).
   */
  function mapThreadItem(item: ThreadItem, eventMethod: string, ts: number, runId: string): WorkRunEvent[] {
    const events: WorkRunEvent[] = [];
    const phase: ThreadItemPhase = eventMethod.endsWith("/started") ? "start" :
      eventMethod.endsWith("/completed") ? "complete" : "update";

    switch (item.type) {
      case "agent_message":
      case "agentMessage": {
        // Deltas accumulate into runState.agentMessageBuffer; flush here on
        // completion so the message is persisted as a single artifact instead
        // of waiting for turn/completed (which would let an unrelated next
        // item arrive first and split ordering). Async deliveries are only
        // guaranteed as completed items, so fall back to the item's full text
        // when there was no delta stream.
        if (phase === "complete" && runId) {
          const rs = getRunState(runId);
          if (rs) {
            const ownsBuffer = rs.currentMessageItemId === item.id;
            const bufferedText = ownsBuffer
              ? stripAnnotationMarkers(rs.agentMessageBuffer).trim()
              : "";
            const itemText = typeof item.text === "string"
              ? stripAnnotationMarkers(item.text).trim()
              : "";
            const messageText = bufferedText || itemText;
            const questions = normalizeAsyncQuestions(item.questions);
            const messagePhase = typeof item.phase === "string"
              ? item.phase
              : undefined;
            const delivery = typeof item.delivery === "string"
              ? item.delivery
              : undefined;

            if (messageText && !rs.emittedAgentMessageItemIds.has(item.id)) {
              events.push({
                type: "artifact",
                kind: "report",
                content: messageText,
                metadata: {
                  source: "agent_message",
                  itemId: item.id,
                  ...(messagePhase ? { messagePhase } : {}),
                  ...(delivery ? { delivery } : {}),
                  ...(questions.length > 0 ? { questions } : {}),
                },
              });
              // The agent's closing summary is the most reliable reference to a
              // generated document (e.g. "Done: report.docx") — surface it as a
              // document artifact card.
              emitDocumentArtifactsFromText(events, runId, messageText, ts);
              rs.emittedAgentMessageItemIds.add(item.id);
            }
            if (
              questions.length > 0 &&
              !rs.emittedAsyncQuestionItemIds.has(item.id)
            ) {
              events.push({
                type: "artifact",
                kind: "report",
                content: formatAsyncQuestions(questions),
                metadata: {
                  source: "codex_async_questions",
                  itemId: item.id,
                  ...(delivery ? { delivery } : {}),
                  questions,
                },
              });
              rs.emittedAsyncQuestionItemIds.add(item.id);
            }
            if (ownsBuffer) {
              rs.agentMessageBuffer = "";
              rs.currentMessageItemId = null;
            }
          }
        }
        break;
      }
      case "userMessage":
        // Internal — no UI event needed.
        break;

      case "function_call_output":
      case "functionCallOutput":
        // This is the response-side echo of a tool result, not a new tool
        // invocation. The originating command/MCP/dynamic-tool lifecycle is
        // already projected, so emitting the body here would duplicate it and
        // can expose a large output as a generic raw log.
        break;

      case "image_generation":
      case "imageGeneration": {
        events.push(...mapImageGenerationLifecycle(item, phase, runId, ts));
        break;
      }

      // Plan items appear in collaborationMode "plan" turns. Text streams via
      // item/plan/delta (handled above into runState.planBuffers); on completion
      // we emit a `Plan` tool_call (start + complete) so the PlanDisplay card
      // renders with Apply/Dismiss buttons — matching the cursor adapter's
      // create_plan flow. Streaming entry is cleared so the live preview
      // disappears once the final card takes over.
      case "plan": {
        if (phase === "complete" && runId) {
          const rs = getRunState(runId);
          const buffered = rs?.planBuffers.get(item.id);
          const fromItem = typeof item.text === "string" ? item.text : "";
          const planText = (buffered?.trim() || fromItem.trim());
          if (rs) rs.planBuffers.delete(item.id);

          // Clear the streaming entry so the live preview disappears.
          events.push({
            type: "artifact",
            kind: "report",
            content: "",
            metadata: { source: "codex_plan_streaming", itemId: item.id },
            ephemeral: true,
            streamId: `codex-plan-${runId}-${item.id}`,
          });

          if (planText) {
            const planMeta = {
              toolCallId: `codex-plan-${item.id}`,
              itemId: item.id,
              codexItemType: "plan" as const,
            };
            events.push({
              type: "tool_call",
              toolName: "Plan",
              input: { plan: planText },
              startedAt: ts,
              metadata: { phase: "start", ...planMeta },
            });
            events.push({
              type: "tool_call",
              toolName: "Plan",
              input: { plan: planText },
              output: { planStatus: "pending" },
              startedAt: ts,
              endedAt: ts,
              metadata: { phase: "complete", ...planMeta },
            });
          }
        }
        break;
      }

      case "reasoning": {
        const text =
          typeof item.text === "string" ? stripAnnotationMarkers(item.text) : "";
        if (text && phase === "complete") {
          events.push({ type: "log", message: `[reasoning] ${text}`, level: "info", ts });
        }
        break;
      }

      case "command_execution":
      case "commandExecution": {
        const command = typeof item.command === "string" ? item.command : safeJson(item.command);
        const exitCode = (item.exitCode ?? item.exit_code) as number | undefined;
        const status = item.status as string | undefined;

        // item/updated may carry aggregatedOutput before/without a rich item/completed payload
        if (phase === "update" && runId) {
          const snap = extractThreadItemStreamedText(item);
          if (snap?.trim()) {
            const rs = getRunState(runId);
            if (rs) rs.commandOutputBuffers.set(item.id, snap);
          }
          break;
        }

        const { toolName, input } = classifyCodexShellCommand(command);
        const cmdMeta = {
          toolCallId: item.id,
          itemId: item.id,
          codexItemType: "command_execution" as const,
          shellCommand: command,
        };

        if (phase === "start") {
          events.push({
            type: "tool_call",
            toolName,
            input,
            startedAt: ts,
            metadata: { phase: "start", ...cmdMeta },
          });
        } else if (phase === "complete") {
          const fromItem = extractThreadItemStreamedText(item);
          const runStateCmd = runId ? getRunState(runId) : undefined;
          const buffered = runStateCmd?.commandOutputBuffers.get(item.id);
          if (runStateCmd && buffered !== undefined) runStateCmd.commandOutputBuffers.delete(item.id);

          const trimmedItem = fromItem?.trim() ?? "";
          const trimmedBuf = buffered?.trim() ?? "";
          let mergedOut: string | undefined;
          if (trimmedItem && trimmedBuf) {
            mergedOut = trimmedItem.length >= trimmedBuf.length ? trimmedItem : trimmedBuf;
          } else {
            mergedOut = trimmedItem || trimmedBuf || undefined;
          }

          const cmdFailed = status === "failed";
          // Normalize output to the shape the renderer's tool display expects.
          // Glob → { filenames, numFiles }, Grep → { content, numLines } so
          // GlobDisplay/GrepDisplay render rich previews instead of empty
          // dropdowns. Other tools (Bash/Read) keep the raw stdout string.
          const normalizedOutput = formatShellOutputForTool(toolName, mergedOut, exitCode);
          events.push({
            type: "tool_call",
            toolName,
            input,
            output: normalizedOutput,
            error: cmdFailed ? `Command failed with exit code ${exitCode}` : undefined,
            endedAt: ts,
            metadata: { phase: "complete", ...cmdMeta, exitCode },
          });

          // Clear the live status line — empty content removes the stream
          // entry from AsciiLoader once the command has actually finished.
          events.push({
            type: "artifact",
            kind: "report",
            content: "",
            metadata: { source: "codex_cmd_streaming", itemId: item.id },
            ephemeral: true,
            streamId: `codex-cmd-${runId}-${item.id}`,
          });
        }
        break;
      }

      case "file_read":
      case "fileRead": {
        const filePath =
          (typeof item.path === "string" && item.path) ||
          (typeof item.filePath === "string" && item.filePath) ||
          (typeof item.file_path === "string" && item.file_path) ||
          "";
        const readStatus = item.status as string | undefined;

        if (phase === "update" && runId) {
          const snap =
            extractThreadItemStreamedText(item) ??
            (typeof item.content === "string" && item.content.trim() ? item.content : undefined);
          if (snap?.trim()) {
            const rs = getRunState(runId);
            if (rs) rs.commandOutputBuffers.set(item.id, snap);
          }
          break;
        }

        const readMeta = {
          toolCallId: item.id,
          itemId: item.id,
          codexItemType: "file_read" as const,
        };

        if (phase === "start") {
          events.push({
            type: "tool_call",
            toolName: "Read",
            input: { file_path: filePath },
            startedAt: ts,
            metadata: { phase: "start", ...readMeta },
          });
        } else if (phase === "complete") {
          const fromItem =
            extractThreadItemStreamedText(item) ??
            (typeof item.content === "string" && item.content.trim() ? item.content : undefined);
          const runStateRead = runId ? getRunState(runId) : undefined;
          const buffered = runStateRead?.commandOutputBuffers.get(item.id);
          if (runStateRead && buffered !== undefined) runStateRead.commandOutputBuffers.delete(item.id);

          const trimmedItem = fromItem?.trim() ?? "";
          const trimmedBuf = buffered?.trim() ?? "";
          let mergedOut: string | undefined;
          if (trimmedItem && trimmedBuf) {
            mergedOut = trimmedItem.length >= trimmedBuf.length ? trimmedItem : trimmedBuf;
          } else {
            mergedOut = trimmedItem || trimmedBuf || undefined;
          }

          const readFailed = readStatus === "failed";
          events.push({
            type: "tool_call",
            toolName: "Read",
            input: { file_path: filePath },
            output: mergedOut?.trim() ? mergedOut : undefined,
            error: readFailed ? "File read failed" : undefined,
            endedAt: ts,
            metadata: { phase: "complete", ...readMeta },
          });

          // Clear the live progress stream for this file read.
          events.push({
            type: "artifact",
            kind: "report",
            content: "",
            metadata: { source: "codex_cmd_streaming", itemId: item.id },
            ephemeral: true,
            streamId: `codex-cmd-${runId}-${item.id}`,
          });
        }
        break;
      }

      case "file_change":
      case "fileChange": {
        const changes = item.changes as Array<{ path: string; kind: string; patch?: string; unifiedDiff?: string; diff?: string }> | undefined;
        const patchStatus = item.status as string | undefined;
        // Item-level patch (some versions of Codex put it here)
        const itemPatch = (item.patch ?? item.unifiedDiff ?? item.diff) as string | undefined;

        // Cache change details on start/update so item/fileChange/requestApproval
        // (which only carries itemId/reason) can render a rich approval dialog.
        if ((phase === "start" || phase === "update") && changes && changes.length > 0 && runId) {
          const rs = getRunState(runId);
          if (rs) {
            rs.fileChangeItems.set(item.id, changes.map((c) => ({
              path: c.path,
              kind: c.kind,
              diff: c.patch ?? c.unifiedDiff ?? c.diff,
            })));
          }
        }

        if (phase === "complete" && changes && changes.length > 0) {
          // Retrieve accumulated diff from delta events, then clean up
          const runState = runId ? getRunState(runId) : undefined;
          const bufferedDiff = runState?.fileChangeBuffers.get(item.id);
          if (runState) {
            runState.fileChangeBuffers.delete(item.id);
            runState.fileChangeItems.delete(item.id);
          }

          for (const change of changes) {
            const toolName = change.kind === "delete" ? "Delete" : (change.kind === "add" || change.kind === "create") ? "Write" : "Edit";
            // Prefer per-change patch → accumulated delta buffer → item-level patch
            const diffContent = change.patch ?? change.unifiedDiff ?? change.diff
              ?? (changes.length === 1 ? (bufferedDiff ?? itemPatch) : bufferedDiff);

            const fcId = `${item.id}-${change.path}`;
            events.push({
              type: "tool_call",
              toolName,
              input: { path: change.path },
              startedAt: ts,
              metadata: { phase: "start", toolCallId: fcId, itemId: fcId, changeType: change.kind, codexItemType: "file_change" },
            });
            const patchErr = patchStatus === "failed";
            events.push({
              type: "tool_call",
              toolName,
              input: { path: change.path },
              output: diffContent ? { detailedContent: diffContent } : `File ${change.kind}: ${change.path}`,
              error: patchErr ? "Patch failed" : undefined,
              endedAt: ts,
              metadata: { phase: "complete", toolCallId: fcId, itemId: fcId, changeType: change.kind, codexItemType: "file_change" },
            });
          }
        }
        break;
      }

      case "mcp_tool_call":
      case "mcpToolCall": {
        const server = typeof item.server === "string" ? item.server : "unknown";
        const tool = typeof item.tool === "string" ? item.tool : "unknown";
        const toolName = `mcp__${server}__${tool}`;
        const args = item.arguments as Record<string, unknown> | undefined;
        const result = item.result as unknown;
        const error = (item.error as { message?: string } | undefined)?.message;

        if (phase === "start") {
          events.push({
            type: "tool_call",
            toolName,
            input: args,
            startedAt: ts,
            metadata: { phase: "start", toolCallId: item.id, itemId: item.id, codexItemType: "mcp_tool_call" },
          });
        } else if (phase === "complete") {
          events.push({
            type: "tool_call",
            toolName,
            input: args,
            output: result,
            error,
            endedAt: ts,
            metadata: { phase: "complete", toolCallId: item.id, itemId: item.id, codexItemType: "mcp_tool_call" },
          });
        }
        break;
      }

      case "web_search":
      case "webSearch": {
        const query = typeof item.query === "string" ? item.query : "";
        if (phase === "complete" && query) {
          events.push({
            type: "tool_call",
            toolName: "WebSearch",
            input: { query },
            startedAt: ts,
            metadata: { phase: "start", toolCallId: item.id, itemId: item.id, codexItemType: "web_search" },
          });
          events.push({
            type: "tool_call",
            toolName: "WebSearch",
            input: { query },
            output: `Searched: ${query}`,
            endedAt: ts,
            metadata: { phase: "complete", toolCallId: item.id, itemId: item.id, codexItemType: "web_search" },
          });
        }
        break;
      }

      case "dynamic_tool_call":
      case "dynamicToolCall": {
        const tool = typeof item.tool === "string" ? item.tool : "unknown";
        const args = (typeof item.arguments === "string" ? safeJson(item.arguments) : item.arguments) as Record<string, unknown> | undefined;
        const contentItems = Array.isArray(item.contentItems)
          ? item.contentItems
          : undefined;
        const success = typeof item.success === "boolean"
          ? item.success
          : undefined;
        const status = item.status as string | undefined;

        if (phase === "start") {
          events.push({
            type: "tool_call",
            toolName: tool,
            input: args,
            startedAt: ts,
            metadata: { phase: "start", toolCallId: item.id, itemId: item.id, codexItemType: "dynamic_tool_call" },
          });
        } else if (phase === "complete") {
          const dynFailed = success === false || status === "failed";
          events.push({
            type: "tool_call",
            toolName: tool,
            input: args,
            output: contentItems,
            error: dynFailed ? `Dynamic tool call failed` : undefined,
            endedAt: ts,
            metadata: {
              phase: "complete",
              toolCallId: item.id,
              itemId: item.id,
              codexItemType: "dynamic_tool_call",
              success,
            },
          });
        }
        break;
      }

      case "todo_list":
      case "todoList": {
        if (phase === "complete") {
          const todos = item.items as Array<{ text: string; completed: boolean }> | undefined;
          if (todos) {
            const summary = todos.map((t) => `${t.completed ? "[x]" : "[ ]"} ${t.text}`).join("\n");
            events.push({ type: "log", message: `[todo]\n${summary}`, level: "info", ts, metadata: { itemId: item.id } });
          }
        }
        break;
      }

      case "enteredReviewMode": {
        if (phase === "start") {
          const label = typeof item.label === "string" ? item.label : "started";
          events.push({ type: "log", message: `Review: ${label}`, level: "info", ts, metadata: { itemId: item.id, codexItemType: "enteredReviewMode" } });
        }
        break;
      }

      case "exitedReviewMode": {
        const reviewText = typeof item.review === "string" ? item.review : typeof item.text === "string" ? item.text : null;
        if (reviewText && phase === "complete") {
          events.push({
            type: "artifact",
            kind: "report",
            content: reviewText,
            metadata: { source: "codex_review_mode", itemId: item.id },
          });

          if (runId) {
            onReviewCompleted?.(runId, item.id, reviewText);
          }
        }
        break;
      }

      case "sub_agent_activity":
      case "subAgentActivity": {
        // multi_agent v1 (feature `multi_agent`, the stable default) surfaces
        // spawned agents as bare activity markers instead of v2's
        // collabAgentToolCall items:
        //   { id: "call_…", kind: "started" | "interacted" | "interrupted" |
        //     "completed", agentThreadId, agentPath: "/root/security_review" }
        // Newer servers emit the explicit completed marker. The sub-thread's
        // own turn/completed and the parent's turn/completed remain fallbacks;
        // settleSubAgent deduplicates whichever terminal signal arrives last.
        if (phase !== "complete" || !runId) break;
        const runStateV1 = getRunState(runId);
        const agentThreadId = (item.agentThreadId ?? item.agent_thread_id) as
          | string
          | undefined;
        const kind = item.kind as string | undefined;
        if (!runStateV1 || !agentThreadId) break;

        const agentPath = (item.agentPath ?? item.agent_path) as string | undefined;
        // Persisted RAW — display-time humanization (subagent-identity) owns
        // presentation; a main-side copy drifted (no camelCase handling) and
        // baked mis-cased names into the DB.
        const pathName = agentPath?.split("/").filter(Boolean).pop();

        if (kind === "started") {
          const existing = runStateV1.subAgents.get(agentThreadId);
          if (existing?.spawnItemId) break; // duplicate started marker
          const meta = {
            ...existing,
            threadId: agentThreadId,
            nickname: existing?.nickname ?? pathName,
            spawnItemId: item.id,
            settleOnTurnEnd: true,
          };
          // Registration also makes the coordinator route this sub-thread's
          // notifications to this run, which is what feeds the flow view.
          runStateV1.subAgents.set(agentThreadId, meta);

          // v1 has no spawn tool call on the wire, so synthesize the
          // start/complete pair — the persisted row is what the session
          // panel's subagent list and flow view anchor to.
          const spawnInput = { agentPath, receiverThreadIds: [agentThreadId] };
          const spawnMeta = {
            toolCallId: item.id,
            itemId: item.id,
            codexItemType: "sub_agent_activity" as const,
          };
          events.push(
            {
              type: "tool_call",
              toolName: "spawnAgent",
              input: spawnInput,
              startedAt: ts,
              metadata: { phase: "start", ...spawnMeta },
            },
            {
              type: "tool_call",
              toolName: "spawnAgent",
              input: spawnInput,
              output: {
                subAgents: [{ threadId: agentThreadId, nickname: meta.nickname }],
                collabTool: "spawnAgent",
              },
              endedAt: ts,
              metadata: { phase: "complete", ...spawnMeta },
            },
            {
              type: "subagent",
              phase: "invoked",
              agentType: meta.nickname ?? "agent",
              agentId: agentThreadId,
              parentToolUseId: item.id,
              ts,
              metadata: { toolCallId: item.id, threadId: agentThreadId, agentPath },
            },
          );
        } else if (kind === "interrupted") {
          // Same normalization as v2's CollabAgentStatus: an interruption is a
          // non-success terminal state, but not the agent's own failure.
          const meta = runStateV1.subAgents.get(agentThreadId);
          const settled =
            meta &&
            settleSubAgent(
              meta,
              agentThreadId,
              collabTerminalPhase("interrupted") ?? "stopped",
              ts,
              {
                result: meta.lastMessage,
                extraMetadata: { activityKind: "interrupted" },
              },
            );
          if (settled) events.push(settled);
        } else if (kind === "completed") {
          const meta = runStateV1.subAgents.get(agentThreadId);
          const settled =
            meta &&
            settleSubAgent(meta, agentThreadId, "completed", ts, {
              result: meta.lastMessage,
              extraMetadata: { activityKind: "completed" },
            });
          if (settled) events.push(settled);
        }
        // "interacted" is parent↔agent traffic, not a state change — ignore.
        break;
      }

      case "collab_agent_tool_call":
      case "collabAgentToolCall": {
        // Codex AgentControl emits collab tool calls in 9 variants:
        //   spawnAgent  → start a new sub-agent thread
        //   sendInput   → push user input into a running sub-agent
        //   wait        → block until sub-agent(s) complete a turn
        //   closeAgent  → terminate sub-agent thread(s)
        //   resumeAgent → reactivate a closed sub-agent
        //   sendMessage → message a running sub-agent
        //   followupTask → assign another turn to an existing sub-agent
        //   interruptAgent → interrupt a sub-agent's active turn
        //   listAgents → inspect the current agent tree
        // Each carries the same shape (sender, receiver_thread_ids, prompt,
        // agents_states). We surface every variant so the timeline mirrors
        // the parent's actual state transitions ("Spawned X", "Finished
        // waiting for X", "Closed X" — matching Codex VS Code / Conductor).
        const tool = (item.tool as string | undefined) ?? "spawnAgent";

        const status = item.status as string | undefined;
        const senderThreadId = (item.senderThreadId ?? item.sender_thread_id) as string | undefined;
        const receiverThreadIds = ((item.receiverThreadIds ?? item.receiver_thread_ids) as string[] | undefined) ?? [];
        const prompt = item.prompt as string | undefined;
        const collabModel = item.model as string | undefined;
        const agentsStates = (item.agentsStates ?? item.agents_states) as
          | Record<string, { status?: string; message?: string | null } | undefined>
          | undefined;

        // Resolve sub-agent metadata captured up-front by maybeResolveCollabSubAgents
        const runStateCollab = runId ? getRunState(runId) : undefined;
        const subAgents = receiverThreadIds.map((id) => {
          const meta = runStateCollab?.subAgents.get(id);
          return {
            threadId: id,
            nickname: meta?.nickname,
            role: meta?.role,
            status: agentsStates?.[id]?.status,
          };
        });

        // Map codex's tool name to a stable lowercased variant the renderer
        // dispatches on (group-events.ts treats these as standalone groups
        // and tool-call-item.tsx routes them to CollabAgentDisplay).
        const toolNameByVariant: Record<string, string> = {
          spawnAgent: "spawnAgent",
          sendInput: "sendCollabInput",
          wait: "waitCollabAgent",
          closeAgent: "closeCollabAgent",
          resumeAgent: "resumeCollabAgent",
          sendMessage: "sendCollabMessage",
          followupTask: "followupCollabTask",
          interruptAgent: "interruptCollabAgent",
          listAgents: "listCollabAgents",
        };
        const toolName = toolNameByVariant[tool] ?? tool;

        const collabMeta = {
          toolCallId: item.id,
          itemId: item.id,
          codexItemType: "collab_agent_tool_call" as const,
          collabTool: tool,
          collabStatus: status,
          senderThreadId,
        };

        // Skip the in-flight `start` for wait/sendInput/close — they're noisy
        // (lots of repeat updates while the parent waits), and only the
        // completed state carries a useful sub-agent snapshot. SpawnAgent and
        // resumeAgent/followupTask keep the start: users see the lifecycle
        // transition right away,
        // and the projection layer only persists calls whose start it saw —
        // both variants must exist as rows to anchor subagent lifecycle
        // patches and child tool calls.
        if (
          phase === "start" &&
          (tool === "spawnAgent" ||
            tool === "resumeAgent" ||
            tool === "followupTask")
        ) {
          events.push({
            type: "tool_call",
            toolName,
            input: { prompt, model: collabModel, receiverThreadIds },
            startedAt: ts,
            metadata: { phase: "start", ...collabMeta },
          });
        } else if (phase === "complete") {
          const errorByVariant: Record<string, string> = {
            spawnAgent: "Spawn agent failed",
            sendInput: "Send input failed",
            wait: "Wait failed",
            closeAgent: "Close agent failed",
            resumeAgent: "Resume agent failed",
            sendMessage: "Send message failed",
            followupTask: "Follow-up task failed",
            interruptAgent: "Interrupt agent failed",
            listAgents: "List agents failed",
          };
          events.push({
            type: "tool_call",
            toolName,
            input: { prompt, model: collabModel, receiverThreadIds },
            output: { subAgents, prompt, model: collabModel, collabTool: tool },
            error: status === "failed" ? (errorByVariant[tool] ?? "Collab tool failed") : undefined,
            terminalStatus:
              status === "interrupted"
                ? "canceled"
                : status === "failed"
                  ? "error"
                  : "done",
            endedAt: ts,
            metadata: { phase: "complete", ...collabMeta },
          });

          // ── Subagent lifecycle projection ──
          // Mirror Claude's `subagent` events so run-session patches
          // `metadata.subagent` onto the spawning tool call — that patch is
          // what the session panel's subagent list keys on. spawnAgent (and
          // resumeAgent, for threads spawned outside this run) anchors the
          // sub-agent; terminal agentsStates snapshots from any variant
          // settle it.
          if (runStateCollab) {
            const anchorVariant =
              tool === "spawnAgent" ||
              tool === "resumeAgent" ||
              tool === "followupTask";
            if (anchorVariant && status === "completed") {
              for (const threadId of receiverThreadIds) {
                const existing = runStateCollab.subAgents.get(threadId);
                if (existing?.spawnItemId) {
                  // Resuming an agent that already settled this run re-arms
                  // its lifecycle on the ORIGINAL anchor: the row flips back
                  // to running and may settle again exactly once.
                  if (
                    (tool === "resumeAgent" || tool === "followupTask") &&
                    existing.terminalEmitted
                  ) {
                    existing.terminalEmitted = false;
                    existing.terminalPhase = undefined;
                    events.push({
                      type: "subagent",
                      phase: "running",
                      agentType: existing.nickname ?? existing.role ?? "agent",
                      agentId: threadId,
                      parentToolUseId: existing.spawnItemId,
                      ts,
                      metadata: { toolCallId: existing.spawnItemId, threadId },
                    });
                  }
                  continue;
                }
                const meta = {
                  ...existing,
                  threadId,
                  spawnItemId: item.id,
                  prompt,
                };
                runStateCollab.subAgents.set(threadId, meta);
                events.push({
                  type: "subagent",
                  phase: "invoked",
                  agentType: meta.nickname ?? meta.role ?? "agent",
                  agentId: threadId,
                  parentToolUseId: item.id,
                  prompt,
                  ts,
                  metadata: {
                    toolCallId: item.id,
                    threadId,
                    nickname: meta.nickname,
                    role: meta.role,
                    model: collabModel,
                  },
                });
              }
            }

            for (const [threadId, state] of Object.entries(agentsStates ?? {})) {
              if (!state?.status) continue;
              const meta = runStateCollab.subAgents.get(threadId);
              const terminalPhase = collabTerminalPhase(state.status);
              if (!meta || !terminalPhase) continue;
              const failed = terminalPhase === "failed";
              const settled = settleSubAgent(meta, threadId, terminalPhase, ts, {
                result: failed ? undefined : (state.message ?? meta.lastMessage),
                error: failed ? (state.message ?? "Sub-agent errored") : undefined,
                extraMetadata: { collabStatus: state.status },
              });
              if (settled) events.push(settled);
            }
          }
        }
        break;
      }

      case "error": {
        events.push({ type: "log", message: `[item_error] ${item.message ?? safeJson(item)}`, level: "error", ts, metadata: { itemId: item.id } });
        break;
      }

      default:
        if (phase === "complete") {
          events.push({ type: "log", message: `[codex:item:${item.type}] ${safeJson(item)}`, level: "info", ts });
        }
        break;
    }

    if (phase === "complete") {
      emitImageArtifacts(events, runId, item, ts);
    }
    // Document scan runs on every phase (start/update/complete): a command like
    // `qlmanage … report.docx` references a doc that already exists at start,
    // and the existence + dedup guards make repeat scans harmless.
    emitDocumentArtifacts(events, runId, item, ts);

    return events;
  }


  return {
    mapNotification,
    mapThreadItem,
    maybeResolveCollabSubAgents,
    flushUsage,
    discardRun(runId: string): void {
      usageAccumulator.delete(runId);
      usageSnapshots.delete(runId);
    },
    clear(): void {
      usageAccumulator.clear();
      usageSnapshots.clear();
    },
  };
}

export type CodexEventMapper = ReturnType<
  typeof createCodexEventMapper
>;
