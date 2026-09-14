import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { ArrowUp } from "@/components/ui/icons";
import { Button, SquareSpinner, Text } from "@/components/ui";
import type { RunEvent } from "../../types";

const ToolDiffBodyContent = lazy(() => import("./tool-diff-body"));

/**
 * Tool-call lifecycle status, mirroring the `tool_calls.status` column
 * (`queued → running → done | error | canceled`). Surfaced on each event via
 * `metadata.status` in `run-event-mappers.ts`.
 */
export type ToolStatus = "queued" | "running" | "done" | "error" | "canceled";

/**
 * Status of the currently-rendered tool call. `ToolCallItem` provides the value
 * for a single call; `ToolSubGroupAccordion` provides the aggregate for a
 * collapsed multi-call group. Defaults to `done` so historical/legacy events
 * (no status) render exactly as before.
 */
const ToolStatusContext = createContext<ToolStatus>("done");
export const ToolStatusProvider = ToolStatusContext.Provider;
export function useToolStatus(): ToolStatus {
  return useContext(ToolStatusContext);
}

/** Read a normalized `ToolStatus` off an event's metadata (unknown → "done"). */
export function eventToolStatus(event: RunEvent): ToolStatus {
  const raw = event.metadata?.status;
  if (
    raw === "running" ||
    raw === "queued" ||
    raw === "error" ||
    raw === "canceled"
  ) {
    return raw;
  }
  return "done";
}

/**
 * Demote "stale" in-flight tool calls to `done` for display.
 *
 * A tool call spins while its persisted status is `running`/`queued`. Providers
 * don't all emit a per-tool completion event — some only resolve tool status in
 * a run-end sweep (see `closeRunningToolCallsInDb` in `run-session.ts`), and
 * Cursor/ACP in particular depends on a terminal `tool_call_update` that may
 * arrive late or never — so a finished tool can keep spinning for the rest of
 * the run. Heuristic: once the agent has produced any *later* output that isn't
 * itself an in-flight tool call (assistant text, a completed tool, …), every
 * in-flight tool call before that point has effectively finished and is shown
 * as `done`. The trailing block of in-flight tool calls (a parallel batch with
 * nothing after it) keeps spinning. Only `running`/`queued` are rewritten —
 * `error`, `canceled`, and real `done` pass through untouched. Returns the same
 * array reference when nothing changes so memoized consumers don't re-render.
 */
export function demoteStaleRunningTools(events: RunEvent[]): RunEvent[] {
  const isInflightTool = (e: RunEvent): boolean => {
    if (e.type !== "tool_call") return false;
    const s = e.metadata?.status;
    return s === "running" || s === "queued";
  };

  // Index of the last event that is NOT an in-flight tool call. Everything
  // after it is the trailing in-flight block and is left spinning.
  let cut = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (!isInflightTool(events[i])) {
      cut = i;
      break;
    }
  }
  if (cut <= 0) return events;

  let changed = false;
  const next = events.map((e, i) => {
    if (i < cut && isInflightTool(e)) {
      changed = true;
      return { ...e, metadata: { ...e.metadata, status: "done" } };
    }
    return e;
  });
  return changed ? next : events;
}

/**
 * Roll several tool calls up into one status for a group header. Severity order:
 * error > running > done > canceled. A group with any failure reads as failed;
 * any in-flight call reads as running; everything else settles to done.
 */
export function aggregateToolStatus(events: RunEvent[]): ToolStatus {
  let hasRunning = false;
  let hasError = false;
  let hasDone = false;
  let hasCanceled = false;
  for (const event of events) {
    switch (eventToolStatus(event)) {
      case "error":
        hasError = true;
        break;
      case "running":
      case "queued":
        hasRunning = true;
        break;
      case "canceled":
        hasCanceled = true;
        break;
      default:
        hasDone = true;
    }
  }
  if (hasError) return "error";
  if (hasRunning) return "running";
  if (hasDone) return "done";
  if (hasCanceled) return "canceled";
  return "done";
}

/**
 * Past-tense → present-participle map. Keyed by the lowercased past form so it
 * covers both built-in verbs ("Ran", "Read", "Edited") and the past-tense words
 * baked into MCP display names ("Linear **listed** issues"). Words not present
 * here are left untouched.
 */
const GERUND_BY_PAST: Record<string, string> = {
  // DEFAULT_VERBS (tool-registry) past forms
  listed: "listing",
  got: "getting",
  fetched: "fetching",
  read: "reading",
  searched: "searching",
  researched: "researching",
  saved: "saving",
  created: "creating",
  updated: "updating",
  deleted: "deleting",
  archived: "archiving",
  extracted: "extracting",
  added: "adding",
  removed: "removing",
  sent: "sending",
  ran: "running",
  drafted: "drafting",
  replied: "replying",
  opened: "opening",
  closed: "closing",
  // Built-in display verbs not covered above
  monitored: "monitoring",
  grepped: "grepping",
  viewed: "viewing",
  edited: "editing",
  committed: "committing",
  checked: "checking",
  wrote: "writing",
};

function gerundOf(word: string): string | null {
  const gerund = GERUND_BY_PAST[word.toLowerCase()];
  if (!gerund) return null;
  // Preserve the original capitalization of the first letter.
  return word[0] === word[0]?.toUpperCase()
    ? gerund[0].toUpperCase() + gerund.slice(1)
    : gerund;
}

/**
 * Convert a past-tense verb label to its present-participle form by rewriting
 * the first recognized verb word. Handles single words ("Read" → "Reading"),
 * multi-word built-ins ("Saved findings" → "Saving findings"), and MCP
 * sentences where the verb is not the first word ("Linear listed issues" →
 * "Linear listing issues"). Returns the label unchanged when no verb matches.
 */
