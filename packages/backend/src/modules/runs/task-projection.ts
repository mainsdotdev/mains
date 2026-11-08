import type { WorkRunEvent } from "../../../shared/adapter.types";
import { runsRepo } from "./runs.repo";

const TERMINAL_TASK_STATUSES = new Set([
  "completed",
  "failed",
  "killed",
  "stopped",
]);
const RESET_TASK_OUTCOME = {
  phase: null, status: null, summary: null, outputFile: null, lastToolName: null,
  usage: null, error: null, skipTranscript: null, isBackgrounded: null, backgroundActive: null, ambient: null,
};

interface ToolAnchors {
  ready: Promise<void>;
  rowId(key: string): Promise<number | undefined>;
  anchors: ReturnType<typeof runsRepo.findToolProjectionAnchors>;
}

/** Task execution identity outlives the foreground call. Native execution ids
 * order Claude executions; missing ids are scoped to the current owner. */
export function createTaskProjection(runId: string, toolProjection: ToolAnchors) {
  const taskRunIds = new Map<string, string>();
  const settledSubagents = new Map<string, string>();
  async function hydrate(): Promise<void> {
    try {
      const calls = await toolProjection.anchors;
      for (const call of calls) {
        if (call.toolId) {
          const latest = [call.taskRunId, call.subagentRunId].filter((id): id is string => !!id).sort().at(-1);
          if (latest) taskRunIds.set(call.toolId, latest);
          if (call.subagentRunId && call.subagentPhase && ["completed", "failed", "stopped"].includes(call.subagentPhase)) {
            settledSubagents.set(JSON.stringify([call.toolId, call.subagentRunId]), call.subagentPhase);
          }
        }
      }
    } catch (err) {
      console.error(
        `[RunSession ${runId}] Failed to hydrate tool-call anchors:`,
        err,
      );
    }
  }

  const ready = Promise.all([toolProjection.ready, hydrate()]).then(() => {});
  async function patchToolCallMetadata(
    toolUseId: string | undefined,
    key: "subagent" | "task",
    detail: Record<string, unknown>,
    parentToolCallId?: string | null,
    extraMetadata?: Record<string, unknown>,
  ): Promise<boolean> {
    if (!toolUseId) return false;
    const toolCallId = await toolProjection.rowId(toolUseId);
    if (toolCallId === undefined) return false;
    // Drop undefined fields so a later partial patch cannot blank an earlier one.
    const clean = Object.fromEntries(
      Object.entries(detail).filter(([, v]) => v !== undefined),
    );
    await runsRepo.updateToolCall(toolCallId, {
      parentToolCallId,
      metadata: {
        ...extraMetadata,
        [key]: clean,
        ...(parentToolCallId !== undefined ? { parentToolUseId: parentToolCallId, isFromSubagent: !!parentToolCallId } : {}),
      },
    });
    return true;
  }

  async function projectSubagent(
    event: Extract<WorkRunEvent, { type: "subagent" }>,
  ): Promise<boolean> {
    await ready;
    const taskRunId = event.parentToolUseId ? taskRunIds.get(event.parentToolUseId) : undefined;
    if (event.providerRunId && taskRunId && event.providerRunId < taskRunId) return false;
    const executionKey = JSON.stringify([event.parentToolUseId, event.providerRunId]);
    const settledPhase = settledSubagents.get(executionKey);
    if (settledPhase && event.phase !== settledPhase) return false;
    const newExecution = !!(event.providerRunId && event.providerRunId !== taskRunId);
    const didPersist = await patchToolCallMetadata(event.parentToolUseId, "subagent", {
      phase: event.phase,
      agentType: event.agentType,
      agentId: event.agentId,
      providerRunId: event.providerRunId,
      model: event.model,
      reasoningEffort: event.reasoningEffort,
      role: event.role,
      agentPath: event.agentPath,
      prompt: event.prompt,
      result: event.result ?? (newExecution ? null : undefined),
      error: event.error ?? (newExecution ? null : undefined),
      // Terminal patches overwrite updatedAt, so the spawn moment gets its own
      // key — the panel derives "worked for Xs" from invokedAt → updatedAt.
      ...(event.phase === "invoked" ? { invokedAt: event.ts ?? Date.now() } : {}),
      updatedAt: event.ts ?? Date.now(),
    }, undefined, newExecution ? { task: { ...RESET_TASK_OUTCOME, providerRunId: event.providerRunId } } : undefined);
    if (didPersist && event.parentToolUseId && event.providerRunId) taskRunIds.set(event.parentToolUseId, event.providerRunId);
    if (didPersist && (event.phase === "completed" || event.phase === "failed" || event.phase === "stopped")) settledSubagents.set(executionKey, event.phase);
    return didPersist;
  }

  async function projectTask(
    event: Extract<WorkRunEvent, { type: "task" }>,
  ): Promise<boolean> {
    await ready;
    const previousRunId = event.toolCallId ? taskRunIds.get(event.toolCallId) : undefined;
    if (event.providerRunId && previousRunId && event.providerRunId < previousRunId) return false;
    const rowId = event.toolCallId ? await toolProjection.rowId(event.toolCallId) : undefined;
    const metadata = rowId === undefined ? null : await runsRepo.findToolCallMetadata(rowId);
    const previous = metadata?.task as { phase?: string; status?: string; providerRunId?: string } | undefined;
    const newExecution = !!(event.providerRunId && event.providerRunId !== previous?.providerRunId);
    const alreadySettled = !newExecution && previous && (previous.phase === "completed" || TERMINAL_TASK_STATUSES.has(previous.status ?? ""));
    const lateProgress = alreadySettled && event.phase !== "completed";
    const didPersist = await patchToolCallMetadata(event.toolCallId, "task", {
      // json_patch merges partial updates. Explicitly remove the previous
      // execution's outcome so a resumed task cannot inherit its failure.
      phase: alreadySettled ? previous.phase : event.phase,
      taskId: event.taskId,
      providerRunId: event.providerRunId,
      parentTaskId: event.parentTaskId,
      parentToolCallId: event.parentToolCallId,
      status: alreadySettled ? previous.status : event.status ?? (newExecution ? null : undefined),
      description: event.description,
      subagentType: event.subagentType,
      taskType: event.taskType,
      summary: lateProgress ? undefined : event.summary ?? (newExecution ? null : undefined),
      // Where a backgrounded command's real output landed. The run itself never
      // carries that output, so this path is the only handle on it.
      outputFile: event.outputFile ?? (newExecution ? null : undefined),
      lastToolName: event.lastToolName ?? (newExecution ? null : undefined),
      usage: event.usage ?? (newExecution ? null : undefined),
      error: lateProgress ? undefined : event.error ?? (newExecution ? null : undefined),
      skipTranscript: event.skipTranscript ?? (newExecution ? null : undefined),
      isBackgrounded: event.isBackgrounded ?? (newExecution ? null : undefined),
      backgroundActive: event.backgroundActive ?? (newExecution ? null : undefined),
      ambient: event.ambient ?? (newExecution ? null : undefined),
      updatedAt: event.ts ?? Date.now(),
    }, event.parentToolCallId, newExecution && (event.taskType === "local_agent" || event.subagentType) ? {
      subagent: { phase: "running", agentId: event.taskId, providerRunId: event.providerRunId, result: null, error: null },
    } : undefined);
    if (didPersist && event.toolCallId && event.providerRunId) taskRunIds.set(event.toolCallId, event.providerRunId);
    return didPersist;
  }

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

  return {
    ready,
    project(event: Extract<WorkRunEvent, { type: "task" | "subagent" }>) {
      return event.type === "task" ? projectTask(event) : projectSubagent(event);
    },
    settle: settleUnfinishedSubagents,
  };
}
