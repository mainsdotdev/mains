import {
  LinearClient,
  type Issue,
  type IssueHistory,
  type User,
} from "@linear/sdk";

import type {
  IssueDetailActivity,
  IssueDetailActivityKind,
  IssueDetailReference,
  IssueDetailUser,
  LinearIssueDetail,
} from "./entities.dto";

const DETAIL_PAGE_SIZE = 25;

const PRIORITY_LABELS = ["No priority", "Urgent", "High", "Medium", "Low"];

function iso(value: Date): string {
  return value.toISOString();
}

function optionalIso(value: Date | null | undefined): string | null {
  return value ? iso(value) : null;
}

function userSummary(user: User | null | undefined): IssueDetailUser | null {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
  };
}

function priorityLabel(priority: number | null | undefined): string {
  return PRIORITY_LABELS[priority ?? 0] ?? "No priority";
}

async function issueReference(issue: Issue): Promise<IssueDetailReference> {
  const state = await issue.state;
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    state: state
      ? { name: state.name, type: state.type, color: state.color }
      : null,
    priority: issue.priority,
    priorityLabel: issue.priorityLabel || priorityLabel(issue.priority),
  };
}

function changed(from: unknown, to: unknown): boolean {
  return from !== undefined || to !== undefined;
}

async function historyActivity(
  history: IssueHistory,
): Promise<IssueDetailActivity | null> {
  const actor = userSummary(await history.actor);
  let kind: IssueDetailActivityKind;
  let summary: string;
  let url: string | null = null;

  if (history.attachmentId !== undefined) {
    const attachment = await history.attachment;
    kind = "attachment";
    summary = attachment
      ? `linked ${attachment.title || "a resource"}`
      : "updated a linked resource";
    url = attachment?.url ?? null;
  } else if (changed(history.fromStateId, history.toStateId)) {
    const [from, to] = await Promise.all([history.fromState, history.toState]);
    kind = "status";
    summary = to
      ? `moved the issue${from ? ` from ${from.name}` : ""} to ${to.name}`
      : "updated the status";
  } else if (changed(history.fromAssigneeId, history.toAssigneeId)) {
    const assignee = await history.toAssignee;
    kind = "assignee";
    summary = assignee ? `assigned the issue to ${assignee.name}` : "unassigned the issue";
  } else if (changed(history.fromPriority, history.toPriority)) {
    kind = "priority";
    summary = `set priority to ${priorityLabel(history.toPriority)}`;
  } else if ((history.addedLabels?.length ?? 0) > 0) {
    kind = "label";
    summary = `added ${history.addedLabels!.map((label) => label.name).join(", ")}`;
  } else if ((history.removedLabels?.length ?? 0) > 0) {
    kind = "label";
    summary = `removed ${history.removedLabels!.map((label) => label.name).join(", ")}`;
  } else if (changed(history.fromProjectId, history.toProjectId)) {
    const project = await history.toProject;
    kind = "project";
    summary = project ? `added the issue to ${project.name}` : "removed the issue from its project";
  } else if (changed(history.fromCycleId, history.toCycleId)) {
    const cycle = await history.toCycle;
    kind = "cycle";
    summary = cycle
      ? `added the issue to ${cycle.name || `Cycle ${cycle.number}`}`
      : "removed the issue from its cycle";
  } else if (changed(history.fromParentId, history.toParentId)) {
    const parent = await history.toParent;
    kind = "parent";
    summary = parent
      ? `made ${parent.identifier} the parent issue`
      : "removed the parent issue";
  } else if (changed(history.fromDueDate, history.toDueDate)) {
    kind = "due_date";
    summary = history.toDueDate
      ? `set the due date to ${history.toDueDate}`
      : "removed the due date";
  } else if (changed(history.fromEstimate, history.toEstimate)) {
    kind = "estimate";
    summary = history.toEstimate == null
      ? "removed the estimate"
      : `set the estimate to ${history.toEstimate}`;
  } else if (history.updatedDescription) {
    kind = "description";
    summary = "updated the description";
  } else if (changed(history.fromTitle, history.toTitle)) {
    kind = "title";
    summary = "updated the title";
  } else if (history.archived !== undefined || history.trashed !== undefined) {
    kind = "archived";
    summary = history.archived || history.trashed
      ? "archived the issue"
      : "restored the issue";
  } else {
    return null;
  }

  return {
    id: `history:${history.id}`,
    kind,
    createdAt: iso(history.createdAt),
    actor,
    summary,
    body: null,
    url,
  };
}

