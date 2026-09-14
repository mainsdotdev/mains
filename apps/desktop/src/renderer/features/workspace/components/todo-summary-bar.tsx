import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { RunEvent } from "../types";
import { resolveTool } from "../lib/resolve-tool";
import { Check } from "@/components/ui/icons";
import {
  AsciiSpinner,
  Button,
  Text,
  toastStore,
  type AsciiSpinnerVariant,
} from "@/components/ui";

interface TodoSummaryBarProps {
  events: RunEvent[];
  structuralPlan?: StructuralPlanSnapshot | null;
  variant?: AsciiSpinnerVariant;
}

export interface TodoItem {
  content: string;
  status: "completed" | "in_progress" | "pending";
  activeForm?: string;
}

export interface StructuralPlanSnapshot {
  providerTurnId: string;
  explanation?: string;
  steps: Array<{
    step: string;
    status: TodoItem["status"];
  }>;
  updatedAt?: number;
}

export function parseStructuralPlanSnapshot(
  value: unknown,
): StructuralPlanSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.providerTurnId !== "string" ||
    !Array.isArray(candidate.steps)
  ) {
    return null;
  }

  const steps = candidate.steps.flatMap((rawStep) => {
    if (!rawStep || typeof rawStep !== "object") return [];
    const step = rawStep as Record<string, unknown>;
    if (
      typeof step.step !== "string" ||
      (
        step.status !== "pending" &&
        step.status !== "in_progress" &&
        step.status !== "completed"
      )
    ) {
      return [];
    }
    const status = step.status as TodoItem["status"];
    return [{
      step: step.step,
      status,
    }];
  });

  return {
    providerTurnId: candidate.providerTurnId,
    ...(typeof candidate.explanation === "string"
      ? { explanation: candidate.explanation }
      : {}),
    steps,
    ...(typeof candidate.updatedAt === "number"
      ? { updatedAt: candidate.updatedAt }
      : {}),
  };
}

