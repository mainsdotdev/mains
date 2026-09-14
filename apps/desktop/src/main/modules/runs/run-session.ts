import { BrowserWindow, Notification, powerSaveBlocker } from "electron";

import {
  couldModifyFiles,
  type WorkRunEvent,
} from "../providers/adapters";
import type { WorkRunUsage, StopReason } from "../../../shared/adapter.types";
import type { RunExecutionContext } from "../../../shared/adapter.types";
import { runsRepo } from "./runs.repo";
import { providersService } from "../providers";
import { appSettingsService } from "../appSettings";
import {
  gitService,
  hashContent,
  buildPerFileDiffHashes,
  type DiffSnapshot,
} from "../git";
import {
  workspaceService,
  logWorkspaceActivity,
  recordWorkspaceDiff,
  clearWorkspaceDiff,
} from "../workspace";
import { createWorkAdapter } from "../providers/adapters";
import { runSessionRegistry } from "./run-session-registry";
import { emit } from "../../ipc-kit";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const LIVE_DIFF_DEBOUNCE_MS = 300;
const FORCE_FINALIZE_TIMEOUT_MS = 30_000;

/**
 * `metadata.task` statuses the provider has already resolved — the run-end
 * sweep leaves these alone. Mirrors `SubagentTaskMeta["status"]` in the
 * renderer's subagent-identity, minus the live ones (`pending`, `running`,
 * `paused` — a paused task cannot resume once the run's process is gone).
 */
const TERMINAL_TASK_STATUSES = new Set([
  "completed",
  "failed",
  "killed",
  "stopped",
]);

// ─────────────────────────────────────────────────────────────
// File-level utilities (pure)
// ─────────────────────────────────────────────────────────────

// Push a run event to all clients via the outbound event bus. The bus fans out
// to the local renderer today and to remote clients under `mains serve`.
function broadcastToWindows(channel: string, payload: unknown): void {
  emit(channel, payload);
}

// ─────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────

export interface RunSessionContext {
  runId: string;
  accountId: string;
  providerId: string;
  execution: RunExecutionContext;
  initialPromptContent: string;
  /** Defaults to -1 (fresh run). continueRun passes the recovered max turn index. */
  seedTurnIndex?: number;
}

export interface RunSessionResult {
  status: "succeeded" | "failed" | "canceled";
  summary?: string;
  stopReason?: StopReason | null;
  usage?: WorkRunUsage;
}

export interface RunSession {
  readonly runId: string;

  /**
   * Project an adapter event onto run state.
   * No-op after finalize. Tolerates out-of-order events by logging + dropping.
   */
  project(event: WorkRunEvent): Promise<void>;

  /**
   * Signal the adapter to abort this run.
   * Idempotent — only the first call signals. Schedules a 30s force-finalize
   * timer in case the adapter does not wind down.
   * Cleanup happens in finalize, not here.
   */
  abort(): Promise<void>;

   /**
   * Update the session's internal baseRef. Called by `gitFlowService.performCommit`
   * (the git-actions panel's commit) after a commit moves HEAD forward.
   *
   * Diff snapshots no longer depend on this — they read HEAD themselves, so a
   * commit made through any route is reflected. It survives as the fallback
   * anchor for a snapshot taken while HEAD is unreadable.
   *
   * No-op after finalize.
   */
  updateBaseRef(sha: string): void;