/** Fetch the relationship-heavy Linear view model used only by the issue drawer. */
export async function fetchLinearIssueDetail(
  apiKey: string,
  issueId: string,
): Promise<LinearIssueDetail> {
  const client = new LinearClient({ apiKey });
  const issue = await client.issue(issueId);

  const [
    state,
    assignee,
    creator,
    team,
    project,
    cycle,
    parent,
    labelsConnection,
    childrenConnection,
    attachmentsConnection,
    documentsConnection,
    commentsConnection,
    historyConnection,
    relationsConnection,
    inverseRelationsConnection,
  ] = await Promise.all([
    issue.state,
    issue.assignee,
    issue.creator,
    issue.team,
    issue.project,
    issue.cycle,
    issue.parent,
    issue.labels({ first: DETAIL_PAGE_SIZE }),
    issue.children({ first: DETAIL_PAGE_SIZE }),
    issue.attachments({ first: DETAIL_PAGE_SIZE }),
    issue.documents({ first: DETAIL_PAGE_SIZE }),
    issue.comments({ first: DETAIL_PAGE_SIZE }),
    issue.history({ first: DETAIL_PAGE_SIZE }),
    issue.relations({ first: DETAIL_PAGE_SIZE }),
    issue.inverseRelations({ first: DETAIL_PAGE_SIZE }),
  ]);

  if (!state || !team) {
    throw new Error("Linear issue is missing its workflow state or team");
  }

  const [children, attachmentResources, documentResources, comments, history, outbound, inbound] =
    await Promise.all([
      Promise.all(childrenConnection.nodes.map(issueReference)),
      Promise.all(
        attachmentsConnection.nodes.map(async (attachment) => ({
          id: attachment.id,
          kind: "attachment" as const,
          title: attachment.title || "Untitled resource",
          subtitle: attachment.subtitle ?? null,
          url: attachment.url,
          sourceType: attachment.sourceType ?? null,
          createdAt: iso(attachment.createdAt),
          creator: userSummary(await attachment.creator),
        })),
      ),
      Promise.all(
        documentsConnection.nodes.map(async (document) => ({
          id: document.id,
          kind: "document" as const,
          title: document.title || "Untitled document",
          subtitle: "Linear document",
          url: document.url,
          sourceType: "linear",
          createdAt: iso(document.createdAt),
          creator: userSummary(await document.creator),
        })),
      ),
      Promise.all(
        commentsConnection.nodes.map(async (comment): Promise<IssueDetailActivity> => ({
          id: `comment:${comment.id}`,
          kind: "comment",
          createdAt: iso(comment.createdAt),
          actor: userSummary(await comment.user),
          summary: "commented",
          body: comment.body,
          url: comment.url || null,
        })),
      ),
      Promise.all(historyConnection.nodes.map(historyActivity)),
      Promise.all(
        relationsConnection.nodes.map(async (relation) => {
          const related = await relation.relatedIssue;
          return related
            ? {
                id: relation.id,
                type: relation.type,
                direction: "outbound" as const,
                issue: await issueReference(related),
              }
            : null;
        }),
      ),
      Promise.all(
        inverseRelationsConnection.nodes.map(async (relation) => {
          const related = await relation.issue;
          return related
            ? {
                id: relation.id,
                type: relation.type,
                direction: "inbound" as const,
                issue: await issueReference(related),
              }
            : null;
        }),
      ),
    ]);

  const activity: IssueDetailActivity[] = [
    {
      id: `created:${issue.id}`,
      kind: "created" as const,
      createdAt: iso(issue.createdAt),
      actor: userSummary(creator),
      summary: "created the issue",
      body: null,
      url: null,
    },
    ...history.filter((item): item is IssueDetailActivity => item !== null),
    ...comments,
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    provider: "linear",
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    description: issue.description ?? null,
    branchName: issue.branchName,
    priority: issue.priority,
    priorityLabel: issue.priorityLabel || priorityLabel(issue.priority),
    estimate: issue.estimate ?? null,
    dueDate: issue.dueDate ?? null,
    createdAt: iso(issue.createdAt),
    updatedAt: iso(issue.updatedAt),
    startedAt: optionalIso(issue.startedAt),
    completedAt: optionalIso(issue.completedAt),
    canceledAt: optionalIso(issue.canceledAt),
    state: { id: state.id, name: state.name, type: state.type, color: state.color },
    assignee: userSummary(assignee),
    creator: userSummary(creator),
    team: {
      id: team.id,
      key: team.key,
      name: team.name,
      color: team.color ?? null,
      icon: team.icon ?? null,
    },
    project: project
      ? {
          id: project.id,
          name: project.name,
          url: project.url,
          color: project.color,
          icon: project.icon ?? null,
        }
      : null,
    cycle: cycle
      ? {
          id: cycle.id,
          name: cycle.name || `Cycle ${cycle.number}`,
          number: cycle.number,
          startsAt: iso(cycle.startsAt),
          endsAt: iso(cycle.endsAt),
        }
      : null,
    parent: parent ? await issueReference(parent) : null,
    labels: labelsConnection.nodes.map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
    })),
    children,
    resources: [...attachmentResources, ...documentResources].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    ),
    relations: [...outbound, ...inbound].filter(
      (relation): relation is NonNullable<typeof relation> => relation !== null,
    ),
    activity,
  };
}
