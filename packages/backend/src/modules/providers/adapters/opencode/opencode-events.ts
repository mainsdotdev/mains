import type {
  CommandInfo,
  DriverOutcome,
  ModelInfo,
  WorkRunEvent,
} from "../../../../../shared/adapter.types";

/** OpenCode 1.x speaks a different HTTP API. Mains talks to 2.x over ACP. */
export const MINIMUM_OPENCODE_VERSION = "2.0.0";

export interface ParsedOpenCodeVersion {
  version: string;
  major: number;
}

export interface OpenCodeAuthIntegration {
  id: string;
  name: string;
}

/** `opencode auth list --format json`. Names only; credential secrets stay out. */
export function parseOpenCodeAuthList(stdout: string): OpenCodeAuthIntegration[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as { id?: unknown; name?: unknown; connections?: unknown };
    const connections = Array.isArray(record.connections) ? record.connections : [];
    const stored = connections.some((connection) =>
      connection && typeof connection === "object" && (connection as { type?: unknown }).type === "credential",
    );
    if (!stored || typeof record.id !== "string" || typeof record.name !== "string") return [];
    return [{ id: record.id, name: record.name }];
  });
}

export function parseOpenCodeVersion(output: string): ParsedOpenCodeVersion | null {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { version: `${match[1]}.${match[2]}.${match[3]}`, major: Number(match[1]) };
}

export function openCodeCliCompatibility(
  output: string,
): "supported" | "unsupported" | "unknown" {
  const parsed = parseOpenCodeVersion(output);
  if (!parsed) return "unknown";
  return parsed.major >= 2 ? "supported" : "unsupported";
}

export interface AcpConfigOption {
  id?: string;
  category?: string;
  name?: string;
  currentValue?: string;
  options?: Array<{ value?: string; name?: string }>;
}

/** Variant ids for the model that is selected in this config-option set. `default` is not a level. */
export function effortLevelsFromConfigOptions(options: AcpConfigOption[] | undefined): string[] {
  const effort = options?.find((option) => option.id === "effort" || option.category === "thought_level");
  const seen = new Set<string>();
  const levels: string[] = [];
  for (const choice of effort?.options ?? []) {
    const value = choice.value?.trim();
    if (!value || value === "default" || seen.has(value)) continue;
    seen.add(value);
    levels.push(value);
  }
  return levels;
}

/** The model whose variants the accompanying `effort` option describes. */
export function currentModelIdFromConfigOptions(options: AcpConfigOption[] | undefined): string | undefined {
  const model = options?.find((option) => option.id === "model" || option.category === "model");
  return typeof model?.currentValue === "string" && model.currentValue ? model.currentValue : undefined;
}

export function modelsFromConfigOptions(
  options: AcpConfigOption[] | undefined,
  preferredId?: string,
): ModelInfo[] {
  const model = options?.find((option) => option.id === "model" || option.category === "model");
  const choices = model?.options ?? [];
  const ids = choices.flatMap((choice) => (typeof choice.value === "string" ? [choice.value] : []));
  const current = currentModelIdFromConfigOptions(options);
  const selected = preferredId && ids.includes(preferredId) ? preferredId : current && ids.includes(current) ? current : ids[0];
  const effort = effortLevelsFromConfigOptions(options);
  return choices.flatMap((choice) => {
    if (typeof choice.value !== "string" || !choice.value) return [];
    const showsEffort = choice.value === current && effort.length > 0;
    return [{
      id: choice.value,
      displayName: choice.name?.trim() || choice.value,
      isDefault: choice.value === selected,
      ...(showsEffort ? { supportsEffort: true, supportedEffortLevels: effort } : {}),
    }];
  });
}

export function commandsFromUpdate(update: Record<string, unknown>): CommandInfo[] {
  const available = update.availableCommands;
  if (!Array.isArray(available)) return [];
  return available.flatMap((command) => {
    if (!command || typeof command !== "object") return [];
    const name = (command as { name?: unknown }).name;
    if (typeof name !== "string" || !name) return [];
    const description = (command as { description?: unknown }).description;
    return [{
      name,
      ...(typeof description === "string" ? { description } : {}),
      userFacing: true,
    }];
  });
}

export interface AcpPermissionOption {
  optionId?: string;
  kind?: string;
}