  /**
   * Single cleanup path for all terminal states. Idempotent.
   */
  finalize(result: RunSessionResult): Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────

export function createRunSession(ctx: RunSessionContext): RunSession {
  const { runId, accountId, providerId, execution } = ctx;
  const workspaceId = execution.workspaceId;

  // ─── Lifecycle flags ───
  let finalized = false;
  let aborting = false;
  let forceFinalizeTimer: NodeJS.Timeout | null = null;

  // ─── Per-run state (was 8 module-scope Maps in runs.service.ts) ───
  let baseRef: string | null = null;
  // Per-file diff hashes of the working tree as it stood at run start. Used at
  // finalize to report only files THIS run touched, so pre-existing dirty files
  // carried over from an earlier run aren't re-logged on every run.
  // null = baseline not captured (git error / not yet snapshotted); an empty Map
  // = captured a clean tree. persistFinalDiff treats these two cases differently.
  let initialDiffHashes: Map<string, string> | null = null;
  // Resolves when captureBaseRef finishes, so finalize can await the baseline
  // instead of racing it on near-instant runs.
  let baseRefCaptured: Promise<void> | null = null;
  let sleepBlockerId: number | null = null;
  let activeTurnId: number | null = null;
  let initialTurnReady: Promise<void> | null = null;
  let resolvedToolCallsReady: Promise<void> | null = null;
  let turnCounter: number = ctx.seedTurnIndex ?? -1;
  let liveDiffTimer: NodeJS.Timeout | null = null;
  let liveDiffInFlight = false;
  let liveDiffPending = false;
  const pendingToolCalls = new Map<string, number>();
  // callKey → DB tool call id, retained for the whole run. pendingToolCalls is
  // emptied on completion, but subagent and background-task events arrive AFTER
  // their tool call has settled (a backgrounded command reports its real result
  // once the foreground call already returned "running in background"), so they
  // need an anchor that outlives it.
  const resolvedToolCalls = new Map<string, number>();

  async function hydrateResolvedToolCalls(): Promise<void> {
    try {
      const calls = await runsRepo.findToolCallsByRun(runId);
      for (const call of calls) {
        if (call.toolId) {
          resolvedToolCalls.set(call.toolId, call.id);
        }
      }
    } catch (err) {
      console.error(
        `[RunSession ${runId}] Failed to hydrate tool-call anchors:`,
        err,
      );
    }
  }

  // ─── Broadcast helpers (channel names + payload shapes preserved exactly) ───
  function broadcastEventPersisted(): void {
    broadcastToWindows("runs:eventPersisted", { runId, ts: Date.now() });
  }
  function broadcastStatusChanged(status: string): void {
    broadcastToWindows("runs:statusChanged", { runId, status, ts: Date.now() });
  }
  function broadcastDiffUpdated(): void {
    if (!workspaceId) return;
    broadcastToWindows("runs:diffUpdated", { runId, workspaceId, ts: Date.now() });
  }
  function broadcastEphemeralEvent(event: unknown): void {
    broadcastToWindows("runs:ephemeralEvent", { runId, event, ts: Date.now() });
  }
  function broadcastContextUsage(event: Extract<WorkRunEvent, { type: "context_usage" }>): void {
    broadcastToWindows("runs:contextUsage", { runId, event, ts: Date.now() });
  }

  // ─── OS notification ───
  async function sendNotification(status: string): Promise<void> {
    try {
      const settings = await appSettingsService.getSettings();
      if (!settings.notifyOnRunComplete) return;
      const title = status === "succeeded" ? "Run Completed" : "Run Failed";
      const body = status === "succeeded" ? "Run finished successfully" : "Run failed";
      const notification = new Notification({ title, body });
      notification.on("click", () => {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          const win = windows[0];
          if (win.isMinimized()) win.restore();
          win.focus();
        }
      });
      notification.show();
    } catch (err) {
      console.error(`[RunSession ${runId}] Failed to send notification:`, err);
    }
  }

  // ─── Sleep blocker ───
  async function acquireSleepBlocker(): Promise<void> {
    try {
      const settings = await appSettingsService.getSettings();
      if (!settings.preventSleepDuringRuns) return;
      if (sleepBlockerId === null) {
        sleepBlockerId = powerSaveBlocker.start("prevent-app-suspension");
      }
    } catch (err) {
      console.error(`[RunSession ${runId}] Failed to acquire sleep blocker:`, err);
    }
  }
  function releaseSleepBlocker(): void {
    if (sleepBlockerId !== null && powerSaveBlocker.isStarted(sleepBlockerId)) {
      powerSaveBlocker.stop(sleepBlockerId);
    }
    sleepBlockerId = null;
  }

