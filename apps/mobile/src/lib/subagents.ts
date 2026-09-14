import type { RunArtifactRow, ToolCallRow } from "@/db/schema";

import { parseToolInput } from "./tool-output";

/** Provider tool names whose call represents a Claude subagent session. */
const CLAUDE_SPAWN_TOOLS: ReadonlySet<string> = new Set(["agent", "task"]);

function isContinuationTool(toolName: string): boolean {
  return toolName.toLowerCase() === "sendmessage";
}

export interface SubagentTaskMeta {
  phase?: "started" | "progress" | "updated" | "completed";
  taskId?: string;
  status?:
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "killed"
    | "paused"
    | "stopped";
  error?: string;
  description?: string;
  subagentType?: string;
  taskType?: string;
  summary?: string;
  lastToolName?: string;
  usage?: { totalTokens?: number; toolUses?: number; durationMs?: number };
}

export interface SubagentLifecycleMeta {
  phase?: "invoked" | "running" | "completed" | "failed" | "stopped";
  agentType?: string;
  agentId?: string;
  prompt?: string;
  result?: string;
  error?: string;
  invokedAt?: number;
  updatedAt?: number;
}

interface ToolCallMetadata {
  task?: SubagentTaskMeta;
  subagent?: SubagentLifecycleMeta;
}

export type SubagentState = "running" | "done" | "failed" | "stopped";

export interface SessionSubagent {
  /** The spawning tool-call row. */
  id: number;
  /** Provider tool-use id that anchors the subagent's child calls and messages. */
  providerCallId: string | null;
  toolName: string;
  agentType: string;
  description?: string;
  agentId?: string;
  state: SubagentState;
}

export type SubagentFlowItem =
  | { kind: "prompt"; key: string; at: number; content: string }
  | { kind: "message"; key: string; at: number; content: string }
  | { kind: "tool"; key: string; at: number; call: ToolCallRow };

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function toolCallMetadata(call: ToolCallRow): ToolCallMetadata {
  return parseObject(call.metadataJson) as ToolCallMetadata;
}

function firstLine(text: string | undefined): string | undefined {
  const line = text?.trim().split("\n")[0]?.trim();
  return line || undefined;
}

function isSubagentCall(call: ToolCallRow): boolean {
  const { task, subagent } = toolCallMetadata(call);
  if (task?.taskType && task.taskType !== "local_agent") return false;
  return Boolean(
    subagent ||
      task?.subagentType ||
      task?.taskType === "local_agent" ||
      CLAUDE_SPAWN_TOOLS.has(call.toolName.toLowerCase()),
  );
}

function subagentStateOf(
  call: ToolCallRow,
  task: SubagentTaskMeta | undefined,
  subagent: SubagentLifecycleMeta | undefined,
): SubagentState {
  if (task?.error || task?.status === "failed" || subagent?.phase === "failed") return "failed";
  if (
    task?.status === "stopped" ||
    task?.status === "killed" ||
    subagent?.phase === "stopped"
  ) {
    return "stopped";
  }
  if (
    task?.phase === "completed" ||
    task?.status === "completed" ||
    subagent?.phase === "completed"
  ) {
    return "done";
  }
  if (call.status === "error") return "failed";
  if (call.status === "canceled") return "stopped";
  if (
    call.status === "done" &&
    !task &&
    CLAUDE_SPAWN_TOOLS.has(call.toolName.toLowerCase())
  ) {
    return "done";
  }
  return "running";
}

/** Every subagent in a run, with continuation calls folded into its original row. */
export function selectSessionSubagents(calls: ToolCallRow[]): SessionSubagent[] {
  interface Candidate {
    entry: SessionSubagent;
    continuationTo?: string;
  }

  const candidates: Candidate[] = [];
  for (const call of calls) {
    if (!isSubagentCall(call)) continue;
    const { task, subagent } = toolCallMetadata(call);
    const input = parseToolInput(call.inputJson);
    const agentType =
      subagent?.agentType ||
      task?.subagentType ||
      (typeof input.subagent_type === "string" ? input.subagent_type : undefined) ||
      "subagent";
    const description =
      (typeof input.description === "string" ? input.description : undefined) ||
      task?.description ||
      firstLine(subagent?.prompt);

    candidates.push({
      entry: {
        id: call.id,
        providerCallId: call.toolId,
        toolName: call.toolName,
        agentType,
        description,
        agentId: subagent?.agentId,
        state: subagentStateOf(call, task, subagent),
      },
      continuationTo:
        isContinuationTool(call.toolName) && typeof input.to === "string"
          ? input.to
          : undefined,
    });
  }

  candidates.sort((a, b) => a.entry.id - b.entry.id);
  const agents: SessionSubagent[] = [];
  const byAgentId = new Map<string, SessionSubagent>();
  for (const candidate of candidates) {
    if (candidate.continuationTo) continue;
    agents.push(candidate.entry);
    if (candidate.entry.agentId) byAgentId.set(candidate.entry.agentId, candidate.entry);
  }
  for (const candidate of candidates) {
    if (!candidate.continuationTo) continue;
    const original = byAgentId.get(candidate.continuationTo);
    if (original) original.state = candidate.entry.state;
    else agents.push(candidate.entry);
  }

  return agents.sort((a, b) => b.id - a.id);
}

