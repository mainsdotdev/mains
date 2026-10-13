import type { ToolCall } from "@/lib/redux/api";
import {
  AGENT_ID_IN_RESULT,
  CLAUDE_SPAWN_TOOLS,
  isContinuationTool,
  subagentStateOf,
  type SubagentLifecycleMeta,
  type SubagentLifecycleState,
  type SubagentTaskMeta,
} from "./subagent-identity";

export type SubagentState = SubagentLifecycleState;

export interface SessionSubagent {
  /** Tool-call row id — stable across refetches, used as the list key. */
  id: number;
  /**
   * Provider tool-use id of the spawning call. The subagent's own tool calls
   * carry it as `parentToolCallId` — the flow view filters on it. Null for
   * runs recorded before parent linkage was persisted.
   */
  providerCallId: string | null;
  /** Wire name of the spawning tool — display naming branches on it. */
  toolName: string;
  /** Agent type as the provider named it ("general-purpose", "Explore", …). */
  agentType: string;
  agentId?: string;
  providerRunId?: string;
  /** Latest execution's call, while providerCallId remains the stable detail anchor. */
  latestProviderCallId?: string;
  parentAgentId?: string;
  parentProviderCallId?: string;
  depth?: number;
  /** One-line task description, when the provider supplied one. */
  description?: string;
  model?: string;
  reasoningEffort?: string;
  role?: string;
  agentPath?: string;
  state: SubagentState;
}

function firstLine(text: string | undefined): string | undefined {
  const line = text?.trim().split("\n")[0]?.trim();
  return line || undefined;
}

/**
 * Pick the subagents out of a run's tool calls.
 *
 * A subagent leaves three possible traces on the tool call that spawned it —
 * `metadata.subagent` (its own lifecycle), `metadata.task` (the task the CLI
 * runs it as), and the tool name itself. Older runs, or a run whose task events
 * never landed, only have the last one, so all three are consulted.
 *
 * Backgrounded shell commands are tasks too (`taskType: "local_bash"`), and
 * they are explicitly not subagents — they are filtered out here rather than in
 * the view, so the panel's count matches its list.
 *
 * Known children follow their immediate parent; sibling/root groups are
 * newest-first by monotonic row id, independent of timestamp ties.
 */