  // ─── Base ref capture ───
  async function captureBaseRef(): Promise<void> {
    if (!workspaceId) return;
    try {
      baseRef = await gitService.getHeadSha(execution.cwd);
    } catch {
      // Not a git repo or git error – ignore
      return;
    }
    // Snapshot the working tree's pre-existing changes against baseRef so
    // the final activity log reflects only what THIS run changed. Files
    // already dirty at run start are excluded unless this run touches them.
    try {
      const snapshot = await gitService.captureDiffSnapshot(
        execution.cwd,
        baseRef,
      );
      initialDiffHashes = buildPerFileDiffHashes(snapshot.diffText);
    } catch {
      // Leave initialDiffHashes null when the snapshot failed: an empty Map
      // means "tree was clean at start" (every later change is ours), whereas
      // null means "baseline unknown" — persistFinalDiff treats these
      // differently.
    }
  }

  // ─── Turn boundaries ───
  async function startNextTurn(promptContent?: string): Promise<void> {
    // Close any currently-active turn (no-op on the first call for a fresh run).
    if (activeTurnId !== null) {
      await closeActiveTurn();
    }
    try {
      const nextIndex = turnCounter + 1;
      const id = await runsRepo.insertTurn({
        runId,
        turnIndex: nextIndex,
        promptContent,
        startedAt: new Date(),
      });
      activeTurnId = id;
      turnCounter = nextIndex;
    } catch (err) {
      console.error(`[RunSession ${runId}] Failed to start turn:`, err);
    }
  }

  async function closeActiveTurn(usage?: WorkRunUsage): Promise<void> {
    if (activeTurnId === null) return;
    const turnId = activeTurnId;
    try {
      const now = new Date();
      const turns = await runsRepo.findTurnsByRun(runId);
      const activeTurn = turns.find((t) => t.id === turnId);
      const elapsedMs = activeTurn?.startedAt
        ? now.getTime() - new Date(activeTurn.startedAt).getTime()
        : undefined;
      await runsRepo.updateTurn(turnId, {
        endedAt: now,
        elapsedMs,
        status: "completed",
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        cacheReadTokens: usage?.cacheReadTokens,
        cacheWriteTokens: usage?.cacheWriteTokens,
        costMicros: usage?.totalCostUsd
          ? Math.round(usage.totalCostUsd * 1_000_000)
          : undefined,
        model: usage?.model,
        modelUsage: usage?.modelUsage,
      });
      activeTurnId = null;
    } catch (err) {
      console.error(`[RunSession ${runId}] Failed to close active turn:`, err);
    }
  }

  // ─── Tool call cleanup ───
  async function closePendingToolCalls(status: "done" | "error"): Promise<void> {
    if (pendingToolCalls.size === 0) return;
    const now = new Date();
    for (const [callKey, toolCallId] of pendingToolCalls) {
      try {
        await runsRepo.updateToolCall(toolCallId, { status, endedAt: now });
      } catch (err) {
        console.error(`[RunSession ${runId}] Failed to close orphaned tool call ${callKey}:`, err);
      }
    }
    pendingToolCalls.clear();
  }

  /**
   * Settle rows whose terminal lifecycle event never arrived.
   *
   * An aborted run tears the provider sink down before the settle
   * notifications are processed, and a spawn-style call (Codex) is already
   * "done" the moment the agent starts — so without this sweep the session
   * panel shows those agents running forever. The run's outcome stands in for
   * theirs: succeeded → completed, anything else → stopped.
   *
   * BOTH lifecycle keys are swept, because they are separate sources of
   * "still working" and a row can carry either one. `metadata.subagent` is a
   * spawn's own lifecycle; `metadata.task` is the CLI's task lifecycle, and it
   * is the ONLY liveness a SendMessage continuation or a backgrounded command
   * has — settling just the first left a resumed agent (whose live state moved
   * onto its continuation row) spinning forever after the run that resumed it
   * was stopped.
   */
  async function settleUnfinishedSubagents(
    runStatus: "succeeded" | "failed" | "canceled",
  ): Promise<void> {
    const settledState = runStatus === "succeeded" ? "completed" : "stopped";
    try {
      const calls = await runsRepo.findToolCallsByRun(runId);
      for (const call of calls) {
        const metadata = call.metadata as Record<string, unknown> | null;
        const subagent = metadata?.subagent as { phase?: string } | undefined;
        const task = metadata?.task as
          | { phase?: string; status?: string; error?: string }
          | undefined;
        const patch: Record<string, unknown> = {};

        if (subagent?.phase === "invoked" || subagent?.phase === "running") {
          patch.subagent = { phase: settledState, updatedAt: Date.now() };
        }
        // A task the provider already resolved — by status, by a completed
        // phase, or by failing — keeps its own outcome.
        if (
          task &&
          !task.error &&
          task.phase !== "completed" &&
          !TERMINAL_TASK_STATUSES.has(task.status ?? "")
        ) {
          patch.task = { status: settledState, updatedAt: Date.now() };
        }

        if (Object.keys(patch).length === 0) continue;
        await runsRepo.updateToolCall(call.id, { metadata: patch });
      }
    } catch (err) {
      console.error(`[RunSession ${runId}] Failed to settle subagents:`, err);
    }
  }

