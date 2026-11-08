// ─────────────────────────────────────────────────────────────
// WorkRunCore — shared lifecycle for every ProviderDriver.
//
// `createWorkRunAdapter(driver)` returns a WorkRunAdapter that wraps the
// driver in the cross-cutting bits every provider needs: status emission,
// per-run state map, AbortController plumbing, artifact collection, sessionId
// persistence, cleanup, shared shutdown, and delegation of capability methods.
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

import { abortWorkRun, createWorkRunLifecycle } from "./work-run-lifecycle";
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

/** Union of the request types that carry user-prompt content. */
type UserPromptRequest =
  | WorkRunRequest
  | WorkRunContinueRequest
  | WorkRunForkRequest;

function getUserPromptContent(req: UserPromptRequest): string {
  return "goal" in req ? req.goal : req.message;
}

export function createWorkRunAdapter(driver: ProviderDriver): WorkRunAdapter {
  const lifecycle = createWorkRunLifecycle({
    cleanup: driver.cleanup?.bind(driver), cancelRequests: cancelPendingRequests,
    shutdown: driver.shutdown?.bind(driver),
  });
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
    acquire: (publish: WorkRunEventHandler, receipt: (work: () => Promise<void>) => Promise<void>) => Promise<AcquiredSession>,
    userPromptReq: UserPromptRequest | null,
    onEvent: WorkRunEventHandler,
  ): Promise<WorkRunResult> {
    const collected: WorkRunArtifactSummary[] = [];
    let lease: ReturnType<typeof lifecycle.claim> | undefined;
    const deliver = wrapOnEvent(onEvent, collected);
    const wrapped: WorkRunEventHandler = (event) => lease!.publish(event, () => deliver(event));

    try {
      lease = lifecycle.claim(runId);
      await wrapped({ type: "status", status: "running" });
      lease.assertActive();
      const acquired = await acquire(wrapped, lease.receipt);
      lease.acquired(acquired.session);
      lease.assertActive();
      await persistSessionId(runId, acquired.sessionId);
      lease.assertActive();

      if (userPromptReq && !("clientUserMessageId" in userPromptReq && userPromptReq.clientUserMessageId && driver.steerRun)) {
        // The three UserPromptRequest variants all carry these fields, but TS
        // can't see it through the discriminated union — access generically.
        const r = userPromptReq as WorkRunRequest;
        await emitUserPromptArtifact(wrapped, getUserPromptContent(userPromptReq), {
          attachments: r.attachments,
          context: r.context,
          contextIssues: r.contextIssues,
          contextSignals: r.contextSignals,
          contextFiles: r.contextFiles,
          contextSkills: r.skills,
          runId,
          clientPromptId: r.clientPromptId,
          providerTurnLineage: r.providerTurnLineage,
          // Only publish a provider-resolved model here. Requested values may
          // be aliases (for example `sonnet` → `claude-sonnet-5`) and would
          // create a false model-change marker until final usage canonicalizes
          // the turn. Providers without an acquisition result fill this from
          // final usage instead.
          model: acquired.model,
        });
      }

      lease.execute();
      const outcome = await lease.complete(await driver.executePrompt(
        acquired.session,
        acquired.prompt,
        wrapped,
        lease.signal,
      ));

      await lease.terminal(() => deliver({ type: "status", status: outcome.status, error: outcome.summary }));

      return {
        status: outcome.status,
        summary: outcome.summary,
        stopReason: outcome.stopReason,
        artifacts: collected,
        usage: outcome.usage,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const outcome = lease ? await lease.complete({ status: "failed", summary: msg }) : { status: "failed" as const, summary: msg };
      if (lease) await lease.terminal(() => deliver({ type: "status", status: outcome.status, error: outcome.summary }));
      return outcome;
    } finally {
      if (lease) {
        try { await lease.close(); }
        catch (error) { console.warn(`[WorkRunCore] cleanup threw for ${runId}:`, error); }
        lease.finished();
      }
    }
  }

  const adapter: WorkRunAdapter = {
    shutdown: lifecycle.shutdown,
    startRun(request, onEvent) {
      return runLifecycle(
        request.runId,
        () => driver.createSession(request),
        request,
        onEvent,
      );
    },
    abortRun: async (runId: string) => {
      if (await abortWorkRun(runId)) return;
      if (driver.abortNativeRun) await driver.abortNativeRun(runId);
      else console.warn(`[WorkRunCore] abortRun: no live run "${runId}" — nothing to abort`);
    },
  };

  if (driver.resumeSession) {
    const resume = driver.resumeSession.bind(driver);
    adapter.continueRun = (request, onEvent) => {
      let resolvedModel: string | undefined;
      let projection: Promise<void> | undefined;
      return runLifecycle(request.runId, async (publish, receipt) => {
        const input = request.clientUserMessageId && driver.steerRun ? {
          ...request,
          onInputAccepted: (turnId: string) => projection ??= receipt(async () => {
            await emitUserPromptArtifact(publish, request.message, {
              ...request, contextSkills: request.skills,
              model: resolvedModel, providerTurnId: turnId,
            });
            await request.onInputAccepted?.(turnId);
          }),
        } : request;
        const acquired = await resume(input);
        resolvedModel = acquired.model;
        return acquired;
      }, request, onEvent);
    };
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

  if (driver.steerRun) adapter.steerRun = driver.steerRun.bind(driver);
  if (driver.getInputStatus) adapter.getInputStatus = driver.getInputStatus.bind(driver);
  if (driver.startRealtime) adapter.startRealtime = driver.startRealtime.bind(driver);
  if (driver.stopRealtime) adapter.stopRealtime = driver.stopRealtime.bind(driver);

  // 1:1 delegation for optional pass-through methods
  if (driver.updateConfig)
    adapter.updateConfig = driver.updateConfig.bind(driver);
  if (driver.invalidateCatalogs)
    adapter.invalidateCatalogs = driver.invalidateCatalogs.bind(driver);
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
  if (driver.getCodexMemorySettings)
    adapter.getCodexMemorySettings = driver.getCodexMemorySettings.bind(driver);
  if (driver.setCodexMemorySetting)
    adapter.setCodexMemorySetting = driver.setCodexMemorySetting.bind(driver);
  if (driver.resetCodexMemories)
    adapter.resetCodexMemories = driver.resetCodexMemories.bind(driver);
  if (driver.listRealtimeVoices)
    adapter.listRealtimeVoices = driver.listRealtimeVoices.bind(driver);
  if (driver.consumeRateLimitResetCredit)
    adapter.consumeRateLimitResetCredit =
      driver.consumeRateLimitResetCredit.bind(driver);
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
  if (driver.listConnectors)
    adapter.listConnectors = driver.listConnectors.bind(driver);
  if (driver.startConnectorOAuth)
    adapter.startConnectorOAuth = driver.startConnectorOAuth.bind(driver);
  if (driver.listMcpAppEntrypoints)
    adapter.listMcpAppEntrypoints = driver.listMcpAppEntrypoints.bind(driver);
  if (driver.openMcpAppSession)
    adapter.openMcpAppSession = driver.openMcpAppSession.bind(driver);
  if (driver.callMcpAppSessionTool)
    adapter.callMcpAppSessionTool = driver.callMcpAppSessionTool.bind(driver);
  if (driver.closeMcpAppSession)
    adapter.closeMcpAppSession = driver.closeMcpAppSession.bind(driver);
  if (driver.readMcpAppResource)
    adapter.readMcpAppResource = driver.readMcpAppResource.bind(driver);
  if (driver.callMcpAppTool)
    adapter.callMcpAppTool = driver.callMcpAppTool.bind(driver);

  return adapter;
}