export function toPresentTense(label: string): string {
  const words = label.split(" ");
  for (let i = 0; i < words.length; i++) {
    const gerund = gerundOf(words[i]);
    if (gerund) {
      words[i] = gerund;
      return words.join(" ");
    }
  }
  return label;
}

/**
 * The quiet text on a tool row: faint at rest, full contrast once the row is
 * hovered. Two colours across two states, so it is outside the `Text` tone
 * scale — a tone is one colour. It lives here as one named string rather than
 * being retyped in each of the thirty-odd tool displays.
 */
export const TOOL_ROW_TEXT =
  "text-primary-500 group-hover:text-primary-950 group-hover:dark:text-primary";

/** Muted-until-hover text treatment for the icon/verb slots of a tool header. */
const headerSlotClass =
  "shrink-0 text-primary-600 dark:text-primary-400 group-hover:text-primary-950 group-hover:dark:text-primary";

interface ToolHeaderProps {
  /** Tool icon (e.g. <Bash />, <Glob />). Hidden when `isCompact`. */
  icon: ReactNode;
  /** Verb label (e.g. "Ran", "Searched", "Read"). Hidden when `isCompact`. */
  verb: ReactNode;
  /** When false, click is a no-op and the chevron is suppressed. */
  hasDetails: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  isCompact?: boolean;
  /** Middle slot rendered between verb and chevron — provider-specific content
   *  (file path, pattern, stats, char count, etc.). */
  children?: ReactNode;
}

/**
 * Shared toggle header used by every tool-call display. Owns the
 * icon + verb + chevron + group-hover styling so the per-tool files
 * only describe the middle slot and the expand body.
 *
 * Status-aware: reads `useToolStatus()` and, when the call is in flight, swaps
 * the icon for a spinner and rewrites a string verb to present tense
 * ("Reading…"). Failed calls go red; canceled calls are muted/struck through.
 */
export function ToolHeader({
  icon,
  verb,
  hasDetails,
  isExpanded,
  onToggle,
  isCompact = false,
  children,
}: ToolHeaderProps) {
  const status = useToolStatus();
  const isRunning = status === "running" || status === "queued";

  // Present-tense only applies to plain string verbs; ReactNode verbs pass through.
  const verbContent =
    isRunning && typeof verb === "string" ? toPresentTense(verb) : verb;

  return (
    <Button
      type="button"
      onClick={() => hasDetails && onToggle()}
      className={`group w-full min-w-0 flex items-center gap-1.5 py-1 text-s font-sans ${
        hasDetails ? "cursor-pointer" : "cursor-default"
      }`}
    >
      {!isCompact && (
        <span className={headerSlotClass}>
          {isRunning ? <SquareSpinner /> : icon}
        </span>
      )}
      {!isCompact && (
        <span className={`font-medium ${headerSlotClass}`}>
          {verbContent}
        </span>
      )}
      {children}
      {hasDetails && (
        <ArrowUp
          className={`size-4 shrink-0 opacity-100 transition-all duration-200 group-hover:opacity-100 ${ isExpanded ? "rotate-180" : "rotate-90" } ${TOOL_ROW_TEXT}`}
        />
      )}
    </Button>
  );
}

/**
 * Standard scrollable output panel rendered inside a ToolCollapse. Owns the
 * shared shell (tinted background, radius, padding, max-height, scroll);
 * per-tool typography (font, size, whitespace) comes in via `className`.
 */
export function ToolOutputBody({
  as = "pre",
  className = "",
  children,
}: {
  as?: "pre" | "div";
  className?: string;
  children: ReactNode;
}) {
  const Tag = as;
  return (
    <Tag
      className={`noscrollbar text-primary-950 dark:text-primary bg-primary-50 dark:bg-primary/5 rounded-md p-2 max-h-48 overflow-y-auto ${className}`}
    >
      {children}
    </Tag>
  );
}

/**
 * The diff card Edit / Write / ApplyPatch all render inside their ToolCollapse:
 * the scroll shell plus one `PatchDiff` on the app's shared typography and
 * options.
 *
 * The actual diff renderer is async: a collapsed tool row does not need to
 * parse `@pierre/diffs` and Shiki during app startup.
 */
export function ToolDiffBody({
  patch,
  className = "max-h-80",
}: {
  patch: string;
  className?: string;
}) {
  return (
    <div className={`overflow-y-auto noscrollbar p-0.5 ${className}`}>
      <Suspense
        fallback={
          <Text
            as="div"
            size="xs"
            tone="subtle"
            className="px-2 py-1.5 shine-text"
          >
            Loading diff...
          </Text>
        }
      >
        <ToolDiffBodyContent patch={patch} />
      </Suspense>
    </div>
  );
}

/**
 * CSS-grid based collapse wrapper. The body content (pre/div, font choice,
 * padding, max-height) stays at the call site — only the open/close animation
 * is centralised here.
 */
export function ToolCollapse({
  isExpanded,
  children,
  className = "",
}: {
  isExpanded: boolean;
  children: ReactNode;
  /** Extra classes merged onto the outer grid (e.g. border/rounded for diff bodies). */
  className?: string;
}) {
  // Do not mount expensive output bodies for the hundreds of historical rows
  // a transcript can keep collapsed. Once opened, retain the body so closing
  // still animates and local state survives subsequent toggles.
  const [hasOpened, setHasOpened] = useState(isExpanded);
  if (isExpanded && !hasOpened) setHasOpened(true);

  return (
    <div
      className={`grid transition-all duration-200 ease-out ${
        isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      } ${className}`}
    >
      <div className="min-h-0 overflow-hidden">
        {hasOpened ? children : null}
      </div>
    </div>
  );
}