  /** Belt-and-suspenders: mark any DB-side tool calls still in "running" as ended. */
  async function closeRunningToolCallsInDb(status: "done" | "error"): Promise<void> {
    try {
      const calls = await runsRepo.findToolCallsByRun(runId);
      const now = new Date();
      for (const tc of calls) {
        if (tc.status !== "running") continue;
        try {
          await runsRepo.updateToolCall(tc.id, { status, endedAt: now });
        } catch (err) {
          console.error(`[RunSession ${runId}] Failed to close running tool call ${tc.id}:`, err);
        }
      }
    } catch (err) {
      console.error(`[RunSession ${runId}] Failed to load tool calls for cleanup:`, err);
    }
  }

  // ─── Diff snapshotting ───
  /**
   * Anchored to the CURRENT HEAD, not the run-start `baseRef`. The stored diff
   * means "what is not committed yet" everywhere else — intake captures against
   * HEAD, the commit tool re-captures against the post-commit HEAD, and
   * `resyncDiff` deliberately re-anchors to HEAD for exactly this reason. A run
   * that froze its own baseline was the one surface that disagreed: anything it
   * committed mid-run stayed inside `baseRef..workingTree`, so the sidebar and
   * the changed-files panel kept counting work that was already in history
   * while the session panel (live `git status`) had moved on.
   *
   * Reading HEAD per snapshot also covers commits this session never hears
   * about — a `git commit` the agent runs through Bash, or one made in a
   * terminal outside the app — neither of which reaches `updateBaseRef`.
   */
  async function snapshotCurrentDiff(): Promise<DiffSnapshot | null> {
    if (!workspaceId) return null;
    const head = await gitService.getHeadSha(execution.cwd).catch(() => null);
    // Fall back to the run-start sha only when HEAD is unreadable, so a git
    // hiccup degrades to the old behaviour instead of dropping the diff.
    const ref = head ?? baseRef;
    if (!ref) return null;
    return gitService
      .captureDiffSnapshot(execution.cwd, ref)
      .catch(() => null);
  }

  /**
   * Drop the workspace's latest diff row when the working tree is clean against
   * the current baseRef. Covers the case where the user committed externally
   * (or otherwise resolved changes) between runs, leaving a stale diff row
   * pointing at a now-merged baseRef.
   */
  async function clearStaleWorkspaceDiff(): Promise<void> {
    if (!workspaceId) return;
    if (await clearWorkspaceDiff(workspaceId)) {
      broadcastDiffUpdated();
    }
  }

  // ─── Live diff scheduler ───
  async function recomputeLiveDiff(): Promise<void> {
    if (!workspaceId) return;
    const snapshot = await snapshotCurrentDiff();
    if (!snapshot) return;
    if (snapshot.files.length === 0) {
      try {
        await clearStaleWorkspaceDiff();
      } catch (err) {
        console.error(`[RunSession ${runId}] clearStaleWorkspaceDiff failed:`, err);
      }
      return;
    }
    const existing = await workspaceService.getDiffByRun(runId);
    if (existing && hashContent(existing.diffText) === hashContent(snapshot.diffText)) {
      return;
    }
    try {
      await recordWorkspaceDiff(workspaceId, runId, snapshot);
      broadcastDiffUpdated();
    } catch (err) {
      console.error(`[RunSession ${runId}] recomputeLiveDiff failed:`, err);
    }
  }

