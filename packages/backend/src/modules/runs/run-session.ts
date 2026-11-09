import { insertRunInputArtifact } from "./run-input-artifact";
import { createToolCallProjection } from "./tool-call-projection";
import { createReportProjection } from "./report-projection";
import {
  couldModifyFiles,
  toolWrites,
  type WorkRunEvent,
} from "../providers/adapters";
import type { RunExecutionContext } from "../../../shared/adapter.types";
import { runsRepo } from "./runs.repo";
import { providersService } from "../providers";
import { appSettingsService } from "../appSettings";
import {
  gitService,
  hashContent,
  toWorktreePath,
  worktreeWrites,
  type DiffSnapshot,
  type WorktreeLocation,
} from "../git";
import { attributeTurnFiles } from "./turn-attribution";
import { createRunTurnLifecycle, type ClosedRunTurn, type TurnBaseline } from "./run-turn-lifecycle";
import {
  workspaceService,
  recordWorkspaceDiff,
  clearWorkspaceDiff,
  captureWorkspaceDiff,
  createWorkspaceDiffScheduler,
} from "../workspace";
import { createWorkAdapter } from "../providers/adapters";
import { runSessionRegistry } from "./run-session-registry";
import { createRunSessionLifecycle, type RunSessionPhase, type RunSessionResult } from "./run-lifecycle";
import { showRunFinishedNotification } from "./run-notification-sink";
import { emit } from "../../ipc-kit";
import type { TurnFileChange } from "./runs.dto";
import { getBackendRuntime } from "../../runtime/backend-runtime";
import { CHANNELS } from "@mains/contracts/channels";
import type { RunPullRequestCreatedEvent } from "@mains/contracts/runs";
import { createdPullRequestUrl, pullRequestCreationCommand } from "./created-pull-request";

export type { RunSessionResult } from "./run-lifecycle";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const LIVE_DIFF_DEBOUNCE_MS = 300;
const FORCE_FINALIZE_TIMEOUT_MS = 30_000;

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
  initialModel?: string;
  initialProviderTurnId?: string;
  /** Frozen at delegation, independent of whether the voice call stays open. */
  initialTurnMetadata?: {
    inputSource?: "voice";
    realtimeSessionId?: string;
    providerParentTurnId?: string;
    providerRootTurnId?: string;
  };
  /** Defaults to -1 (fresh run). continueRun passes the recovered max turn index. */
  seedTurnIndex?: number;
  /** Local file snapshots at the settled turn boundary; never waits for network. */
  onTurnClosed?: (runId: string) => Promise<void>;
}

export interface RunSession {
  readonly runId: string;
  /** Live ownership, independent of the persisted execution outcome. */
  readonly phase: RunSessionPhase;