export function selectPermissionOption(
  options: AcpPermissionOption[] | undefined,
  decision: "allow_once" | "allow_always" | "reject_once",
): string {
  const match = options?.find((option) => option.kind === decision)?.optionId;
  if (typeof match === "string" && match) return match;
  if (decision === "allow_once") return "once";
  if (decision === "allow_always") return "always";
  return "reject";
}

export interface OpenCodeToolState {
  toolName: string;
  input?: Record<string, unknown>;
  /** A start was already emitted. Later in-progress deltas must not insert another row. */
  started: boolean;
}

export interface OpenCodeTurnProjection {
  runId: string;
  text: string;
  thought: string;
  generation: number;
  streamPrefix: string;
  tools: Map<string, OpenCodeToolState>;
}

function toolIdentity(update: Record<string, unknown>): { id?: string; name: string; input?: Record<string, unknown> } {
  const id = typeof update.toolCallId === "string" ? update.toolCallId : undefined;
  const title = typeof update.title === "string" && update.title ? update.title : undefined;
  const kind = typeof update.kind === "string" && update.kind ? update.kind : undefined;
  const rawInput = update.rawInput;
  const input = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
    ? rawInput as Record<string, unknown>
    : undefined;
  return { id, name: title || kind || "tool", input: normalizeToolInput(input) };
}

/**
 * The transcript reads Claude's snake_case edit fields. OpenCode sends camelCase
 * hunks (`oldString` / `newString`), not a full-file snapshot. Leave `path` as-is:
 * copying it to `file_path` would collapse consecutive hunks into one diff.
 */
function normalizeToolInput(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!input) return input;
  const next = { ...input };
  if (typeof next.oldString === "string" && typeof next.old_string !== "string") next.old_string = next.oldString;
  if (typeof next.newString === "string" && typeof next.new_string !== "string") next.new_string = next.newString;
  return next;
}

function toolOutput(update: Record<string, unknown>): unknown {
  const content = update.content;
  if (Array.isArray(content)) {
    const text = content.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const record = part as Record<string, unknown>;
      const block = record.type === "content" && record.content && typeof record.content === "object"
        ? record.content as Record<string, unknown>
        : record;
      return block.type === "text" && typeof block.text === "string" ? [block.text] : [];
    });
    if (text.length > 0) return text.join("\n");
  }
  const raw = update.rawOutput;
  if (raw && typeof raw === "object" && "content" in raw && (raw as { content?: unknown }).content != null) {
    return (raw as { content: unknown }).content;
  }
  return raw;
}