  async function runLiveDiff(): Promise<void> {
    if (liveDiffInFlight) {
      liveDiffPending = true;
      return;
    }
    liveDiffInFlight = true;
    try {
      await recomputeLiveDiff();
    } finally {
      liveDiffInFlight = false;
      if (liveDiffPending) {
        liveDiffPending = false;
        void runLiveDiff();
      }
    }
  }

  function scheduleLiveDiff(): void {
    if (!workspaceId) return;
    if (liveDiffTimer) clearTimeout(liveDiffTimer);
    liveDiffTimer = setTimeout(() => {
      liveDiffTimer = null;
      void runLiveDiff();
    }, LIVE_DIFF_DEBOUNCE_MS);
  }

  function clearLiveDiffSchedule(): void {
    if (liveDiffTimer) {
      clearTimeout(liveDiffTimer);
      liveDiffTimer = null;
    }
    liveDiffPending = false;
  }

  // ─── Final diff persistence at completion ───
  async function persistFinalDiff(): Promise<void> {
    if (!workspaceId) return;
    clearLiveDiffSchedule();
    // Make sure the run-start baseline finished capturing before we diff against
    // it. Normally settled long ago; this only bites runs that finish almost
    // immediately, where the fire-and-forget capture could still be in flight
    // and leave initialDiffHashes transiently null.
    if (baseRefCaptured) {
      try {
        await baseRefCaptured;
      } catch {
        // captureBaseRef swallows its own errors; guard anyway.
      }
    }
    const snapshot = await snapshotCurrentDiff();
    if (!snapshot) return;
    if (snapshot.files.length === 0) {
      try {
        await clearStaleWorkspaceDiff();
      } catch (err) {
        console.error(`[RunSession ${runId}] clearStaleWorkspaceDiff failed:`, err);
      }
      return;
    }

    try {
      await recordWorkspaceDiff(workspaceId, runId, snapshot);
      broadcastDiffUpdated();

      // No reliable run-start baseline: null means "baseline unknown" (the git
      // snapshot at run start failed), distinct from an empty Map ("tree was
      // clean at start"). Without a baseline we can't separate this run's edits
      // from pre-existing dirt, so skip the activity entry rather than
      // mis-attributing carry-over changes. The diff above is still persisted.
      if (initialDiffHashes === null) return;

      // Report only files THIS run changed: compare the final per-file diff
      // hashes against the baseline captured at run start. Files already dirty
      // at run start and untouched here hash identically and are skipped, so a
      // no-op run over a pre-existing dirty tree logs nothing.
      const baseline = initialDiffHashes;
      const incrementalFileNames: string[] = [];
      for (const [file, hash] of buildPerFileDiffHashes(snapshot.diffText)) {
        if (baseline.get(file) !== hash) incrementalFileNames.push(file);
      }
      const incrementalFileCount = incrementalFileNames.length;

      if (incrementalFileCount > 0) {
        const summaryLines = incrementalFileNames.map((f) => f.split("/").pop() ?? f).join(", ");
        logWorkspaceActivity({
          workspaceId,
          type: "diff",
          title: `${incrementalFileCount} file${incrementalFileCount === 1 ? "" : "s"} changed`,
          summary: summaryLines,
          refId: runId,
          metadata: { files: incrementalFileCount, fileNames: incrementalFileNames },
        });
      }
    } catch (err) {
      console.error(`[RunSession ${runId}] persistFinalDiff failed:`, err);
    }
  }

