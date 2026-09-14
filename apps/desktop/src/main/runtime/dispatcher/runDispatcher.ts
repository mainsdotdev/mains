// ─────────────────────────────────────────────────────────────
// Run Dispatcher - Orchestrates adapter execution with DB persistence
// ─────────────────────────────────────────────────────────────

import { runsService } from "../../modules/runs";
import { providersService } from "../../modules/providers";
import { workspaceService } from "../../modules/workspace";
import {
  createWorkAdapter,
  isSupportedWorkProvider,
  type WorkRunRequest,
  type WorkRunResult,
  type WorkRunContextItem,
  type WorkRunToolPolicy,
} from "../../modules/providers/adapters";
import { createRunWriteback } from "../writeback/runWriteback";
import type { RunStatus, StartRunContextItem } from "../../modules/runs";
import { DEFAULT_MODE_ID } from "../../../shared/modes";

export interface DispatchRunRequest {
  accountId: string;
  workspaceId: string;
  providerId: string;
  goal: string;
  model?: string;
  systemPrompt?: string;
  initialContext?: StartRunContextItem[];
  spaceId?: string;
  configSnapshot?: Record<string, unknown>;
  toolPolicySnapshot?: WorkRunToolPolicy;
}

export interface DispatchRunResult {
  runId: string;
  result: WorkRunResult;
}

/**
 * Dispatches a work run through the appropriate adapter with full DB persistence.
 *
 * Flow:
 * 1. Loads provider from DB and validates it
 * 2. Loads workspace from DB
 * 3. Creates a run record with status=running
 * 4. Persists initial context
 * 5. Creates the adapter instance
 * 6. Streams adapter events through writeback for persistence
 * 7. Updates run status on completion (succeeded/failed/canceled)
 *
 * Unlike runsService.executeRun, this function awaits completion and returns the result.
 */
export async function dispatchRun(request: DispatchRunRequest): Promise<DispatchRunResult> {
  const runId = generateRunId();

  // 1. Load and validate provider
  const provider = await providersService.getById(request.providerId);
  if (!provider) {
    throw new Error(`Provider "${request.providerId}" not found`);
  }
  if (!provider.isEnabled) {
    throw new Error(`Provider "${provider.displayName}" is not enabled`);
  }
  if (provider.kind !== "agent_runtime") {
    throw new Error(`Provider "${provider.displayName}" is not an agent runtime`);
  }
  if (!isSupportedWorkProvider(provider.id)) {
    throw new Error(`Provider "${provider.id}" is not a supported work provider`);
  }

  // 2. Load workspace
  const workspace = await workspaceService.get(request.workspaceId);
  if (!workspace) {
    throw new Error(`Workspace "${request.workspaceId}" not found`);
  }

  // 3. Create run record with status=running
  await runsService.createRun({
    id: runId,
    accountId: request.accountId,
    workspaceId: request.workspaceId,
    spaceId: request.spaceId,
    providerId: request.providerId,
    model: request.model,
    goal: request.goal,
    status: "running",
    systemPrompt: request.systemPrompt,
    configSnapshot: request.configSnapshot,
    toolPolicySnapshot: request.toolPolicySnapshot,
  });

  // Set startedAt
  await runsService.updateRun(runId, { startedAt: new Date() });

  // 4. Persist initial context
  if (request.initialContext && request.initialContext.length > 0) {
    for (const ctx of request.initialContext) {
      await runsService.addContext({
        runId,
        kind: ctx.kind as "file" | "selection" | "diff" | "note",
        ref: ctx.ref,
        content: ctx.content,
        metadata: ctx.metadata,
      });
    }
  }

  // 5. Create adapter
  const adapter = createWorkAdapter(provider);

  // 6. Create writeback handler
  const writeback = createRunWriteback({
    accountId: request.accountId,
    providerId: request.providerId,
    runId,
  });

  // 7. Build adapter request
  const adapterRequest: WorkRunRequest = {
    runId,
    accountId: request.accountId,
    execution: {
      workspaceId: workspace.id,
      cwd: workspace.rootPath,
    },
    goal: request.goal,
    model: request.model,
    systemPrompt: request.systemPrompt,
    // The dispatcher is not mode-aware: it has no spaceId and no IPC caller.
    // A future caller must resolve the harness via shared/mode-harness
    // composition (see runs.service) instead of leaning on this default.
    mode: DEFAULT_MODE_ID,
    context: request.initialContext as WorkRunContextItem[] | undefined,
    toolPolicy: request.toolPolicySnapshot,
  };

  // 8. Execute run with event streaming
  let result: WorkRunResult;
  try {
    result = await adapter.startRun(adapterRequest, async (event) => {
      await writeback.handleEvent(event);
    });

    // 9. Update run status based on result
    const finalStatus: RunStatus =
      result.status === "succeeded"
        ? "succeeded"
        : result.status === "canceled"
          ? "canceled"
          : "failed";

    await runsService.updateRun(runId, {
      status: finalStatus,
      endedAt: new Date(),
      lastError: result.status === "failed" ? result.summary : undefined,
    });

    console.log(
      `[RunDispatcher] Run ${runId} completed with status: ${finalStatus}` +
        (writeback.getPendingToolCallCount() > 0
          ? ` (${writeback.getPendingToolCallCount()} pending tool calls)`
          : "")
    );
  } catch (error) {
    // Handle adapter errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[RunDispatcher] Run ${runId} failed with error:`, errorMessage);

    await runsService.updateRun(runId, {
      status: "failed",
      endedAt: new Date(),
      lastError: errorMessage,
    });

    result = {
      status: "failed",
      summary: errorMessage,
    };
  }

  return { runId, result };
}

