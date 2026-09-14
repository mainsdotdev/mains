// ─────────────────────────────────────────────────────────────
// Entity DTOs
// ─────────────────────────────────────────────────────────────
export interface CreateEntityPayload {
  accountId: string;
  kind: string;
  connectionId?: string;
  resourceId?: string;
  externalId?: string;
  url?: string;
  title?: string;
  body?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}

export interface UpdateEntityPayload {
  title?: string;
  body?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  url?: string;
  isDeleted?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Task DTOs
// ─────────────────────────────────────────────────────────────
export interface CreateTaskPayload {
  entity: CreateEntityPayload;
  status?: "todo" | "doing" | "done" | "canceled";
  dueAt?: Date;
  priority?: number;
  labels?: string[];
}

export interface UpdateTaskPayload {
  status?: "todo" | "doing" | "done" | "canceled";
  dueAt?: Date | null;
  priority?: number;
  labels?: string[];
}

// ─────────────────────────────────────────────────────────────
// Issue DTOs
// ─────────────────────────────────────────────────────────────
export interface CreateIssuePayload {
  entity: CreateEntityPayload;
  provider: string;
  state: string;
  number?: number;
  repo?: string;
  assignee?: string;
  labels?: string[];
  priority?: number;
}

export interface UpdateIssuePayload {
  state?: string;
  assignee?: string;
  labels?: string[];
  priority?: number;
  closedAt?: Date | null;
}

// Live provider detail. The canonical entity/issue rows stay deliberately
// compact; relationship-heavy data is fetched only while the detail drawer is
// open so the issue inbox does not turn into an N+1 sync job.
export interface IssueDetailUser {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface IssueDetailReference {
  id: string;
  identifier: string;
  title: string;
  url: string;
  state: { name: string; type: string; color: string } | null;
  priority: number;
  priorityLabel: string;
}

export interface IssueDetailResource {
  id: string;
  kind: "attachment" | "document";
  title: string;
  subtitle: string | null;
  url: string;
  sourceType: string | null;
  createdAt: string;
  creator: IssueDetailUser | null;
}

export interface IssueDetailRelation {
  id: string;
  type: string;
  direction: "outbound" | "inbound";
  issue: IssueDetailReference;
}

export type IssueDetailActivityKind =
  | "created"
  | "comment"
  | "status"
  | "assignee"
  | "priority"
  | "label"
  | "project"
  | "cycle"
  | "parent"
  | "attachment"
  | "description"
  | "title"
  | "due_date"
  | "estimate"
  | "archived";

export interface IssueDetailActivity {
  id: string;
  kind: IssueDetailActivityKind;
  createdAt: string;
  actor: IssueDetailUser | null;
  summary: string;
  body: string | null;
  url: string | null;
}

export interface LinearIssueDetail {
  provider: "linear";
  id: string;
  identifier: string;
  title: string;
  url: string;
  description: string | null;
  branchName: string;
  priority: number;
  priorityLabel: string;
  estimate: number | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  state: { id: string; name: string; type: string; color: string };
  assignee: IssueDetailUser | null;
  creator: IssueDetailUser | null;
  team: {
    id: string;
    key: string;
    name: string;
    color: string | null;
    icon: string | null;
  };
  project: {
    id: string;
    name: string;
    url: string;
    color: string;
    icon: string | null;
  } | null;
  cycle: {
    id: string;
    name: string;
    number: number;
    startsAt: string;
    endsAt: string;
  } | null;
  parent: IssueDetailReference | null;
  labels: Array<{ id: string; name: string; color: string }>;
  children: IssueDetailReference[];
  resources: IssueDetailResource[];
  relations: IssueDetailRelation[];
  activity: IssueDetailActivity[];
}

// ─────────────────────────────────────────────────────────────
// Signal DTOs
// ─────────────────────────────────────────────────────────────
export interface CreateSignalPayload {
  entity: CreateEntityPayload;
  source: string;
  level?: "fatal" | "critical" | "error" | "warning" | "info";
  category?: "crash" | "bug" | "alert" | "feedback" | "exception" | "other";
  state?: "open" | "resolved" | "ignored" | "regressed";
  eventCount?: number;
  affectedUsers?: number;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  stackTrace?: string;
  file?: string;
  function?: string;
  line?: number;
  assignee?: string;
  labels?: string[];
  priority?: number;
  projectId?: string;
}

export interface UpdateSignalPayload {
  level?: "fatal" | "critical" | "error" | "warning" | "info";
  category?: "crash" | "bug" | "alert" | "feedback" | "exception" | "other";
  state?: "open" | "resolved" | "ignored" | "regressed";
  eventCount?: number;
  affectedUsers?: number;
  lastSeenAt?: Date;
  stackTrace?: string;
  file?: string;
  function?: string;
  line?: number;
  assignee?: string;
  labels?: string[];
  priority?: number;
  projectId?: string;
  resolvedAt?: Date | null;
}

export interface SignalQueryOptions {
  source?: string;
  level?: string;
  category?: string;
  state?: string;
  projectId?: string;
  limit?: number;
}

// ─────────────────────────────────────────────────────────────
// Query Options
// ─────────────────────────────────────────────────────────────
export interface EntityQueryOptions {
  kinds?: string[];
  kind?: string;
  connectionIds?: string[];
  connectionId?: string;
  limit?: number;
}

export interface TaskQueryOptions {
  status?: "todo" | "doing" | "done" | "canceled";
  limit?: number;
}

export interface IssueQueryOptions {
  provider?: string;
  state?: string;
  repo?: string;
  limit?: number;
}

export interface SearchOptions {
  kind?: string;
  limit?: number;
}