  // ─── Projection rules (was handleRunEvent's switch in runs.service.ts) ───
  async function projectLog(event: Extract<WorkRunEvent, { type: "log" }>): Promise<void> {
    await runsRepo.insertArtifact({
      runId,
      kind: "log",
      content: event.message,
      // The driver's own metadata rides along so the renderer can tell one log
      // from another by what it is rather than by matching its wording; `level`
      // and `ts` stay authoritative.
      metadata: { ...event.metadata, level: event.level, ts: event.ts },
    });
    // Auto-generated title from provider (e.g. Codex CLI thread/name/updated)
    const threadTitle = (event.metadata as Record<string, unknown> | undefined)?.threadTitle as
      | string
      | undefined;
    if (threadTitle) {
      await runsRepo.updateRun(runId, { title: threadTitle });
    }
  }

  async function projectToolCall(
    event: Extract<WorkRunEvent, { type: "tool_call" }>,
  ): Promise<void> {
    const metadata = event.metadata as Record<string, unknown> | undefined;
    const phase = metadata?.phase;
    if (phase === "start") {
      const metadataToolCallId = metadata?.toolCallId;
      const parentToolUseId = metadata?.parentToolUseId;
      const toolCallId = await runsRepo.insertToolCall({
        accountId,
        runId,
        providerId,
        toolId: metadataToolCallId ? String(metadataToolCallId) : undefined,
        // Links a subagent's own tool calls back to the call that spawned the
        // subagent — the session panel's flow view filters on this column.
        parentToolCallId: parentToolUseId ? String(parentToolUseId) : undefined,
        toolName: event.toolName,
        status: "running",
        input: event.input,
        startedAt: event.startedAt ? new Date(event.startedAt) : new Date(),
      });
      const callKey = metadataToolCallId
        ? String(metadataToolCallId)
        : `${event.toolName}-${event.startedAt || Date.now()}`;
      pendingToolCalls.set(callKey, toolCallId);
      resolvedToolCalls.set(callKey, toolCallId);
      return;
    }
    if (phase === "end" || phase === "complete") {
      const metadataToolCallId = (event.metadata as Record<string, unknown> | undefined)?.toolCallId;
      let callKey: string | undefined;
      if (metadataToolCallId) {
        // Stable id present → match ONLY by exact id. The name-prefix fallback
        // below closes the wrong call when many same-named tools run in parallel
        // (e.g. a subagent reading 10 files), and a completion for an
        // already-resolved id (duplicate from hook + tool_result block) must be
        // a no-op rather than closing an unrelated pending call.
        callKey = String(metadataToolCallId);
      } else {
        // No id (legacy/partial providers): best-effort match the oldest pending
        // call with the same tool name.
        callKey = Array.from(pendingToolCalls.keys()).find((k) =>
          k.startsWith(`${event.toolName}-`),
        );
      }
      if (callKey && pendingToolCalls.has(callKey)) {
        const toolCallId = pendingToolCalls.get(callKey)!;
        pendingToolCalls.delete(callKey);
        const latencyMs =
          event.startedAt && event.endedAt ? event.endedAt - event.startedAt : undefined;
        await runsRepo.updateToolCall(toolCallId, {
          status: event.terminalStatus ?? (event.error ? "error" : "done"),
          input: event.input as Record<string, unknown> | undefined,
          output: event.output,
          error: event.error,
          endedAt: event.endedAt ? new Date(event.endedAt) : new Date(),
          latencyMs,
          metadata: event.metadata,
        });
      }
      // Live diff: if this tool could have touched the filesystem, schedule a recomputation.
      if (!event.error && couldModifyFiles(event.toolName)) {
        scheduleLiveDiff();
      }
    }
  }

  async function projectArtifact(
    event: Extract<WorkRunEvent, { type: "artifact" }>,
  ): Promise<boolean> {
    // Streaming chunks: push to renderer only, skip DB and the persisted-event broadcast.
    if (event.ephemeral) {
      broadcastEphemeralEvent({
        type: event.type,
        kind: event.kind,
        content: event.content,
        metadata: event.metadata,
        streamId: event.streamId,
      });
      return false;
    }

    await runsRepo.insertArtifact({
      runId,
      kind: event.kind as "patch" | "file" | "log" | "report" | "command_result" | "result",
      path: event.path,
      content: event.content,
      contentHash: event.content ? hashContent(event.content) : undefined,
      metadata: event.metadata,
    });

    // Turn boundary side-effects
    const artifactKind = (event.metadata as Record<string, unknown> | undefined)?.kind;
    if (artifactKind === "user-prompt") {
      await startNextTurn(event.content);
    }
    if (artifactKind === "result" && event.content && activeTurnId !== null) {
      try {
        await runsRepo.appendResponseContent(activeTurnId, event.content);
      } catch (err) {
        console.error(`[RunSession ${runId}] Failed to append response for turn ${activeTurnId}:`, err);
      }
    }
    return true;
  }