function parseEventInput(event: RunEvent): Record<string, unknown> | null {
  const raw = event.metadata?.input;
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // fall through to content parse
    }
  }
  const colonIdx = event.content.indexOf(":");
  if (colonIdx > 0) {
    try {
      return JSON.parse(event.content.slice(colonIdx + 1).trim()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Aggregate TaskCreate (one call per item) + TaskUpdate (taskId/status) calls
 * into a single `TodoItem[]` snapshot. The 1-based `taskId` indexes into the
 * accumulated array.
 */
function buildTaskSnapshot(events: RunEvent[]): TodoItem[] | null {
  const todos: TodoItem[] = [];

  for (const event of events) {
    if (event.type !== "tool_call") continue;
    const name = resolveTool(event.content).displayName;
    if (name !== "TaskCreate" && name !== "TaskUpdate") continue;

    const input = parseEventInput(event);
    if (!input) continue;

    if (name === "TaskCreate") {
      const subject = typeof input.subject === "string" ? input.subject : "";
      if (subject.length === 0) continue;
      const activeForm =
        typeof input.activeForm === "string" ? input.activeForm : undefined;
      todos.push({ content: subject, status: "pending", activeForm });
      continue;
    }

    const taskIdRaw = input.taskId;
    const idx =
      typeof taskIdRaw === "string"
        ? parseInt(taskIdRaw, 10) - 1
        : typeof taskIdRaw === "number"
          ? taskIdRaw - 1
          : NaN;
    if (!Number.isFinite(idx) || idx < 0 || idx >= todos.length) continue;

    const status = input.status;
    if (status === "in_progress" || status === "completed" || status === "pending") {
      todos[idx] = { ...todos[idx], status };
    }
  }

  return todos.length > 0 ? todos : null;
}

function normalizeStatus(status: unknown): TodoItem["status"] {
  const s = String(status ?? "").toLowerCase();
  if (s === "completed" || s === "done" || s === "complete" || s === "closed") return "completed";
  if (s === "in_progress" || s === "in-progress" || s === "running" || s === "active") return "in_progress";
  return "pending";
}

/**
 * Use the latest full-snapshot todo write (e.g. Copilot's `UpdateTodos`,
 * synthesized from `session.todos_changed`). Each event carries the complete
 * todo list under `input.todos`, so the most recent non-empty one wins — no
 * incremental accumulation like TaskCreate/TaskUpdate.
 */
function buildSnapshotTodos(events: RunEvent[]): TodoItem[] | null {
  let latest: TodoItem[] | null = null;

  for (const event of events) {
    if (event.type !== "tool_call") continue;
    if (resolveTool(event.content).displayName !== "UpdateTodos") continue;

    const input = parseEventInput(event);
    const rawTodos = input?.todos;
    if (!Array.isArray(rawTodos)) continue;

    const mapped = rawTodos
      .map((t) => {
        const item = (t ?? {}) as Record<string, unknown>;
        return {
          content: String(item.content ?? item.title ?? "").trim(),
          status: normalizeStatus(item.status),
        };
      })
      .filter((t) => t.content.length > 0);

    if (mapped.length > 0) latest = mapped;
  }

  return latest;
}

export function selectTodoSnapshot(
  events: RunEvent[],
  structuralPlan?: StructuralPlanSnapshot | null,
): TodoItem[] | null {
  if (structuralPlan) {
    return structuralPlan.steps.map((step) => ({
      content: step.step,
      status: step.status,
    }));
  }
  return buildSnapshotTodos(events) ?? buildTaskSnapshot(events);
}

/**
 * The bar floats over the transcript, so it has to earn that space. A finished
 * list ("Task 6/6 · All tasks completed") tells the reader nothing they need
 * mid-run while covering the text they are actually reading — so the widget
 * shows only while at least one step is still in progress or pending.
 */
export function hasOutstandingWork(
  todos: TodoItem[] | null,
): todos is TodoItem[] {
  return !!todos && todos.some((todo) => todo.status !== "completed");
}

/**
 * Toast-style plan widget floating at the top of the workspace content column
 * (absolutely positioned against the page container — not the viewport, so it
 * stays centered over the transcript when the embedded browser panel or the
 * session box shrinks the content area; `content-inset` mirrors the latter).
 * Same pill look as `Toaster`, but deliberately NOT routed through the toast
 * store — it is run-scoped, continuously updated React state, not a queued
 * message.
 * Collapsed it shows a spinner + "Task N/M" + the active step; hovering
 * expands it down and outward into the full checklist. Clicking pins it open.
 * Replaces the per-call TaskCreate/TaskUpdate cards in the message timeline
 * (those are filtered out by `groupConsecutiveToolCalls`) so users see one
 * continuously-updated plan instead of repeating snapshots.
 *
 * Lifecycle: the parent mounts this only while the active run's status is
 * "running" (so it disappears when the run finishes). It also returns null on
 * its own when the current events carry no todos, and once every step is
 * completed — see `hasOutstandingWork`.
 */
export function TodoSummaryBar({
  events,
  structuralPlan,
  variant,
}: TodoSummaryBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Real toasts render at the same top-center anchor (`Toaster`, z 99999).
  // Track the store so this widget slides down while any are visible instead
  // of overlapping them.
  const activeToasts = useSyncExternalStore(
    toastStore.subscribe,
    toastStore.getSnapshot,
    toastStore.getSnapshot,
  );

  useEffect(
    () => () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    },
    [],
  );

  // A provider-native structural plan is authoritative. Fall back to the
  // legacy tool-call projections for providers without this event stream.
  const todos = useMemo(
    () => selectTodoSnapshot(events, structuralPlan),
    [events, structuralPlan],
  );

  if (!hasOutstandingWork(todos)) return null;

  const completedCount = todos.filter((t) => t.status === "completed").length;
  const currentStep = Math.min(completedCount + 1, todos.length);
  const inProgress = todos.find((t) => t.status === "in_progress");
  // Never "all completed" — that snapshot unmounts the widget above.
  const activeLabel =
    inProgress?.content ?? todos.find((t) => t.status === "pending")?.content;

  const open = () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    setIsExpanded(true);
  };
  // Small grace period so grazing the edge doesn't snap the panel shut.
  const scheduleClose = () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => {
      setIsExpanded(false);
      setIsPinned(false);
    }, 200);
  };

  return (
    <div className="absolute top-0 inset-x-0 z-9990 flex justify-center pt-4 content-inset pointer-events-none">
      <div
        role="status"
        onMouseEnter={open}
        onMouseLeave={() => {
          if (!isPinned) scheduleClose();
        }}
        style={{
          transform:
            activeToasts.length > 0
              ? `translateY(${Math.min(activeToasts.length, 3) * 54}px)`
              : undefined,
        }}
        className={`pointer-events-auto w-full overflow-hidden glass-outline bg-primary dark:bg-primary-950 text-primary-950 dark:text-primary transition-all duration-200 ease-out ${
          isExpanded ? "max-w-130 rounded-3xl" : "max-w-80 rounded-3xl"
        }`}
      >
        <Button
          onClick={() => setIsPinned((v) => !v)}
          className="flex items-center gap-3 w-full px-5 py-3 cursor-pointer"
        >
          <AsciiSpinner variant={variant} kind="circle" />
          <Text as="span" size="sm" tone="inherit" weight="medium" className="whitespace-nowrap shrink-0 tabular-nums">
            Task {currentStep}/{todos.length}
          </Text>
          {activeLabel && (
            <Text as="span" size="xs" tone="warning" align="left" className="truncate min-w-0 flex-1">
              {activeLabel}
            </Text>
          )}
        </Button>

        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden min-h-0">
            <ol className="border-t border-primary-200/40 dark:border-primary-700/20 px-5 py-3 space-y-1.5 max-h-[50vh] overflow-y-auto">
              {todos.map((todo, idx) => {
                const isDone = todo.status === "completed";
                const isActive = todo.status === "in_progress";
                return (
                  <li
                    key={`${idx}-${todo.content}`}
                    className="flex items-start gap-2.5 text-xs"
                  >
                    <span
                      className={`mt-0.5 size-4 rounded-full  flex items-center justify-center shrink-0 ${
                        isDone
                          ? " bg-success/15 text-success"
                          : isActive
                            ? " bg-warning/20"
                            : " bg-primary-300/50 dark:bg-primary-600/40"
                      }`}
                      aria-hidden
                    >
                      {isDone && <Check className="size-2.5" />}
                      {isActive && (
                        <span className="size-1.5 rounded-full bg-warning animate-pulse" />
                      )}
                    </span>
                    <Text as="span" size="inherit" tone="subtle" align="right" className="tabular-nums shrink-0 w-4">
                      {idx + 1}.
                    </Text>
                    <Text
                      as="span"
                      size="inherit"
                      tone={isDone ? "subtle" : isActive ? "default" : "muted"}
                      weight={isActive && !isDone ? "medium" : undefined}
                      className={`min-w-0 flex-1 ${isDone ? "line-through" : ""}`}
                    >
                      {todo.content}
                    </Text>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