export function selectSessionSubagents(calls: ToolCall[]): SessionSubagent[] {
  interface Candidate {
    entry: SessionSubagent;
    /** The agent's continuation handle, when its row carries one. */
    agentId?: string;
    /** For SendMessage rows: the agentId the message was addressed to. */
    continuationTo?: string;
    parentTaskId?: string | null;
  }
  const candidates: Candidate[] = [];

  for (const call of calls) {
    const task = call.metadata?.task as SubagentTaskMeta | undefined;
    const subagent = call.metadata?.subagent as SubagentLifecycleMeta | undefined;
    const input = (call.input ?? {}) as Record<string, unknown>;

    // A declared non-agent task type (a backgrounded shell command) settles it;
    // otherwise any one of the three traces is enough. `taskType` only rides on
    // the `task_started` event, so its absence proves nothing either way.
    if (task?.taskType && task.taskType !== "local_agent") continue;
    const isSubagent =
      !!subagent ||
      !!task?.subagentType ||
      task?.taskType === "local_agent" ||
      CLAUDE_SPAWN_TOOLS.has(call.toolName.toLowerCase());
    if (!isSubagent) continue;

    const agentType =
      subagent?.agentType ||
      task?.subagentType ||
      (typeof input.subagent_type === "string" ? input.subagent_type : undefined) ||
      "subagent";

    // The spawn input's description is the task's STABLE title; the task
    // metadata's description starts as the same title but is rewritten with
    // the current step while the agent runs — so the input wins for the name
    // and the task copy is deliberately not displayed at all.
    const description =
      (typeof input.description === "string" ? input.description : undefined) ||
      task?.description ||
      firstLine(subagent?.prompt);

    // Shared with the detail view (subagent-identity) so both surfaces
    // always agree on an agent's state.
    const state = subagentStateOf({
      toolName: call.toolName,
      callStatus: call.status,
      task,
      subagent,
    });
    const model = subagent?.model || (typeof input.model === "string" ? input.model : undefined);
    const reasoningEffort = subagent?.reasoningEffort || (typeof input.reasoningEffort === "string" ? input.reasoningEffort : undefined);
    const nativeAgentId = task?.taskId;
    const agentId = nativeAgentId || subagent?.agentId || subagent?.result?.match(AGENT_ID_IN_RESULT)?.[1];

    candidates.push({
      entry: {
        id: call.id,
        providerCallId: call.toolCallId ?? null,
        toolName: call.toolName,
        agentType,
        ...(agentId ? { agentId } : {}),
        ...(task?.providerRunId ? { providerRunId: task.providerRunId } : {}),
        ...(task?.parentTaskId ? { parentAgentId: task.parentTaskId } : {}),
        ...(call.parentToolCallId ? { parentProviderCallId: call.parentToolCallId } : {}),
        description,
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(subagent?.role ? { role: subagent.role } : {}),
        ...(subagent?.agentPath ? { agentPath: subagent.agentPath } : {}),
        state,
      },
      agentId,
      parentTaskId: task?.parentTaskId,
      continuationTo:
        isContinuationTool(call.toolName)
          ? nativeAgentId || (typeof input.to === "string" ? input.to : undefined)
          : undefined,
    });
  }

  // A SendMessage continuation is another turn of an existing agent, not a new
  // one — fold it into that agent's row, with the latest turn's state winning.
  // "Latest" is decided by monotonic row id, NOT input order: second-grained
  // timestamps tie, and the fold must not depend on how the rows arrived.
  // Without a match it stays its own, correctly-named row.
  candidates.sort((a, b) => a.entry.id - b.entry.id);
  const out: SessionSubagent[] = [];
  const byAgentId = new Map<string, SessionSubagent>();
  const latestRow = new Map<SessionSubagent, number>();
  function fold(primary: SessionSubagent, candidate: Candidate) {
    const next = candidate.entry;
    if (next.providerRunId && primary.providerRunId) {
      if (next.providerRunId < primary.providerRunId) return;
      if (next.providerRunId === primary.providerRunId && next.id < (latestRow.get(primary) ?? primary.id)) return;
    } else if (next.id < (latestRow.get(primary) ?? primary.id)) return;
    primary.state = next.state;
    if (next.providerCallId) primary.latestProviderCallId = next.providerCallId;
    if (next.providerRunId) primary.providerRunId = next.providerRunId;
    if (candidate.parentTaskId !== undefined) {
      primary.parentAgentId = candidate.parentTaskId || undefined;
      if (candidate.parentTaskId === null) primary.parentProviderCallId = undefined;
    }
    latestRow.set(primary, next.id);
  }
  for (const candidate of candidates) {
    if (candidate.continuationTo) continue;
    const primary = candidate.agentId ? byAgentId.get(candidate.agentId) : undefined;
    if (primary) { fold(primary, candidate); continue; }
    out.push(candidate.entry);
    if (candidate.agentId) byAgentId.set(candidate.agentId, candidate.entry);
  }
  for (const candidate of candidates) {
    if (!candidate.continuationTo) continue;
    const primary = byAgentId.get(candidate.continuationTo);
    if (primary) fold(primary, candidate);
    else {
      out.push(candidate.entry);
      if (candidate.agentId) byAgentId.set(candidate.agentId, candidate.entry);
      byAgentId.set(candidate.continuationTo, candidate.entry);
    }
  }

  const byCallId = new Map(out.filter((agent) => agent.providerCallId).map((agent) => [agent.providerCallId, agent]));
  const children = new Map<SessionSubagent, SessionSubagent[]>();
  const roots: SessionSubagent[] = [];
  out.sort((a, b) => b.id - a.id);
  for (const agent of out) {
    const parent = agent.parentAgentId ? byAgentId.get(agent.parentAgentId)
      : agent.parentProviderCallId ? byCallId.get(agent.parentProviderCallId) : undefined;
    if (!parent || parent === agent) { roots.push(agent); continue; }
    agent.parentProviderCallId = parent.providerCallId || undefined;
    children.set(parent, [...(children.get(parent) ?? []), agent]);
  }
  const ordered: SessionSubagent[] = [];
  const visited = new Set<SessionSubagent>();
  // Unknown/cyclic parent ids remain usable root rows rather than disappearing.
  for (const root of [...roots, ...out]) {
    const stack = [{ agent: root, depth: 0 }];
    while (stack.length) {
      const { agent, depth } = stack.pop()!;
      if (visited.has(agent)) continue;
      visited.add(agent);
      if (depth) agent.depth = depth;
      ordered.push(agent);
      for (const child of [...(children.get(agent) ?? [])].reverse()) stack.push({ agent: child, depth: depth + 1 });
    }
  }
  return ordered;
}

/**
 * The single agent a detail surface is showing, found by the provider call id
 * its row carries.
 *
 * Deliberately a lookup into the SAME selection the list renders rather than a
 * second synthesis from the spawn row: an agent's state is a fold over every
 * row that belongs to it (its spawn plus each continuation turn), so deriving
 * it from the spawn alone made the detail header contradict the row that was
 * clicked — a resumed agent read `running` in the list and `stopped` in its
 * own header.
 */
export function selectSubagentEntry(
  calls: ToolCall[],
  providerCallId: string,
): SessionSubagent | undefined {
  return selectSessionSubagents(calls).find(
    (agent) => agent.providerCallId === providerCallId,
  );
}