  /**
   * Attach provider detail to an existing tool call's metadata under `key`.
   *
   * updateToolCall merges metadata with json_patch, so repeated patches from
   * different owners accumulate instead of overwriting each other. Returns
   * false when the tool call is unknown — an Agent/task event whose spawning
   * call was never projected has nothing to attach to.
   */
  async function patchToolCallMetadata(
    toolUseId: string | undefined,
    key: "subagent" | "task",
    detail: Record<string, unknown>,
  ): Promise<boolean> {
    if (!toolUseId) return false;
    let toolCallId = resolvedToolCalls.get(toolUseId);
    if (toolCallId === undefined && resolvedToolCallsReady) {
      await resolvedToolCallsReady;
      toolCallId = resolvedToolCalls.get(toolUseId);
    }
    if (toolCallId === undefined) return false;
    // Drop undefined fields so a later partial patch cannot blank an earlier one.
    const clean = Object.fromEntries(
      Object.entries(detail).filter(([, v]) => v !== undefined),
    );
    await runsRepo.updateToolCall(toolCallId, { metadata: { [key]: clean } });
    return true;
  }

  async function projectSubagent(
    event: Extract<WorkRunEvent, { type: "subagent" }>,
  ): Promise<boolean> {
    return patchToolCallMetadata(event.parentToolUseId, "subagent", {
      phase: event.phase,
      agentType: event.agentType,
      agentId: event.agentId,
      prompt: event.prompt,
      result: event.result,
      error: event.error,
      // Terminal patches overwrite updatedAt, so the spawn moment gets its own
      // key — the panel derives "worked for Xs" from invokedAt → updatedAt.
      ...(event.phase === "invoked" ? { invokedAt: event.ts ?? Date.now() } : {}),
      updatedAt: event.ts ?? Date.now(),
    });
  }

  async function projectTask(
    event: Extract<WorkRunEvent, { type: "task" }>,
  ): Promise<boolean> {
    return patchToolCallMetadata(event.toolCallId, "task", {
      phase: event.phase,
      taskId: event.taskId,
      status: event.status,
      description: event.description,
      subagentType: event.subagentType,
      taskType: event.taskType,
      summary: event.summary,
      // Where a backgrounded command's real output landed. The run itself never
      // carries that output, so this path is the only handle on it.
      outputFile: event.outputFile,
      lastToolName: event.lastToolName,
      usage: event.usage,
      error: event.error,
      skipTranscript: event.skipTranscript,
      updatedAt: event.ts ?? Date.now(),
    });
  }

  async function projectPromptSuggestion(
    event: Extract<WorkRunEvent, { type: "prompt_suggestion" }>,
  ): Promise<void> {
    await runsRepo.insertArtifact({
      runId,
      kind: "prompt_suggestion",
      content: event.suggestion,
      metadata: { ts: event.ts },
    });
  }

  async function projectPlanUpdate(
    event: Extract<WorkRunEvent, { type: "plan_update" }>,
  ): Promise<boolean> {
    if (activeTurnId === null && initialTurnReady) {
      await initialTurnReady;
    }
    if (activeTurnId === null) {
      console.warn(
        `[RunSession ${runId}] Dropping plan update without an active turn`,
      );
      return false;
    }
    await runsRepo.patchTurnMetadata(activeTurnId, {
      codexPlan: {
        providerTurnId: event.providerTurnId,
        explanation: event.explanation,
        steps: event.steps,
        updatedAt: event.ts ?? Date.now(),
      },
    });
    return true;
  }

