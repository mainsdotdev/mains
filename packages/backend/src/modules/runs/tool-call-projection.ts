import type { WorkRunEvent, WorkRunToolCallEvent } from "../../../shared/adapter.types";
import { runsRepo } from "./runs.repo";
import { createTaskProjection } from "./task-projection";

interface Call { id: number; name: string; pending: boolean }
interface ProjectionContext {
  runId: string;
  accountId: string;
  providerId: string;
  /** Legacy writeback can receive complete records without an observed start. */
  recordOrphans?: boolean;
}
export interface ToolProjectionResult {
  transition: "started" | "completed" | "unchanged";
  key?: string;
  id?: number;
}

function identity(value: unknown): string | undefined {
  if (typeof value === "string" && value) return value;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}
function toolIdentity(event: WorkRunToolCallEvent) {
  const meta = event.metadata;
  return {
    id: identity(meta?.toolCallId ?? meta?.tool_call_id ?? meta?.id),
    parentId: identity(meta?.parentToolUseId ?? meta?.parentToolCallId ?? meta?.parent_tool_call_id),
  };
}

/** One correlation and commit policy for live sessions and legacy writeback.
 * Stable ids never fall back to another call's name. A terminal write commits
 * before pending ownership is released, so a failed write remains retryable. */
export function createToolCallProjection(context: ProjectionContext) {
  const calls = new Map<string, Call>();
  let sequence = 0;
  let tail = Promise.resolve();
  const anchors = runsRepo.findToolProjectionAnchors(context.runId);
  const ready = anchors.then((rows) => {
    for (const row of rows) if (row.toolId || context.recordOrphans) calls.set(row.toolId ?? `restored:${row.id}`, {
      id: row.id, name: row.toolName,
      pending: !!context.recordOrphans && (row.status === "queued" || row.status === "running"),
    });
  });

  async function project(event: WorkRunToolCallEvent, turnId?: number | null): Promise<ToolProjectionResult> {
    await ready;
    const { id, parentId } = toolIdentity(event);
    const phase = event.metadata?.phase;
    const key = id ?? (phase === "start"
      ? `legacy:${JSON.stringify([event.toolName, event.startedAt ?? ++sequence])}`
      : [...calls].find(([, call]) => call.pending && call.name === event.toolName)?.[0]);
    let call = key ? calls.get(key) : undefined;
    if (phase === "start") {
      if (call) return { transition: "unchanged" };
      const rowId = await runsRepo.insertToolCall({
        ...context, toolId: id, parentToolCallId: parentId, toolName: event.toolName,
        status: "running", input: event.input,
        startedAt: new Date(event.startedAt ?? Date.now()),
        metadata: { ...event.metadata, ...(turnId !== undefined ? { turnId } : {}) },
      });
      calls.set(key!, { id: rowId, name: event.toolName, pending: true });
      return { transition: "started", key, id: rowId };
    }
    if (phase !== "end" && phase !== "complete" && phase !== undefined) return { transition: "unchanged" };
    if (call && !call.pending) return { transition: "unchanged" };
    if (!call) {
      if (!context.recordOrphans) return { transition: "unchanged" };
      const rowId = await runsRepo.insertToolCall({
        ...context, toolId: id, parentToolCallId: parentId, toolName: event.toolName,
        status: "running", input: event.input,
        startedAt: event.startedAt !== undefined ? new Date(event.startedAt) : undefined,
        metadata: { ...event.metadata, ...(turnId !== undefined ? { turnId } : {}) },
      });
      call = { id: rowId, name: event.toolName, pending: true };
      calls.set(key ?? `orphan:${++sequence}`, call);
    }
    await runsRepo.updateToolCall(call.id, {
      status: event.terminalStatus ?? (event.error ? "error" : "done"),
      input: event.input, output: event.output, error: event.error,
      endedAt: new Date(event.endedAt ?? Date.now()),
      latencyMs: event.startedAt !== undefined && event.endedAt !== undefined ? event.endedAt - event.startedAt : undefined,
      metadata: event.metadata,
    });
    call.pending = false;
    return { transition: "completed", key, id: call.id };
  }

  const rowId = async (key: string): Promise<number | undefined> => { await ready; return calls.get(key)?.id; };
  const tasks = createTaskProjection(context.runId, { ready, rowId, anchors });
  // Keep initialization failure observable to callers without an unhandled
  // rejection while the provider is still acquiring its native session.
  void tasks.ready.catch(() => {});
  return {
    ready: tasks.ready,
    project(event: WorkRunToolCallEvent, turnId?: number | null) {
      const result = tail.then(() => project(event, turnId));
      tail = result.then(() => {}, () => {});
      return result;
    },
    projectLifecycle(event: Extract<WorkRunEvent, { type: "task" | "subagent" }>) {
      const result = tail.then(() => tasks.project(event));
      tail = result.then(() => {}, () => {});
      return result;
    },
    async settle(status: "succeeded" | "failed" | "canceled"): Promise<void> {
      await tail;
      await tasks.ready;
      const rows = await runsRepo.findToolProjectionAnchors(context.runId);
      for (const row of rows) {
        if (row.status !== "running" && row.status !== "queued") continue;
        try {
          await runsRepo.updateToolCall(row.id, { status: status === "succeeded" ? "done" : "error", endedAt: new Date() });
          for (const call of calls.values()) if (call.id === row.id) call.pending = false;
        } catch (error) { console.error(`[RunProjection ${context.runId}] Could not settle tool ${row.id}:`, error); }
      }
      await tasks.settle(status);
    },
    rowId,
    pendingCount: () => [...calls.values()].filter((call) => call.pending).length,
  };
}
