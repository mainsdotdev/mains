import { isContinuationTool } from "./subagent-identity";

/**
 * Pure assembly of a subagent's detail flow — everything the detail view
 * shows between the header and the report, extracted from the component so
 * anchoring, ordering, and deduplication are testable without a DOM
 * (the same seam pattern as `transcript-rows.ts`).
 */

/** The fields of a tool-call row the flow needs; the caller's richer row type
 *  travels through generically so the view gets its original objects back. */
export interface FlowToolCall {
  id: number;
  toolName: string;
  status: string;
  toolCallId: string | null;
  parentToolCallId: string | null;
  input: Record<string, unknown> | null;
  createdAt: unknown;
}

export interface FlowArtifact {
  id: number;
  content?: string | null;
  metadata?: unknown;
  createdAt: unknown;
}

export type SubagentFlowItem<TCall extends FlowToolCall = FlowToolCall> =
  | { kind: "prompt"; key: string; ts: number; content: string }
  | { kind: "message"; key: string; ts: number; content: string }
  | { kind: "tool"; key: string; ts: number; call: TCall };

/** Same-second tiebreak: a prompt opens its turn, tools run it, the message closes it. */
const FLOW_RANK: Record<SubagentFlowItem["kind"], number> = {
  prompt: 0,
  tool: 1,
  message: 2,
};

/** Second-grained DB timestamps vs ms — anything before ~2001 in ms is seconds. */
export function toMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  return 0;
}

function parseArtifactMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Build the flow: the agent's tool calls and messages in execution order,
 * plus its continuation turns.
 *
 * Anchor ids whose children/messages belong to this agent: the spawn call
 * plus every SendMessage continuation addressed to the agent (`agentId`).
 * Each continuation also contributes the parent's outbound message as a
 * prompt item, so turn boundaries stay visible in the flow.
 */
export function buildSubagentFlow<TCall extends FlowToolCall>(args: {
  /** Provider tool-use id of the spawning call. */
  subagentId: string;
  /** The agent's continuation handle, when known. */
  agentId?: string;
  toolCalls: TCall[];
  artifacts: FlowArtifact[];
}): SubagentFlowItem<TCall>[] {
  const { subagentId, agentId, toolCalls, artifacts } = args;
  const items: SubagentFlowItem<TCall>[] = [];

  const anchorIds = new Set<string>([subagentId]);
  if (agentId) {
    for (const call of toolCalls) {
      if (!isContinuationTool(call.toolName)) continue;
      if (call.input?.to !== agentId) continue;
      if (call.toolCallId) anchorIds.add(call.toolCallId);
      const message = call.input?.message;
      if (typeof message === "string" && message.trim()) {
        items.push({
          kind: "prompt",
          key: `prompt-${call.id}`,
          ts: toMs(call.createdAt),
          content: message,
        });
      }
    }
  }

  for (const call of toolCalls) {
    if (!call.parentToolCallId || !anchorIds.has(call.parentToolCallId)) continue;
    items.push({
      kind: "tool",
      key: `tool-${call.id}`,
      ts: toMs(call.createdAt),
      call,
    });
  }

  for (const artifact of artifacts) {
    if (!artifact.content) continue;
    const metadata = parseArtifactMetadata(artifact.metadata);
    const parent = metadata.parentToolUseId;
    if (typeof parent !== "string" || !anchorIds.has(parent)) continue;
    items.push({
      kind: "message",
      key: `msg-${artifact.id}`,
      ts: toMs(artifact.createdAt),
      content: artifact.content,
    });
  }

  // Timestamps are second-grained, so ties are real — break them by turn
  // role, then by the source row id (keys end in it; a rank tie is always
  // same-kind, so the ids come from the same table and compare cleanly).
  const rowId = (item: SubagentFlowItem<TCall>): number =>
    Number(item.key.slice(item.key.lastIndexOf("-") + 1)) || 0;
  return items.sort(
    (a, b) =>
      a.ts - b.ts ||
      FLOW_RANK[a.kind] - FLOW_RANK[b.kind] ||
      rowId(a) - rowId(b),
  );
}

/**
 * The report block under the flow. The provider's result usually IS the
 * flow's last message — render it separately only when it adds something the
 * flow doesn't already show.
 */
export function selectSubagentReport(
  finalReport: string | undefined,
  flow: SubagentFlowItem<FlowToolCall>[],
): string | undefined {
  if (!finalReport) return undefined;
  const lastMessage = [...flow].reverse().find((item) => item.kind === "message");
  const lastContent =
    lastMessage?.kind === "message" ? lastMessage.content.trim() : "";
  return finalReport.trim() !== lastContent ? finalReport : undefined;
}
