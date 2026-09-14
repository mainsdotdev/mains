import { useState } from "react";
import { Button, SquareSpinner, Text } from "@/components/ui";
import {
  subagentStateOf,
  type SubagentLifecycleMeta,
  type SubagentLifecycleState,
  type SubagentTaskMeta,
} from "../../lib/subagent-identity";
import { Bot, Clock, Document, Stop } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolOutputBody } from "./_shared";

/**
 * `metadata.task` — written by `run-session.ts` from the provider's task
 * lifecycle events. Every field is optional: the strip renders from whatever
 * phase has landed so far, and later phases patch in more.
 */
// The persisted shapes live in ONE place (subagent-identity); the strip's
// historical names are kept as aliases so its consumers read naturally.
export type TaskMetadata = SubagentTaskMeta;

/** `metadata.subagent` — the subagent's own lifecycle, keyed to the same tool call. */
export type SubagentMetadata = SubagentLifecycleMeta;

/**
 * One decimal on the k/M scale throughout. The strip re-renders as a task
 * progresses, and whole-thousand rounding would stall the readout ("16k → 16k")
 * across increments a decimal still distinguishes.
 */
function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

function formatUsage(usage: TaskMetadata["usage"]): string {
  if (!usage) return "";
  const parts: string[] = [];
  if (usage.totalTokens) parts.push(`${formatTokens(usage.totalTokens)} tokens`);
  if (usage.toolUses) parts.push(`${usage.toolUses} tool${usage.toolUses === 1 ? "" : "s"}`);
  if (usage.durationMs) parts.push(formatDuration(usage.durationMs));
  return parts.join(" · ");
}

export type Tone = "running" | "ok" | "warn" | "error";

/** Derived from THE state synthesis, not re-encoded — one lifecycle truth. */
const STATE_TONE: Record<SubagentLifecycleState, Tone> = {
  failed: "error",
  stopped: "warn",
  done: "ok",
  running: "running",
};

function toneOf(task: TaskMetadata): Tone {
  return STATE_TONE[subagentStateOf({ toolName: "", callStatus: "", task })];
}

const TONE_TEXT: Record<Tone, string> = {
  running: "text-primary-600 dark:text-primary-400",
  ok: "text-success dark:text-success",
  warn: "text-warning dark:text-warning",
  error: "text-danger dark:text-danger",
};

/** Subagent tasks read as delegation; bash tasks read as backgrounded work. */
function labelFor(task: TaskMetadata, tone: Tone): string {
  const isAgent = task.taskType === "local_agent" || !!task.subagentType;
  if (tone === "running") {
    return isAgent ? "Subagent working" : "Running in background";
  }
  if (tone === "error") return isAgent ? "Subagent failed" : "Background task failed";
  if (tone === "warn") return isAgent ? "Subagent stopped" : "Background task stopped";
  return isAgent ? "Subagent finished" : "Finished in background";
}

function IconFor({ tone }: { tone: Tone }) {
  if (tone === "running") return <SquareSpinner />;
  if (tone === "ok") return <Bot className="size-4" />;
  if (tone === "warn") return <Stop className="size-4" />;
  return <Clock className="size-4" />;
}

export interface TaskPresentation {
  tone: Tone;
  label: string;
  /** Task description shown inline next to the label. */
  description?: string;
  /** Expandable body: the error, the subagent's report, or the recovered output. */
  detail?: string;
  /** Muted trailing context — last tool and usage totals. */
  context: string;
  outputFile?: string;
}

/**
 * Decide what the strip shows. Exported so the branch that matters — which
 * text counts as a body worth expanding — is testable without a DOM.
 *
 * Returns null when there is nothing to render: no metadata at all, or a task
 * the provider flagged as ambient housekeeping.
 */
export function selectTaskPresentation(
  task?: TaskMetadata,
  subagent?: SubagentMetadata,
): TaskPresentation | null {
  if (!task && !subagent) return null;
  if (task?.skipTranscript) return null;

  const t: TaskMetadata = task ?? {};
  const tone = toneOf(t);

  // For a subagent, `summary` is the report itself; for a backgrounded command
  // it is just the description echoed back. Only treat it as a body when it
  // actually says something the header line doesn't.
  const summary = t.summary?.trim();
  const report =
    summary && summary !== t.description?.trim() ? summary : subagent?.result?.trim();

  return {
    tone,
    label: labelFor(t, tone),
    description: t.description,
    detail: t.error?.trim() || report || undefined,
    context: [t.lastToolName, formatUsage(t.usage)].filter(Boolean).join(" · "),
    outputFile: t.outputFile,
  };
}

/**
 * Compact strip rendered under any tool call that spawned a task.
 *
 * It exists because a task outlives the tool call that started it: a Bash
 * command past the foreground timeout is backgrounded and its tool_result is
 * only "Command running in background with ID: …", and an Agent call returns
 * once its subagent is done but never renders that subagent's report. Both
 * outcomes arrive later on `metadata.task` / `metadata.subagent`, so without
 * this strip the run shows a finished tool call whose actual result is
 * nowhere on screen.
 */
export function TaskProgressStrip({
  task,
  subagent,
  isCompact = false,
}: {
  task?: TaskMetadata;
  subagent?: SubagentMetadata;
  isCompact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const view = selectTaskPresentation(task, subagent);
  if (!view) return null;

  const { tone, label, description, detail, context, outputFile } = view;
  const hasDetail = !!detail;

  return (
    <div className="flex flex-col">
      <Button
        onClick={() => hasDetail && setIsExpanded((v) => !v)}
        className={`group flex w-full min-w-0 items-center gap-1.5 py-0.5 text-s font-sans ${
          hasDetail ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <span className={`shrink-0 ${TONE_TEXT[tone]}`}>
          <IconFor tone={tone} />
        </span>
        {!isCompact && (
          <span className={`shrink-0 font-medium ${TONE_TEXT[tone]}`}>{label}</span>
        )}
        {description && (
          <span className={`truncate ${TOOL_ROW_TEXT}`}>
            {description}
          </span>
        )}
        {context && (
          <Text as="span" size="inherit" tone="subtle" className="shrink-0">{context}</Text>
        )}
      </Button>

      {hasDetail && (
        <ToolCollapse isExpanded={isExpanded}>
          <ToolOutputBody as="div" className="text-s whitespace-pre-wrap">
            {detail}
          </ToolOutputBody>
          {outputFile && (
            <Text as="div" size="s" tone="subtle" className="flex items-center gap-1 pt-1">
              <Document className="size-3 shrink-0" />
              <span className="truncate font-mono">{outputFile}</span>
            </Text>
          )}
        </ToolCollapse>
      )}

      {/* No body to expand, but the captured output still has a location worth
          surfacing — a backgrounded command's real stdout lives only there. */}
      {!hasDetail && outputFile && (
        <Text as="div" size="s" tone="subtle" className="flex items-center gap-1 py-0.5">
          <Document className="size-3 shrink-0" />
          <span className="truncate font-mono">{outputFile}</span>
        </Text>
      )}
    </div>
  );
}
