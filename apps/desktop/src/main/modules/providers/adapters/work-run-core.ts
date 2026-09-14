// ─────────────────────────────────────────────────────────────
// WorkRunCore — shared lifecycle for every ProviderDriver.
//
// `createWorkRunAdapter(driver)` returns a WorkRunAdapter that wraps the
// driver in the cross-cutting bits every provider needs: status emission,
// per-run state map, AbortController plumbing, artifact collection, sessionId
// persistence, cleanup, and 1:1 delegation of the optional methods.
//
// What lives here, what lives in the driver:
//
//   Core                                   Driver
//   ────────────────────────────────       ────────────────────────────────
//   runId → { session, controller }        SDK handle, streaming buffers
//   status emission ("running" + final)    SDK message → WorkRunEvent mapping
//   artifact accumulation                  buildPrompt
//   user-prompt artifact emission          stop reason → status mapping
//   sessionId → runsRepo persist           tool approval / hooks plumbing
//   abortRun → controller.abort()          honouring AbortSignal
//   cleanup ordering (driver.cleanup,      long-lived per-provider resources
//     cancelPendingRequests)                 (CLI subprocess, ACP server, …)
// ─────────────────────────────────────────────────────────────

import { runsRepo } from "../../runs/runs.repo";
import { cancelPendingRequests } from "../../runs/user-input-broker";
import { emitUserPromptArtifact } from "./adapter.shared";
import type {
  AcquiredSession,
  ProviderDriver,
  WorkRunAdapter,
  WorkRunContinueRequest,
  WorkRunEvent,
  WorkRunEventHandler,
  WorkRunForkRequest,
  WorkRunRequest,
  WorkRunResult,
  WorkRunReviewRequest,
  WorkRunArtifactSummary,
} from "../../../../shared/adapter.types";

interface RunSlot {
  session: unknown;
  controller: AbortController;
}

/**
 * Live runs, keyed by runId — module scope, NOT per adapter instance.
 *
 * A settings write no longer rebuilds the adapter (the factory refreshes the
 * cached instance's config in place), but an adapter can still be replaced
 * mid-run — `shutdownWorkAdapter`, a provider disable/enable cycle, tests.
 * Instance-local bookkeeping would leave the in-flight run unreachable through
 * the new instance: `abortRun` would resolve silently while the driver kept
 * working. Run ids are globally unique and every entry is removed in
 * `runLifecycle`'s finally, so keying them here makes control reach a run
 * regardless of which instance owns it.
 */
const runState = new Map<string, RunSlot>();

/** Union of the request types that carry user-prompt content. */
type UserPromptRequest =
  | WorkRunRequest
  | WorkRunContinueRequest
  | WorkRunForkRequest;

function getUserPromptContent(req: UserPromptRequest): string {
  return "goal" in req ? req.goal : req.message;
}