/**
 * Remove subagent roots and their child calls from the main transcript. The
 * roots return as one session-level summary row; their detail remains
 * available through the dedicated sheet.
 */
export function partitionSubagentCalls(calls: ToolCallRow[]): {
  agents: SessionSubagent[];
  visibleCalls: ToolCallRow[];
  firstAt: number | null;
  firstId: number | null;
} {
  const roots = calls.filter(isSubagentCall);
  const rootRowIds = new Set(roots.map((call) => call.id));
  const anchorIds = new Set(
    roots.flatMap((call) => (call.toolId ? [call.toolId] : [])),
  );
  const visibleCalls = calls.filter(
    (call) =>
      !rootRowIds.has(call.id) &&
      (!call.parentToolCallId || !anchorIds.has(call.parentToolCallId)),
  );
  const first = roots.reduce<ToolCallRow | null>(
    (earliest, call) =>
      !earliest || call.createdAt.getTime() < earliest.createdAt.getTime() ? call : earliest,
    null,
  );
  return {
    agents: selectSessionSubagents(calls),
    visibleCalls,
    firstAt: first?.createdAt.getTime() ?? null,
    firstId: first?.id ?? null,
  };
}

export function humanizeAgentName(name: string): string {
  const words = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!words) return name;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const DESCRIPTION_TITLED_TOOLS = new Set([...CLAUDE_SPAWN_TOOLS, "sendmessage"]);

export function subagentDisplay(agent: SessionSubagent): { name: string; detail?: string } {
  const human = humanizeAgentName(agent.agentType);
  const description = agent.description?.trim();
  if (DESCRIPTION_TITLED_TOOLS.has(agent.toolName.toLowerCase()) && description) {
    return { name: description, detail: human };
  }
  return { name: human, detail: description };
}

function artifactMetadata(artifact: RunArtifactRow): Record<string, unknown> {
  return parseObject(artifact.metadataJson);
}

/** A single subagent's child tools and messages, interleaved in execution order. */
export function buildSubagentFlow(args: {
  agent: SessionSubagent;
  calls: ToolCallRow[];
  artifacts: RunArtifactRow[];
}): SubagentFlowItem[] {
  const { agent, calls, artifacts } = args;
  if (!agent.providerCallId) return [];

  const items: SubagentFlowItem[] = [];
  const anchorIds = new Set<string>([agent.providerCallId]);
  if (agent.agentId) {
    for (const call of calls) {
      if (!isContinuationTool(call.toolName)) continue;
      const input = parseToolInput(call.inputJson);
      if (input.to !== agent.agentId) continue;
      if (call.toolId) anchorIds.add(call.toolId);
      if (typeof input.message === "string" && input.message.trim()) {
        items.push({
          kind: "prompt",
          key: `prompt-${call.id}`,
          at: call.createdAt.getTime(),
          content: input.message,
        });
      }
    }
  }

  for (const call of calls) {
    if (!call.parentToolCallId || !anchorIds.has(call.parentToolCallId)) continue;
    items.push({
      kind: "tool",
      key: `tool-${call.id}`,
      at: call.createdAt.getTime(),
      call,
    });
  }

  for (const artifact of artifacts) {
    if (!artifact.content) continue;
    const parent = artifactMetadata(artifact).parentToolUseId;
    if (typeof parent !== "string" || !anchorIds.has(parent)) continue;
    items.push({
      kind: "message",
      key: `message-${artifact.id}`,
      at: artifact.createdAt.getTime(),
      content: artifact.content,
    });
  }

  const rank: Record<SubagentFlowItem["kind"], number> = {
    prompt: 0,
    tool: 1,
    message: 2,
  };
  const rowId = (item: SubagentFlowItem) =>
    Number(item.key.slice(item.key.lastIndexOf("-") + 1)) || 0;
  return items.sort((a, b) => a.at - b.at || rank[a.kind] - rank[b.kind] || rowId(a) - rowId(b));
}

/** Avoid repeating a report already present as the flow's last message. */
export function selectSubagentReport(
  finalReport: string | undefined,
  flow: SubagentFlowItem[],
): string | undefined {
  if (!finalReport) return undefined;
  const lastMessage = [...flow].reverse().find((item) => item.kind === "message");
  const lastContent = lastMessage?.kind === "message" ? lastMessage.content.trim() : "";
  return finalReport.trim() !== lastContent ? finalReport : undefined;
}

export function subagentWorkedMs(call: ToolCallRow): number | undefined {
  const { subagent, task } = toolCallMetadata(call);
  if (
    typeof subagent?.invokedAt === "number" &&
    typeof subagent.updatedAt === "number" &&
    subagent.updatedAt > subagent.invokedAt
  ) {
    return subagent.updatedAt - subagent.invokedAt;
  }
  if (typeof task?.usage?.durationMs === "number") return task.usage.durationMs;
  const start = call.startedAt ?? call.createdAt;
  const end = call.endedAt;
  return end && end > start ? end.getTime() - start.getTime() : undefined;
}
