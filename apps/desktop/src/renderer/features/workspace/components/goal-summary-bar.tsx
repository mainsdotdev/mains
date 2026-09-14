import { useState } from "react";
import { Button, Text, Textarea } from "@/components/ui";
import { Edit, Trash, Stop, Play, Check, Close, Goal } from "@/components/ui/icons";
import { useCodexGoal } from "../hooks/use-codex-goal";
import type { GoalInfo } from "@/lib/redux/api/providersApi";

interface GoalSummaryBarProps {
  providerId: string;
  runId: string | undefined;
  isRunning: boolean;
  /** Gate — only Codex runs have thread goals. */
  enabled: boolean;
  /** Workspace root — long `@<abs path>` mentions are shown relative to it. */
  rootPath?: string;
}

/**
 * Strip the workspace-root prefix from file paths in the objective so a single
 * deep mention doesn't dominate the bar — `@/Users/…/worktrees/x/src/foo.ts`
 * becomes `@src/foo.ts`. Handles both `@`-prefixed mentions and bare paths.
 */
function shortenObjective(text: string, rootPath?: string): string {
  if (!rootPath) return text;
  const root = rootPath.endsWith("/") ? rootPath : rootPath + "/";
  return text.split("@" + root).join("@").split(root).join("");
}

/** Human label for the goal's current state. */
function statusLabel(status: string, isRunning: boolean): string {
  switch (status) {
    case "complete":
      return "Goal complete";
    case "paused":
      return "Goal paused";
    case "blocked":
      return "Goal blocked";
    case "budgetLimited":
      return "Budget reached";
    case "usageLimited":
      return "Usage limit reached";
    default:
      return isRunning ? "Pursuing goal" : "Goal active";
  }
}

/** Icon/accent color for the goal's current state. */
function statusIconColor(status: string): string {
  switch (status) {
    case "blocked":
    case "budgetLimited":
    case "usageLimited":
      return "text-warning";
    case "paused":
      return "text-primary-600 dark:text-primary-400";
    default: // active + complete
      return "text-success";
  }
}

function formatUsage(goal: GoalInfo): string | null {
  const parts: string[] = [];
  if (typeof goal.tokensUsed === "number" && goal.tokensUsed > 0) {
    parts.push(`${goal.tokensUsed.toLocaleString()} tokens`);
  }
  if (typeof goal.timeUsedSeconds === "number" && goal.timeUsedSeconds > 0) {
    const s = goal.timeUsedSeconds;
    parts.push(s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Standalone bar shown directly above the input for a Codex run with an active
 * thread goal. Self-contained: pulls its own goal state via {@link useCodexGoal}
 * and renders Codex-style status + live usage with edit / pause / clear
 * controls. Returns null when there's no goal.
 */
export function GoalSummaryBar({ providerId, runId, isRunning, enabled, rootPath }: GoalSummaryBarProps) {
  const { goal, updateObjective, clear, pause, resume, isBusy } = useCodexGoal(providerId, runId, enabled);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!goal) return null;

  const isComplete = goal.status === "complete";
  const iconColor = statusIconColor(goal.status);
  const usage = formatUsage(goal);
  const shortObjective = shortenObjective(goal.objective, rootPath);

  const startEdit = () => {
    setDraft(shortObjective);
    setEditing(true);
  };

  const commitEdit = () => {
    const next = draft.trim();
    if (next && next !== goal.objective) updateObjective(next);
    setEditing(false);
  };

  return (
    <div className="w-full max-w-210 mx-auto mb-1">
      <div className="rounded-3xl glass-outline overflow-hidden px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {isComplete ? (
              <Check className={`size-3.5 shrink-0 ${iconColor}`} />
            ) : (
              <Goal className={`size-3.5 shrink-0 ${iconColor}`} />
            )}
            <Text as="span" size="xs" tone="muted" weight="medium" className="shrink-0">
              {statusLabel(goal.status, isRunning)}
            </Text>
            {usage && (
              <Text as="span" size="xs" tone="subtle" className="shrink-0">
                {usage}
              </Text>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {!editing && !isComplete && (
              <Button
                tooltip="Edit goal"
                type="button"
                onClick={startEdit}
                disabled={isBusy}
                className="rounded-full p-1 text-primary-600 hover:bg-primary-200/40 hover:text-primary-700 dark:text-primary-400 dark:hover:bg-primary-800 dark:hover:text-primary-300 cursor-pointer"
              >
                <Edit className="size-3.5" />
              </Button>
            )}
            {goal.status === "active" && (
              <Button
                tooltip="Pause goal (keep tracking, run continues)"
                type="button"
                onClick={() => pause()}
                disabled={isBusy}
                className="rounded-full p-1 text-primary-600 hover:bg-primary-200/40 hover:text-primary-700 dark:text-primary-400 dark:hover:bg-primary-800 dark:hover:text-primary-300 cursor-pointer"
              >
                <Stop className="size-3.5" />
              </Button>
            )}
            {goal.status === "paused" && (
              <Button
                tooltip="Resume goal"
                type="button"
                onClick={() => resume()}
                disabled={isBusy}
                className="rounded-full p-1 text-success hover:bg-success/10 cursor-pointer"
              >
                <Play className="size-3.5" />
              </Button>
            )}
            <Button
              tooltip="Clear goal"
              type="button"
              onClick={() => clear()}
              disabled={isBusy}
              className="rounded-full p-1 text-primary-600 hover:bg-danger/10 hover:text-danger dark:text-primary-400 cursor-pointer"
            >
              <Trash className="size-3.5" />
            </Button>
          </div>
        </div>

        {editing ? (
          <div className="mt-1.5 flex items-start gap-1">
            <Textarea
              autoFocus
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
              aria-label="Goal objective"
              className="max-h-48 flex-1 resize-none overflow-y-auto px-2 text-xs leading-relaxed text-primary-800 dark:text-primary-200"
              placeholder="Goal objective…"
            />
            <Button
              tooltip="Save"
              type="button"
              onClick={commitEdit}
              disabled={isBusy}
              className="mt-0.5 p-1 rounded-full text-success hover:bg-success/10 cursor-pointer"
            >
              <Check className="size-3.5" />
            </Button>
            <Button
              tooltip="Cancel"
              type="button"
              onClick={() => setEditing(false)}
              className="mt-0.5 rounded-full p-1 text-primary-600 hover:bg-primary-200/40 dark:text-primary-400 dark:hover:bg-primary-800 cursor-pointer"
            >
              <Close className="size-3.5" />
            </Button>
          </div>
        ) : (
          <p
            title={goal.objective}
            className="mt-0.5 line-clamp-2 text-xs text-primary-600 dark:text-primary-400"
          >
            {shortObjective}
          </p>
        )}
      </div>
    </div>
  );
}
