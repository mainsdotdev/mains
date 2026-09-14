/**
 * Subagent display identity, shared by every surface that names an agent —
 * session panel rows, the tab strip, and the detail tab header — so one agent
 * reads the same everywhere.
 */

/**
 * Humanize a provider's machine name for display:
 * "security_review" → "Security review", "test-gaps" → "Test gaps",
 * "generalPurpose" → "General purpose". Idempotent, so an already-human
 * title passes through unchanged.
 */
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

// The agent's accent color used to live here as a table of Tailwind classes
// that every call site had to remember to pair with the glyph. It is now
// hashed from the same seed inside `AgentGlyph` (see `glyphHue`), so the mark
// and its color cannot drift apart and the palette is no longer capped by
// Tailwind's hue families.

// ─────────────────────────────────────────────────────────────
// Tool vocabulary — the ONE place the subagent-related tool names live.
// Every semantic set below (naming, lifetime, chat-hiding, classification)
// derives from these; nothing else hand-writes these strings.
// ─────────────────────────────────────────────────────────────

/**
 * Claude's spawn tool, in its two wire spellings (the registry says `Task`,
 * emitted tool_use blocks say `Agent`). Its call stays open for the agent's
 * whole (foreground) life, and its `description` input is the task's human
 * title.
 */
export const CLAUDE_SPAWN_TOOLS: ReadonlySet<string> = new Set([
  "agent",
  "task",
]);

/**
 * Codex AgentControl collab variants, as the event mapper names them for the
 * renderer. All detached: the call returns as soon as the collab op lands.
 */
export const CODEX_COLLAB_TOOLS: ReadonlySet<string> = new Set([
  "spawnagent",
  "sendcollabinput",
  "waitcollabagent",
  "closecollabagent",
  "resumecollabagent",
  "sendcollabmessage",
  "followupcollabtask",
  "interruptcollabagent",
  "listcollabagents",
]);

/** Claude's SendMessage — continues an existing (background) agent. */
export function isContinuationTool(toolName: string): boolean {
  return toolName.toLowerCase() === "sendmessage";
}

/**
 * Tools whose `description` (the task's short human title — "Security review
 * of subagent-display branch") is the agent's real name, while
 * `subagent_type` is a generic capability: Claude spawns plus SendMessage
 * continuations (the CLI runs those as agent tasks too). Detached spawns
 * (Codex) are the opposite: agentType carries the nickname and the
 * description is just the prompt's first line.
 */
const DESCRIPTION_TITLED_TOOLS = new Set([...CLAUDE_SPAWN_TOOLS, "sendmessage"]);

/** What a subagent surface should print: primary name + muted detail. */
export function subagentDisplay(args: {
  toolName: string;
  agentType: string;
  description?: string;
}): { name: string; detail?: string } {
  const human = humanizeAgentName(args.agentType);
  const description = args.description?.trim();
  if (DESCRIPTION_TITLED_TOOLS.has(args.toolName.toLowerCase()) && description) {
    return { name: description, detail: human };
  }
  return { name: human, detail: description };
}

// Shared with the Claude driver across the process boundary — see the
// definition for semantics.
export { AGENT_ID_IN_RESULT } from "../../../../shared/subagent";

/**
 * CANONICAL shape of `metadata.task` as persisted by run-session's
 * `projectTask`. Every consumer (panel selector, detail view, state
 * synthesis) imports this — no partial redeclarations.
 */
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
  outputFile?: string;
  lastToolName?: string;
  usage?: { totalTokens?: number; toolUses?: number; durationMs?: number };
  skipTranscript?: boolean;
  updatedAt?: number;
}

/**
 * CANONICAL shape of `metadata.subagent` as persisted by run-session's
 * `projectSubagent`. Same rule: import, never redeclare.
 */
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

export type SubagentLifecycleState = "running" | "done" | "failed" | "stopped";

/**
 * Tools whose call stays open for the agent's whole life, making the call's
 * own "done" the agent's completion. NOT SendMessage — that returns as soon
 * as the message is delivered, like a detached spawn.
 */
const CALL_STATUS_REFLECTS_AGENT = CLAUDE_SPAWN_TOOLS;

/**
 * The one place a subagent's displayed state is derived — the session panel
 * and the detail tab must agree, and an agent can leave its lifecycle on
 * `metadata.subagent`, `metadata.task` (background tasks, SendMessage
 * continuations), or nowhere but the call status. Consulted in severity
 * order: failures, stops, completions, then the call-status shortcut.
 */
export function subagentStateOf(args: {
  toolName: string;
  callStatus: string;
  task?: SubagentTaskMeta;
  subagent?: SubagentLifecycleMeta;
}): SubagentLifecycleState {
  const { toolName, callStatus, task, subagent } = args;

  // EXPLICIT lifecycle first — everything the provider/finalizer actually
  // said about the agent outranks anything inferred from the raw call status.
  // (Run finalization marks a canceled run's still-open calls "error" AND its
  // agents "stopped"; reading the call status first painted those failed.)
  if (task?.error || task?.status === "failed" || subagent?.phase === "failed") {
    return "failed";
  }
  if (task?.status === "stopped" || task?.status === "killed") return "stopped";
  // Run finalization settles agents whose terminal event never arrived
  // (aborted run) as "stopped" — see run-session settleUnfinishedSubagents.
  if (subagent?.phase === "stopped") return "stopped";
  if (
    task?.phase === "completed" ||
    task?.status === "completed" ||
    subagent?.phase === "completed"
  ) {
    return "done";
  }

  // Only now the inferred signals from the call row itself.
  if (callStatus === "error") return "failed";
  if (callStatus === "canceled") return "stopped";
  // The done-shortcut only applies when NO task metadata landed: a
  // backgrounded agent's call is "done" the moment the launch ack returns
  // while the task keeps running, so whenever a task exists, IT is the
  // authoritative live state.
  if (
    callStatus === "done" &&
    !task &&
    CALL_STATUS_REFLECTS_AGENT.has(toolName.toLowerCase())
  ) {
    return "done";
  }
  return "running";
}