export function createWorkRunAdapter(driver: ProviderDriver): WorkRunAdapter {
  /** Wrap the caller's onEvent so Core can observe and enrich every event. */
  function wrapOnEvent(
    onEvent: WorkRunEventHandler,
    collected: WorkRunArtifactSummary[],
  ): WorkRunEventHandler {
    return async (event: WorkRunEvent) => {
      // Skip user-prompt — Core emits it itself and it isn't a model output.
      if (
        event.type === "artifact" &&
        !event.ephemeral &&
        event.kind !== "user-prompt"
      ) {
        collected.push({ kind: event.kind, path: event.path });
      }
      // Tool-call events carry startedAt/endedAt instead of ts; leave those alone.
      const carriesTs = event.type !== "tool_call";
      const enriched =
        carriesTs && !(event as { ts?: number }).ts
          ? ({ ...event, ts: Date.now() } as WorkRunEvent)
          : event;
      await onEvent(enriched);
    };
  }

  async function persistSessionId(
    runId: string,
    sessionId: string | undefined,
  ): Promise<void> {
    if (!sessionId) return;
    try {
      await runsRepo.updateRun(runId, { sessionId });
    } catch (err) {
      console.warn(`[WorkRunCore] Failed to persist sessionId for ${runId}:`, err);
    }
  }

  async function runLifecycle(
    runId: string,
    acquire: () => Promise<AcquiredSession>,
    userPromptReq: UserPromptRequest | null,
    onEvent: WorkRunEventHandler,
  ): Promise<WorkRunResult> {
    const collected: WorkRunArtifactSummary[] = [];
    const controller = new AbortController();
    const wrapped = wrapOnEvent(onEvent, collected);

    try {
      await wrapped({ type: "status", status: "running" });

      const acquired = await acquire();
      runState.set(runId, { session: acquired.session, controller });
      await persistSessionId(runId, acquired.sessionId);

      if (userPromptReq) {
        // The three UserPromptRequest variants all carry these fields, but TS
        // can't see it through the discriminated union — access generically.
        const r = userPromptReq as WorkRunRequest;
        await emitUserPromptArtifact(wrapped, getUserPromptContent(userPromptReq), {
          attachments: r.attachments,
          contextIssues: r.contextIssues,
          contextSignals: r.contextSignals,
          contextFiles: r.contextFiles,
          contextSkills: r.skills,
        });
      }

      const outcome = await driver.executePrompt(
        acquired.session,
        acquired.prompt,
        wrapped,
        controller.signal,
      );

      await wrapped({
        type: "status",
        status: outcome.status,
        error: outcome.summary,
      });

      return {
        status: outcome.status,
        summary: outcome.summary,
        stopReason: outcome.stopReason,
        artifacts: collected,
        usage: outcome.usage,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await onEvent({
        type: "status",
        status: "failed",
        error: msg,
        ts: Date.now(),
      });
      return { status: "failed", summary: msg };
    } finally {
      const slot = runState.get(runId);
      if (slot) {
        try {
          await driver.cleanup?.(slot.session);
        } catch (err) {
          console.warn(`[WorkRunCore] cleanup threw for ${runId}:`, err);
        }
        runState.delete(runId);
      }
      cancelPendingRequests(runId);
    }
  }

  const adapter: WorkRunAdapter = {
    startRun(request, onEvent) {
      return runLifecycle(
        request.runId,
        () => driver.createSession(request),
        request,
        onEvent,
      );
    },
    abortRun: async (runId: string) => {
      const slot = runState.get(runId);
      if (!slot) {
        // Resolving silently here is what let a failed stop look like a
        // successful one; the caller can only fall back to its force-finalize
        // timer, which marks the run canceled while the driver keeps going.
        console.warn(
          `[WorkRunCore] abortRun: no live run "${runId}" — nothing to abort`,
        );
        return;
      }
      slot.controller.abort();
    },
  };

  if (driver.resumeSession) {
    const resume = driver.resumeSession.bind(driver);
    adapter.continueRun = (request, onEvent) =>
      runLifecycle(request.runId, () => resume(request), request, onEvent);
  }

  if (driver.forkSession) {
    const fork = driver.forkSession.bind(driver);
    adapter.forkRun = (request, onEvent) =>
      runLifecycle(request.runId, () => fork(request), request, onEvent);
  }

  if (driver.reviewSession) {
    const review = driver.reviewSession.bind(driver);
    adapter.reviewRun = (request: WorkRunReviewRequest, onEvent) =>
      runLifecycle(request.runId, () => review(request), null, onEvent);
  }

  // 1:1 delegation for optional pass-through methods
  if (driver.updateConfig)
    adapter.updateConfig = driver.updateConfig.bind(driver);
  if (driver.shutdown) adapter.shutdown = driver.shutdown.bind(driver);
  if (driver.canResumeSession)
    adapter.canResumeSession = driver.canResumeSession.bind(driver);
  if (driver.archiveSession)
    adapter.archiveSession = driver.archiveSession.bind(driver);
  if (driver.unarchiveSession)
    adapter.unarchiveSession = driver.unarchiveSession.bind(driver);
  if (driver.deleteSession)
    adapter.deleteSession = driver.deleteSession.bind(driver);
  if (driver.listModels) adapter.listModels = driver.listModels.bind(driver);
  if (driver.listCommands)
    adapter.listCommands = driver.listCommands.bind(driver);
  if (driver.listSkills) adapter.listSkills = driver.listSkills.bind(driver);
  if (driver.generateTitle)
    adapter.generateTitle = driver.generateTitle.bind(driver);
  if (driver.generateText)
    adapter.generateText = driver.generateText.bind(driver);
  if (driver.getRateLimits)
    adapter.getRateLimits = driver.getRateLimits.bind(driver);
  if (driver.setGoal) adapter.setGoal = driver.setGoal.bind(driver);
  if (driver.getGoal) adapter.getGoal = driver.getGoal.bind(driver);
  if (driver.clearGoal) adapter.clearGoal = driver.clearGoal.bind(driver);
  if (driver.getAccountInfo)
    adapter.getAccountInfo = driver.getAccountInfo.bind(driver);
  if (driver.updateCli) adapter.updateCli = driver.updateCli.bind(driver);
  if (driver.listPlugins) adapter.listPlugins = driver.listPlugins.bind(driver);
  if (driver.listInstalledPlugins)
    adapter.listInstalledPlugins = driver.listInstalledPlugins.bind(driver);
  if (driver.readPlugin) adapter.readPlugin = driver.readPlugin.bind(driver);
  if (driver.installPlugin)
    adapter.installPlugin = driver.installPlugin.bind(driver);
  if (driver.uninstallPlugin)
    adapter.uninstallPlugin = driver.uninstallPlugin.bind(driver);
  if (driver.setPluginEnabled)
    adapter.setPluginEnabled = driver.setPluginEnabled.bind(driver);
  if (driver.updatePlugin)
    adapter.updatePlugin = driver.updatePlugin.bind(driver);

  return adapter;
}