function toolError(update: Record<string, unknown>, output: unknown, failed: boolean): string | undefined {
  if (!failed) return undefined;
  const raw = update.rawOutput;
  if (raw && typeof raw === "object") {
    const error = (raw as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  if (typeof output === "string" && output.trim()) return output;
  return "Tool call failed";
}

function flushText(state: OpenCodeTurnProjection, events: WorkRunEvent[], phase: "commentary" | "final_answer"): void {
  if (!state.text) return;
  events.push({
    type: "artifact",
    kind: "report",
    content: state.text,
    metadata: {
      source: "agent_message",
      streamId: `${state.streamPrefix}-${state.generation}`,
      messagePhase: phase,
    },
  });
  state.text = "";
  state.generation += 1;
}

/** Project one ACP `session/update` payload into Mains events. */
export function projectSessionUpdate(
  state: OpenCodeTurnProjection,
  update: Record<string, unknown>,
  now = Date.now(),
): WorkRunEvent[] {
  const events: WorkRunEvent[] = [];
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const content = update.content as { text?: unknown } | undefined;
      if (typeof content?.text === "string" && content.text) {
        state.text += content.text;
        events.push({
          type: "artifact",
          kind: "report",
          content: state.text,
          metadata: { source: "agent_message_streaming" },
          ephemeral: true,
          streamId: `${state.streamPrefix}-${state.generation}`,
        });
      }
      break;
    }
    case "agent_thought_chunk": {
      const content = update.content as { text?: unknown } | undefined;
      if (typeof content?.text === "string" && content.text) {
        state.thought += content.text;
        events.push({
          type: "artifact",
          kind: "report",
          content: state.thought,
          metadata: { source: "agent_thought_streaming" },
          ephemeral: true,
          streamId: `opencode-think-${state.runId}`,
        });
      }
      break;
    }
    case "tool_call":
    case "tool_call_update": {
      const tool = toolIdentity(update);
      const cached = tool.id ? state.tools.get(tool.id) : undefined;
      const toolName = tool.name !== "tool" ? tool.name : (cached?.toolName ?? tool.name);
      const input = tool.input
        ? { ...cached?.input, ...tool.input }
        : cached?.input;
      const status = typeof update.status === "string" ? update.status : "in_progress";
      const failed = status === "failed";
      const canceled = status === "cancelled" || status === "canceled";
      const done = status === "completed" || failed || canceled;
      const started = cached?.started === true;
      if (tool.id) state.tools.set(tool.id, { toolName, input, started: true });
      if (!started) {
        flushText(state, events, "commentary");
        if (state.thought) {
          events.push({
            type: "artifact",
            kind: "report",
            content: "",
            metadata: { source: "agent_thought_streaming" },
            ephemeral: true,
            streamId: `opencode-think-${state.runId}`,
          });
          state.thought = "";
        }
        events.push({
          type: "tool_call",
          toolName,
          input,
          startedAt: now,
          metadata: { phase: "start", toolCallId: tool.id, kind: update.kind },
        });
      }
      if (!done) break;
      const output = toolOutput(update);
      events.push({
        type: "tool_call",
        toolName,
        input,
        endedAt: now,
        terminalStatus: failed ? "error" : canceled ? "canceled" : "done",
        ...(output !== undefined ? { output } : {}),
        ...(failed ? { error: toolError(update, output, true) } : {}),
        metadata: { phase: "complete", toolCallId: tool.id, kind: update.kind },
      });
      break;
    }
    case "usage_update": {
      const used = typeof update.used === "number" ? update.used : undefined;
      const size = typeof update.size === "number" ? update.size : undefined;
      if (used !== undefined && size && size > 0) {
        events.push({
          type: "context_usage",
          totalTokens: used,
          maxTokens: size,
          percentage: Math.max(0, Math.min(100, Math.round((used / size) * 100))),
        });
      }
      break;
    }
    default:
      break;
  }
  return events;
}

export function finishOpenCodeTurn(state: OpenCodeTurnProjection, succeeded: boolean): WorkRunEvent | null {
  if (!state.text) return null;
  const event: WorkRunEvent = {
    type: "artifact",
    kind: "report",
    content: state.text,
    metadata: {
      source: "agent_message",
      streamId: `${state.streamPrefix}-${state.generation}`,
      ...(succeeded ? { messagePhase: "final_answer" } : {}),
    },
  };
  state.text = "";
  state.generation += 1;
  return event;
}

/** OpenCode's own stand-in before it has named the session. */
const OPENCODE_PLACEHOLDER_TITLE = /^(?:New|Child) session - \d{4}-\d{2}-\d{2}T/;

/** A generated session title. Placeholders and blanks stay off the run. */
export function openCodeSessionTitle(title: unknown): string | null {
  if (typeof title !== "string") return null;
  const trimmed = title.trim();
  if (!trimmed || OPENCODE_PLACEHOLDER_TITLE.test(trimmed)) return null;
  return trimmed;
}

/** Title of one session inside a `session/list` result. */
export function titleFromSessionList(result: unknown, sessionId: string): string | null {
  const sessions = (result as { sessions?: unknown } | null)?.sessions;
  if (!Array.isArray(sessions)) return null;
  const match = sessions.find((entry) =>
    !!entry && typeof entry === "object" && (entry as { sessionId?: unknown }).sessionId === sessionId,
  ) as { title?: unknown } | undefined;
  return openCodeSessionTitle(match?.title);
}

export function mapStopReasonToOutcome(stopReason: string | undefined): Pick<DriverOutcome, "status" | "summary"> {
  if (stopReason === "cancelled") return { status: "canceled" };
  if (stopReason === "refusal") return { status: "failed", summary: "OpenCode refused the request" };
  if (stopReason === "max_tokens" || stopReason === "max_turn_requests") {
    return { status: "succeeded", summary: "Response truncated" };
  }
  return { status: "succeeded" };
}
