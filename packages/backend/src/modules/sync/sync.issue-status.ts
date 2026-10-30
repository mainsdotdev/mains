import type { DefaultIssueStatusId } from "@mains/contracts/issue-status";

// ─────────────────────────────────────────────────────────────
// Provider state → Mains issue status
//
// The automatic half of status mapping: each fetcher turns its provider's own
// notion of "how done is this" into one of the default statuses. Providers
// whose custom states carry a category (Linear, Jira) map exactly; providers
// whose states are plain user-named columns (Trello lists, Asana sections) can
// only be guessed from the name.
// ─────────────────────────────────────────────────────────────

/** Linear's workflow state types — every custom Linear state has one. */
const LINEAR_STATE_TYPES: Record<string, DefaultIssueStatusId> = {
  triage: "backlog",
  backlog: "backlog",
  unstarted: "todo",
  started: "in_progress",
  completed: "done",
  canceled: "canceled",
  duplicate: "canceled",
};

/**
 * Neither Linear nor Jira has a review category — "In Review" files under
 * started / in progress — so an in-progress state whose name says review is
 * read as one.
 */
function refineInProgress(status: DefaultIssueStatusId, name?: string | null): DefaultIssueStatusId {
  return status === "in_progress" && statusFromName(name) === "in_review" ? "in_review" : status;
}

/** A type Linear adds later falls back on the state's name rather than on open. */
export function statusFromLinearType(
  type: string | null | undefined,
  name?: string | null,
): DefaultIssueStatusId {
  const byType = type ? LINEAR_STATE_TYPES[type] : undefined;
  return byType ? refineInProgress(byType, name) : statusFromName(name);
}

/** Jira status categories — every custom Jira status belongs to one. */
const JIRA_STATUS_CATEGORIES: Record<string, DefaultIssueStatusId> = {
  new: "todo",
  indeterminate: "in_progress",
  done: "done",
};

export function statusFromJiraCategory(
  key: string | null | undefined,
  name?: string | null,
): DefaultIssueStatusId {
  const byCategory = key ? JIRA_STATUS_CATEGORIES[key] : undefined;
  return byCategory ? refineInProgress(byCategory, name) : statusFromName(name);
}

/**
 * GitHub (`open`/`closed`) and GitLab (`opened`/`closed`). GitHub's
 * `state_reason` tells a won't-fix close apart from a completed one.
 */
export function statusFromOpenClosed(
  state: string | null | undefined,
  reason?: string | null,
): DefaultIssueStatusId {
  if (state !== "closed") return "todo";
  return reason === "not_planned" || reason === "duplicate" ? "canceled" : "done";
}

// First match wins, so "Not started" is caught as todo before "started".
const NAME_PATTERNS: ReadonlyArray<[RegExp, DefaultIssueStatusId]> = [
  [/not (yet )?started|\bto ?do\b|\bnew\b/, "todo"],
  [/cancel|won'?t ?fix|duplicate|rejected|abandoned/, "canceled"],
  [/done|complete|closed|finished|shipped|resolved|released/, "done"],
  [/review|\bqa\b|testing|verify/, "in_review"],
  [/progress|doing|\bwip\b|active|started|working/, "in_progress"],
  [/backlog|icebox|someday|later|ideas?\b/, "backlog"],
];

/**
 * A best guess for a state that carries no category — a Trello list or an Asana
 * section is just a column name. Anything unrecognised is "todo".
 */
export function statusFromName(name: string | null | undefined): DefaultIssueStatusId {
  const normalized = name?.trim().toLowerCase();
  if (!normalized) return "todo";
  return NAME_PATTERNS.find(([pattern]) => pattern.test(normalized))?.[1] ?? "todo";
}
