/**
 * Mains' own issue statuses. A provider's workflow state (`issues.state` — free
 * text the user can create and rename in Linear, Jira, Trello, …) is mapped onto
 * one of these, and every status sits in a fixed category. The inbox filters and
 * counts on the category, never on the provider's state name.
 */
export const ISSUE_STATUS_CATEGORIES = ["open", "closed"] as const;
export type IssueStatusCategory = (typeof ISSUE_STATUS_CATEGORIES)[number];

/** The statuses every install starts with, seeded by the `issue_statuses` migration. */
export const DEFAULT_ISSUE_STATUS_IDS = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;
export type DefaultIssueStatusId = (typeof DEFAULT_ISSUE_STATUS_IDS)[number];

export function isDefaultIssueStatusId(value: unknown): value is DefaultIssueStatusId {
  return (DEFAULT_ISSUE_STATUS_IDS as readonly unknown[]).includes(value);
}

/** An `issue_statuses` row (`issues:listStatuses`). */
export interface IssueStatus {
  id: string;
  name: string;
  category: IssueStatusCategory;
  sortOrder: number;
}

/**
 * One workflow state of a provider resource (a Linear team's "In Review", a
 * Trello list) and the Mains status its issues get (`sync:listIssueStates`).
 */
export interface ProviderIssueState {
  /** The provider's stable id — what `issues.state_id` holds. */
  id: string;
  name: string;
  color: string | null;
  /** What sync picks on its own, from the provider's category or the name. */
  defaultStatusId: DefaultIssueStatusId;
  /** The user's mapping when there is one, else the default. */
  statusId: string;
  mapped: boolean;
}

export interface ResourceIssueStates {
  resourceId: string;
  /** False for providers without custom states (GitHub, GitLab: open/closed). */
  supported: boolean;
  states: ProviderIssueState[];
}

/** `sync:setIssueStatusMapping`. A null status drops the mapping, back to the default. */
export interface SetIssueStatusMappingInput {
  resourceId: string;
  stateId: string;
  statusId: string | null;
}