  /**
   * Project an adapter event onto run state.
   * No-op after finalize; abort accepts only identified native input receipts.
   * Tolerates out-of-order events by logging + dropping.
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
   * Single cleanup path for all terminal states. Every caller awaits its completion.
   */
  finalize(result: RunSessionResult): Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────

export function createRunSession(ctx: RunSessionContext): RunSession {
  const { runId, accountId, providerId, execution } = ctx;
  const workspaceId = execution.workspaceId;

  const lifecycle = createRunSessionLifecycle();
  let finalization: Promise<void> | null = null;
  let forceFinalizeTimer: NodeJS.Timeout | null = null;

  // ─── Per-run state (was 8 module-scope Maps in runs.service.ts) ───
  let baseRef: string | null = null;
  // Resolves when the run-start HEAD capture finishes, so final diff fallback
  // can use it even when a near-instant run completes first.
  let baseRefCaptured: Promise<void> | null = null;
  let sleepBlockerId: number | null = null;
  const sessionStartedAt = Date.now();
  // The worktree this run shares with any parallel run; null without a
  // workspace or outside a git repo.
  const worktree: Promise<WorktreeLocation | null> = locateWorktree();
  const liveDiff = workspaceId ? createWorkspaceDiffScheduler(workspaceId, recomputeLiveDiff, LIVE_DIFF_DEBOUNCE_MS, execution.cwd) : null;
  const toolProjection = createToolCallProjection({ runId, accountId, providerId });
  // callKey → the files a running tool call named at start, claimed for the
  // turn only when it completes successfully (see noteToolWrites).
  const pendingToolWrites = new Map<string, string[]>();
  const pendingPrCreations = new Set<string>();
  const announcedPrUrls = new Set<string>();
  const reports = createReportProjection();
  const artifactProjections = new Set<Promise<boolean>>();
  const eventProjections = new Set<Promise<void>>();
  let projectionTail = Promise.resolve();
  const turns = createRunTurnLifecycle({
    seedIndex: ctx.seedTurnIndex ?? -1,
    captureTree: captureTurnTree,
    open: (turnIndex, promptContent) => runsRepo.insertTurn({ runId, turnIndex, promptContent, startedAt: new Date() }),
    async opened(id, initial) {
      if (!initial) return;
      if (ctx.initialModel) await runsRepo.updateTurn(id, { model: ctx.initialModel });
      if (ctx.initialProviderTurnId || ctx.initialTurnMetadata) {
        await runsRepo.patchTurnMetadata(id, {
          ...ctx.initialTurnMetadata,
          ...(ctx.initialProviderTurnId ? { providerTurnId: ctx.initialProviderTurnId } : {}),
        });
      }
    },
    close: persistClosedTurn,
  });

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
      showRunFinishedNotification(runId, status);
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
        sleepBlockerId = getBackendRuntime().powerInhibitor.start(
          "prevent-app-suspension",
        );
      }
    } catch (err) {
      console.error(`[RunSession ${runId}] Failed to acquire sleep blocker:`, err);
    }
  }
  function releaseSleepBlocker(): void {
    const powerInhibitor = getBackendRuntime().powerInhibitor;
    if (sleepBlockerId !== null && powerInhibitor.isStarted(sleepBlockerId)) {
      powerInhibitor.stop(sleepBlockerId);
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
    }
  }

  // ─── Turn changes ───
  /**
   * Snapshot the working tree as a git tree. Null when the run has no
   * workspace, the cwd is not a git repo, or the untracked-file guard trips —
   * that turn then simply gets no changes card. Async, so even a synchronous
   * throw lands in the same null instead of escaping into the turn lifecycle.
   */
  async function captureTurnTree(): Promise<string | null> {
    if (!workspaceId) return null;
    try {
      return await gitService.snapshotWorkingTree(execution.cwd);
    } catch (err) {
      console.warn(
        `[RunSession ${runId}] Working-tree snapshot skipped:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  async function locateWorktree(): Promise<WorktreeLocation | null> {
    if (!workspaceId) return null;
    try {
      return (await gitService.locateWorktree(execution.cwd)) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Note in the worktree's ledger the files a tool call may be writing, so a
   * parallel run's turn leaves them out, and return them (worktree-relative).
   * Recorded at start as well as at completion: a peer's turn can close
   * between a write and the event that reports it.
   *
   * A shell marks the active turn at once — it may still be writing when the
   * turn closes, and a failing command can still have written. Named files
   * are claimed for the turn by the caller, only once the write went through.
   */
  async function noteToolWrites(
    event: Extract<WorkRunEvent, { type: "tool_call" }>,
  ): Promise<string[]> {
    const location = await worktree;
    if (!location) return [];
    const writes = toolWrites(event.toolName, event.input);
    if (writes.paths.length === 0 && !writes.unnamed) return [];
    const paths: string[] = [];
    for (const toolPath of writes.paths) {
      const repoPath = toWorktreePath(location, execution.cwd, toolPath);
      if (repoPath) paths.push(repoPath);
    }
    if (writes.unnamed && turns.baseline) turns.baseline.writes.unnamed = true;
    worktreeWrites.record(
      location.topLevel,
      runId,
      { paths, unnamed: writes.unnamed },
      Date.now(),
    );
    return paths;
  }

  /**
   * Diff a turn's start and end trees and store the result against the turn.
   * Identical trees — every turn that only read — store nothing. When another
   * run was live in the worktree meanwhile, only this run's own files are kept
   * (see `attributeTurnFiles`).
   */
  async function persistTurnChanges(
    turnId: number,
    baseline: TurnBaseline | null,
    endTree: Promise<string | null>,
  ): Promise<void> {
    try {
      const [start, end] = await Promise.all([baseline?.tree, endTree]);
      if (!baseline || !start || !end || start === end) return;
      let diff = await gitService.diffTrees(execution.cwd, start, end);
      if (diff.files.length === 0) return;
      let files: TurnFileChange[] = diff.files;

      const location = await worktree;
      const peers = location
        ? worktreeWrites.peersSince(location.topLevel, runId, baseline.at)
        : null;
      if (peers?.concurrent) {
        const kept = attributeTurnFiles(diff.files, baseline.writes, peers);
        if (kept.length === 0) return;
        if (kept.length < diff.files.length) {
          diff = await gitService.diffTrees(
            execution.cwd,
            start,
            end,
            kept.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path])),
          );
        }
        const shared = new Set(kept.filter((f) => f.shared).map((f) => f.path));
        files = diff.files.map((f) => (shared.has(f.path) ? { ...f, shared: true } : f));
        if (files.length === 0) return;
      }

      await runsRepo.insertTurnChanges({
        runId,
        turnId,
        diffText: diff.diffText,
        files,
        additions: diff.additions,
        deletions: diff.deletions,
        truncated: diff.truncated,
      });
    } catch (err) {
      console.error(`[RunSession ${runId}] Failed to record turn changes:`, err);
    }
  }

  // ─── Turn boundaries ───
  async function persistClosedTurn({ id: turnId, baseline, endTree: turnEndTree, usage, outcome }:
    ClosedRunTurn): Promise<void> {
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
        costMicros: usage?.totalCostUsd !== undefined
          ? Math.round(usage.totalCostUsd * 1_000_000)
          : undefined,
        model: usage?.model,
        modelUsage: usage?.modelUsage,
      });
      if (ctx.initialTurnMetadata && outcome) await runsRepo.patchTurnMetadata(turnId, { outcome });
    } catch (err) {
      console.error(`[RunSession ${runId}] Failed to close active turn:`, err);
      throw err;
    }
    await persistTurnChanges(turnId, baseline, turnEndTree);
    try { await ctx.onTurnClosed?.(runId); }
    catch (error) { console.error(`[RunSession ${runId}] Could not snapshot Bridge outputs:`, error); }
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
    for (let attempt = 0; attempt < 3; attempt++) {
      const head = await gitService.getHeadSha(execution.cwd).catch(() => null);
      const ref = head ?? baseRef;
      if (!ref) return null;
      const snapshot = await gitService.captureDiffSnapshot(execution.cwd, ref).catch(() => null);
      if (!snapshot) return null;
      const currentHead = await gitService.getHeadSha(execution.cwd).catch(() => null);
      // The fallback can be read for compatibility, but an unreadable HEAD
      // cannot replace the workspace's last authoritative projection.
      if (!head || !currentHead) return null;
      if (currentHead === head) return snapshot;
    }
    return null;
  }

  /**
   * Drop the workspace's latest diff row when the working tree is clean against
   * the current baseRef. Covers the case where the user committed externally
   * (or otherwise resolved changes) between runs, leaving a stale diff row
   * pointing at a now-merged baseRef.
   */
  async function clearStaleWorkspaceDiff(current: () => boolean): Promise<void> {
    if (!workspaceId) return;
    if (await clearWorkspaceDiff(workspaceId, current)) {
      broadcastDiffUpdated();
    }
  }

  // ─── Live diff scheduler ───
  async function recomputeLiveDiff(current: () => boolean): Promise<void> {
    if (!workspaceId || !lifecycle.acceptsEvents) return;
    const snapshot = await snapshotCurrentDiff();
    if (!snapshot || !lifecycle.acceptsEvents || !current()) return;
    if (snapshot.files.length === 0) {
      try {
        await clearStaleWorkspaceDiff(current);
      } catch (err) {
        console.error(`[RunSession ${runId}] clearStaleWorkspaceDiff failed:`, err);
      }
      return;
    }
    const existing = await workspaceService.getDiffByRun(runId);
    if (!lifecycle.acceptsEvents) return;
    if (existing && hashContent(existing.diffText) === hashContent(snapshot.diffText)) {
      return;
    }
    try {
      await recordWorkspaceDiff(workspaceId, runId, snapshot, current);
      broadcastDiffUpdated();
    } catch (err) {
      console.error(`[RunSession ${runId}] recomputeLiveDiff failed:`, err);
    }
  }

  function scheduleLiveDiff(): void {
    if (lifecycle.acceptsEvents) liveDiff?.schedule();
  }

  function clearLiveDiffSchedule(): void { liveDiff?.cancel(); }

  // ─── Final diff persistence at completion ───
  async function persistFinalDiff(): Promise<void> {
    if (!workspaceId) return;
    clearLiveDiffSchedule();
    // Join the initial baseline read before capturing the final projection.
    if (baseRefCaptured) {
      try {
        await baseRefCaptured;
      } catch {
        // captureBaseRef swallows its own errors; guard anyway.
      }
    }
    try {
      await captureWorkspaceDiff(workspaceId, async (current) => {
        const snapshot = await snapshotCurrentDiff();
        if (!snapshot || !current()) return;
        if (snapshot.files.length === 0) {
          try {
            await clearStaleWorkspaceDiff(current);
          } catch (err) {
            console.error(`[RunSession ${runId}] clearStaleWorkspaceDiff failed:`, err);
          }
          return;
        }

        try {
          await recordWorkspaceDiff(workspaceId, runId, snapshot, current);
          broadcastDiffUpdated();
        } catch (err) {
          console.error(`[RunSession ${runId}] persistFinalDiff failed:`, err);
        }
      }, execution.cwd);
    } catch (error) { console.error(`[RunSession ${runId}] Final diff capture unavailable:`, error); }
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
  ): Promise<boolean> {
    await turns.ready;
    const result = await toolProjection.project(event, turns.id);
    const callKey = result.key;
    if (result.transition === "unchanged") return false;
    if (result.transition === "started") {
      if (pullRequestCreationCommand(event)) pendingPrCreations.add(callKey!);
      const named = await noteToolWrites(event);
      if (named.length > 0) pendingToolWrites.set(callKey!, named);
      return true;
    }
    const wasPrCreation = callKey && pendingPrCreations.delete(callKey);
    if (wasPrCreation) {
      const url = createdPullRequestUrl(event);
      if (url && !announcedPrUrls.has(url)) {
        announcedPrUrls.add(url);
        const run = await runsRepo.findRunById(runId);
        if (run) {
          const payload: RunPullRequestCreatedEvent = {
            runId, toolCallId: result.id!, url, mode: run.mode, workspaceId: run.workspaceId,
          };
          emit(CHANNELS.runs.pullRequestCreated, payload, { runId, workspaceId: run.workspaceId ?? undefined });
        }
      }
    }
    if (!event.error && couldModifyFiles(event.toolName)) scheduleLiveDiff();
    const namedAtStart = (callKey && pendingToolWrites.get(callKey)) || [];
    if (callKey) pendingToolWrites.delete(callKey);
    const named = await noteToolWrites(event);
    const wrote = !event.error && (event.terminalStatus ?? "done") === "done";
    if (wrote && turns.baseline) {
      for (const repoPath of [...namedAtStart, ...named]) turns.baseline.writes.paths.add(repoPath);
    }
    return true;
  }

  async function projectArtifact(
    event: Extract<WorkRunEvent, { type: "artifact" }>,
  ): Promise<boolean> {
    // Streaming chunks: push to renderer only, skip DB and the persisted-event broadcast.
    if (event.ephemeral) {
      // A queued prompt boundary may still be preparing. Let ordered final
      // projection assign a new stream's turn instead of freezing the old one.
      event = reports.stream(event, eventProjections.size ? null : turns.id);
      broadcastEphemeralEvent({
        type: event.type,
        kind: event.kind,
        content: event.content,
        metadata: event.metadata,
        streamId: event.streamId,
      });
      return false;
    }

    await turns.ready;
    event = reports.prepare(event);
    if (reports.completed(event)) return false;
    event = { ...event, metadata: { ...event.metadata, turnId: event.metadata?.turnId ?? turns.id } };
    // A Claude send that missed the previous native turn can already have
    // started a new one. Deduplicate it before opening its boundary, and stamp
    // the accepted prompt with the new turn rather than the one it just closed.
    const artifactKind = event.metadata?.kind;
    const startsTurn = event.metadata?.delivery !== "steer" &&
      (event.kind === "user-prompt" && event.metadata?.delivery === "queue" || artifactKind === "user-prompt");
    if (!await insertRunInputArtifact(runId, event, startsTurn ? async () => {
      const inputId = event.metadata?.clientUserMessageId;
      const turnId = await turns.start(event.content, typeof inputId === "string" ? inputId : undefined);
      event = { ...event, metadata: { ...event.metadata, turnId } };
      return event;
    } : undefined)) return false;
    reports.commit(event);

    if (event.kind === "user-prompt") {
      const resolvedModel =
        typeof event.metadata?.model === "string"
          ? event.metadata.model.trim()
          : "";
      if (resolvedModel) {
        // The core emits the prompt as soon as acquisition resolves, which can
        // race the fire-and-forget initial turn insert in this constructor.
        await turns.ready;
        const turnId = typeof event.metadata?.turnId === "number" ? event.metadata.turnId : turns.id;
        if (turnId !== null) {
          await runsRepo.updateTurn(turnId, { model: resolvedModel });
        }
      }
    }
    if (artifactKind === "result" && event.content && turns.id !== null) {
      try {
        await runsRepo.appendResponseContent(turns.id, event.content);
      } catch (err) {
        console.error(`[RunSession ${runId}] Failed to append response for turn ${turns.id}:`, err);
      }
    }
    return true;
  }

  async function projectPromptSuggestion(
    event: Extract<WorkRunEvent, { type: "prompt_suggestion" }>,
  ): Promise<void> {
    await runsRepo.insertArtifact({
      runId,
      kind: "prompt_suggestion",
      // Content is what gets sent; the label is only what the chip reads.
      content: event.suggestion,
      metadata: { ts: event.ts, ...(event.label ? { label: event.label } : {}) },
    });
  }

  async function projectPlanUpdate(
    event: Extract<WorkRunEvent, { type: "plan_update" }>,
  ): Promise<boolean> {
    await turns.ready;
    if (turns.id === null) {
      console.warn(
        `[RunSession ${runId}] Dropping plan update without an active turn`,
      );
      return false;
    }
    await runsRepo.patchTurnMetadata(turns.id, {
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
  function trackProjection(work: Promise<void>): Promise<void> {
    const projection = work.finally(() => { eventProjections.delete(projection); });
    eventProjections.add(projection);
    return projection;
  }

  function project(event: WorkRunEvent): Promise<void> {
    if (!lifecycle.accepts(event)) return Promise.resolve();
    if (event.type === "context_usage" || event.type === "artifact" && event.ephemeral) {
      return trackProjection(projectEvent(event));
    }
    if (event.type === "artifact") event = reports.prepare(event);
    // Preserve admitted event order even when SDK listeners do not await us.
    // A failed write rejects its caller without poisoning subsequent events.
    const projection = projectionTail.then(() => projectEvent(event));
    projectionTail = projection.catch(() => {});
    return trackProjection(projection);
  }

  async function projectEvent(event: WorkRunEvent): Promise<void> {
    let didPersist = false;
    switch (event.type) {
      case "log":
        await projectLog(event);
        didPersist = true;
        break;
      case "tool_call":
        didPersist = await projectToolCall(event);
        break;
      case "artifact":
        {
          const projection = projectArtifact(event);
          artifactProjections.add(projection);
          try {
            didPersist = await projection;
          } finally {
            artifactProjections.delete(projection);
          }
        }
        break;
      case "prompt_suggestion":
        await projectPromptSuggestion(event);
        didPersist = true;
        break;
      case "plan_update":
        didPersist = await projectPlanUpdate(event);
        break;
      case "message_phase":
        // SDK listeners may publish the result before an earlier text insert
        // finishes. Update the existing rows, preserving their identity/order.
        await Promise.all([...artifactProjections]);
        didPersist = await runsRepo.setReportMessagePhase(runId, event.messageId, event.phase);
        break;
      case "status":
        console.log(`[RunSession ${runId}] status event: ${event.status}`);
        break;
      case "context_usage":
        // Renderer-only live indicator; never persisted.
        broadcastContextUsage(event);
        break;
      case "subagent":
        didPersist = await toolProjection.projectLifecycle(event);
        break;
      case "task":
        didPersist = await toolProjection.projectLifecycle(event);
        break;
    }
    if (didPersist) broadcastEventPersisted();
  }

  function updateBaseRef(sha: string): void {
    if (!lifecycle.acceptsEvents) return;
    baseRef = sha;
  }

  async function abort(): Promise<void> {
    if (!lifecycle.abort()) return;
    clearLiveDiffSchedule();
    // Arm before awaiting the provider: even a stuck interrupt must time out.
    forceFinalizeTimer = setTimeout(() => {
      void finalize({
        status: "canceled",
        summary: "Forced abort: adapter did not wind down within timeout",
      });
    }, FORCE_FINALIZE_TIMEOUT_MS);
    forceFinalizeTimer.unref();
    try {
      const provider = await providersService.getById(providerId);
      if (provider) {
        const adapter = createWorkAdapter(provider);
        if (adapter.abortRun) await adapter.abortRun(runId);
      }
    } catch (err) {
      console.error(`[RunSession ${runId}] adapter.abortRun failed:`, err);
    }
  }

  function finalize(result: RunSessionResult): Promise<void> {
    if (finalization) return finalization;
    const settled = lifecycle.finalize(result);
    if (!settled) return Promise.resolve();
    finalization = finish(settled);
    return finalization;
  }

  async function finish(result: RunSessionResult): Promise<void> {
    if (forceFinalizeTimer) {
      clearTimeout(forceFinalizeTimer);
      forceFinalizeTimer = null;
    }
    clearLiveDiffSchedule();

    try {
      // Accepted events own their writes until settlement, including tools and
      // logs. Cleanup must see them before closing orphan calls or the run row.
      await Promise.allSettled([...eventProjections]);
      for (const report of reports.pending()) {
        if (!report.content?.trim()) continue;
        try {
          await projectArtifact({
            ...report,
            ephemeral: false,
            metadata: {
              ...report.metadata,
              streaming: false,
              interrupted: result.status !== "succeeded",
            },
          });
        } catch (err) {
          console.error(`[RunSession ${runId}] Failed to preserve streamed report:`, err);
        }
      }
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

      try {
        await turns.ready.catch(() => {});
        await turns.finish(result.usage, result.status);
      } finally {
        await toolProjection.settle(result.status);
      }
    } catch (cleanupErr) {
      console.error(`[RunSession ${runId}] Cleanup failed:`, cleanupErr);
    } finally {
      // After the last turn's changes are stored: that turn asked the ledger
      // about peers, and closing may prune what it needed.
      const endedAt = Date.now();
      void worktree.then((location) => {
        if (location) worktreeWrites.close(location.topLevel, runId, endedAt);
      });
      releaseSleepBlocker();
      broadcastStatusChanged(result.status);
      broadcastEventPersisted();
      void sendNotification(result.status);
      lifecycle.close();
      runSessionRegistry.unregister(runId, session);
    }
  }

  // ─── Initialize ───
  // Publish only after the turn barrier exists: event sinks can project back
  // into this session synchronously while handling the running announcement.
  void turns.initialize(toolProjection.ready, ctx.initialPromptContent)
    .catch((error) => console.error(`[RunSession ${runId}] Initial projection failed:`, error));
  const session: RunSession = { runId, get phase() { return lifecycle.phase; }, project, abort, finalize, updateBaseRef };
  runSessionRegistry.register(runId, session);
  // Announce the live session, not just its terminal status. Clients that did
  // not start this run (another window, a remote client, the background-runs
  // dock) learn about it from this event — the DB row alone is invisible until
  // something refetches.
  broadcastStatusChanged("running");

  // Fire-and-forget initialization. Each helper handles its own errors.
  // The first turn's baseline goes first: it has to predate the agent's first
  // write, and the adapter starts as soon as this factory returns.
  // Live in the worktree from the moment the first baseline was taken, so a
  // parallel run's turn that overlaps this one knows to sort their files.
  void worktree.then((location) => {
    if (location) worktreeWrites.open(location.topLevel, runId, sessionStartedAt);
  });
  // Keep the baseRef-capture promise so finalize can await it (see persistFinalDiff).
  baseRefCaptured = captureBaseRef();
  void acquireSleepBlocker();
  if (ctx.initialTurnMetadata) {
    // The renderer can show delegated work before the first message or tool.
    // The running notification above precedes this turn's asynchronous insert.
    void turns.ready.then(() => {
      if (turns.id !== null) broadcastEventPersisted();
    }).catch(() => {});
  }

  return session;
}