  // ─── Public methods ───
  async function project(event: WorkRunEvent): Promise<void> {
    if (finalized) return;
    let didPersist = false;
    switch (event.type) {
      case "log":
        await projectLog(event);
        didPersist = true;
        break;
      case "tool_call":
        await projectToolCall(event);
        didPersist = true;
        break;
      case "artifact":
        didPersist = await projectArtifact(event);
        break;
      case "prompt_suggestion":
        await projectPromptSuggestion(event);
        didPersist = true;
        break;
      case "plan_update":
        didPersist = await projectPlanUpdate(event);
        break;
      case "status":
        console.log(`[RunSession ${runId}] status event: ${event.status}`);
        break;
      case "context_usage":
        // Renderer-only live indicator; never persisted.
        broadcastContextUsage(event);
        break;
      case "subagent":
        didPersist = await projectSubagent(event);
        break;
      case "task":
        didPersist = await projectTask(event);
        break;
    }
    if (didPersist) broadcastEventPersisted();
  }

  function updateBaseRef(sha: string): void {
    if (finalized) return;
    baseRef = sha;
  }

  async function abort(): Promise<void> {
    if (finalized || aborting) return;
    aborting = true;
    try {
      const provider = await providersService.getById(providerId);
      if (provider) {
        const adapter = createWorkAdapter(provider);
        if (adapter.abortRun) await adapter.abortRun(runId);
      }
    } catch (err) {
      console.error(`[RunSession ${runId}] adapter.abortRun failed:`, err);
    }
    // Belt-and-suspenders: if adapter doesn't wind down, force-finalize.
    forceFinalizeTimer = setTimeout(() => {
      if (!finalized) {
        void finalize({
          status: "canceled",
          summary: "Forced abort: adapter did not wind down within timeout",
        });
      }
    }, FORCE_FINALIZE_TIMEOUT_MS);
  }

  async function finalize(result: RunSessionResult): Promise<void> {
    if (finalized) return;
    finalized = true;
    if (forceFinalizeTimer) {
      clearTimeout(forceFinalizeTimer);
      forceFinalizeTimer = null;
    }
    clearLiveDiffSchedule();

    const toolCallStatus = result.status === "succeeded" ? "done" : "error";

    try {
      // Persist diff before status flip — renderer polling sees status change
      // with the diff already available.
      if (result.status === "succeeded") {
        await persistFinalDiff();
      } else {
        baseRef = null;
      }

      await runsRepo.updateRun(runId, {
        status: result.status,
        endedAt: new Date(),
        lastError: result.status === "failed" ? result.summary : undefined,
        stopReason: result.stopReason ?? null,
      });

      await closeActiveTurn(result.usage);
      await closePendingToolCalls(toolCallStatus);
      await closeRunningToolCallsInDb(toolCallStatus);
      await settleUnfinishedSubagents(result.status);
    } catch (cleanupErr) {
      console.error(`[RunSession ${runId}] Cleanup failed:`, cleanupErr);
    } finally {
      releaseSleepBlocker();
      broadcastStatusChanged(result.status);
      broadcastEventPersisted();
      void sendNotification(result.status);
      runSessionRegistry.unregister(runId);
    }
  }

  // ─── Initialize ───
  const session: RunSession = { runId, project, abort, finalize, updateBaseRef };
  runSessionRegistry.register(runId, session);
  // Announce the live session, not just its terminal status. Clients that did
  // not start this run (another window, a remote client, the background-runs
  // dock) learn about it from this event — the DB row alone is invisible until
  // something refetches.
  broadcastStatusChanged("running");

  // Fire-and-forget initialization. Each helper handles its own errors.
  // Keep the baseRef-capture promise so finalize can await it (see persistFinalDiff).
  baseRefCaptured = captureBaseRef();
  void acquireSleepBlocker();
  resolvedToolCallsReady = hydrateResolvedToolCalls();
  initialTurnReady = resolvedToolCallsReady.then(() =>
    startNextTurn(ctx.initialPromptContent),
  );
  void initialTurnReady;

  return session;
}