/**
 * Dispatches a run in the background (fire-and-forget).
 * Returns the runId immediately.
 */
export function dispatchRunAsync(request: DispatchRunRequest): string {
  const runId = generateRunId();

  // Start dispatch in background
  (async () => {
    try {
      await dispatchRunInternal(runId, request);
    } catch (error) {
      console.error(`[RunDispatcher] Background run ${runId} failed:`, error);
    }
  })();

  return runId;
}

/**
 * Internal dispatch with pre-generated runId (for async variant)
 */
async function dispatchRunInternal(
  runId: string,
  request: DispatchRunRequest
): Promise<WorkRunResult> {
  // 1. Load and validate provider
  const provider = await providersService.getById(request.providerId);
  if (!provider) {
    throw new Error(`Provider "${request.providerId}" not found`);
  }
  if (!provider.isEnabled) {
    throw new Error(`Provider "${provider.displayName}" is not enabled`);
  }
  if (provider.kind !== "agent_runtime") {
    throw new Error(`Provider "${provider.displayName}" is not an agent runtime`);
  }

  // 2. Load workspace
  const workspace = await workspaceService.get(request.workspaceId);
  if (!workspace) {
    throw new Error(`Workspace "${request.workspaceId}" not found`);
  }

  // 3. Create run record
  await runsService.createRun({
    id: runId,
    accountId: request.accountId,
    workspaceId: request.workspaceId,
    spaceId: request.spaceId,
    providerId: request.providerId,
    model: request.model,
    goal: request.goal,
    status: "running",
    systemPrompt: request.systemPrompt,
    configSnapshot: request.configSnapshot,
    toolPolicySnapshot: request.toolPolicySnapshot,
  });

  await runsService.updateRun(runId, { startedAt: new Date() });

  // 4. Persist initial context
  if (request.initialContext && request.initialContext.length > 0) {
    for (const ctx of request.initialContext) {
      await runsService.addContext({
        runId,
        kind: ctx.kind as "file" | "selection" | "diff" | "note",
        ref: ctx.ref,
        content: ctx.content,
        metadata: ctx.metadata,
      });
    }
  }

  // 5. Create adapter and writeback
  const adapter = createWorkAdapter(provider);
  const writeback = createRunWriteback({
    accountId: request.accountId,
    providerId: request.providerId,
    runId,
  });

  // 6. Execute
  let result: WorkRunResult;
  try {
    result = await adapter.startRun(
      {
        runId,
        accountId: request.accountId,
        execution: {
          workspaceId: workspace.id,
          cwd: workspace.rootPath,
        },
        goal: request.goal,
        model: request.model,
        systemPrompt: request.systemPrompt,
        // Not mode-aware — see the note on dispatchRun's adapterRequest.
        mode: DEFAULT_MODE_ID,
        context: request.initialContext as WorkRunContextItem[] | undefined,
        toolPolicy: request.toolPolicySnapshot,
      },
      async (event) => {
        await writeback.handleEvent(event);
      }
    );

    const finalStatus: RunStatus =
      result.status === "succeeded"
        ? "succeeded"
        : result.status === "canceled"
          ? "canceled"
          : "failed";

    await runsService.updateRun(runId, {
      status: finalStatus,
      endedAt: new Date(),
      lastError: result.status === "failed" ? result.summary : undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await runsService.updateRun(runId, {
      status: "failed",
      endedAt: new Date(),
      lastError: errorMessage,
    });

    result = {
      status: "failed",
      summary: errorMessage,
    };
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function generateRunId(): string {
  // UUID v4 format
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
