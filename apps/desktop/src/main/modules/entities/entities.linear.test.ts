import { beforeEach, describe, expect, it, vi } from "vitest";

const getIssue = vi.fn();

vi.mock("@linear/sdk", () => ({
  LinearClient: class {
    issue = getIssue;
  },
}));

import { fetchLinearIssueDetail } from "./entities.linear";

const DATE = new Date("2026-08-23T12:00:00.000Z");
const LATER = new Date("2026-08-23T13:00:00.000Z");

function user(id: string, name: string) {
  return { id, name, avatarUrl: `https://images.test/${id}.png` };
}

function reference(id: string, identifier: string, title: string) {
  return {
    id,
    identifier,
    title,
    url: `https://linear.test/${identifier}`,
    priority: 3,
    priorityLabel: "Medium",
    state: Promise.resolve({
      id: "todo",
      name: "Todo",
      type: "unstarted",
      color: "#999999",
    }),
  };
}

function issueFixture() {
  const creator = user("creator", "Okan");
  const assignee = user("assignee", "Ada");
  const child = reference("child", "MAI-191", "Ship the site");
  const parent = reference("parent", "MAI-100", "Launch project");
  const related = reference("related", "MAI-89", "Prepare assets");

  return {
    id: "issue-id",
    identifier: "MAI-190",
    title: "Launch",
    url: "https://linear.test/MAI-190",
    description: "Launch everywhere.",
    branchName: "okan/mai-190-launch",
    priority: 2,
    priorityLabel: "High",
    estimate: 5,
    dueDate: "2026-09-01",
    createdAt: DATE,
    updatedAt: LATER,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    state: Promise.resolve({
      id: "backlog",
      name: "Backlog",
      type: "backlog",
      color: "#5E6AD2",
    }),
    assignee: Promise.resolve(assignee),
    creator: Promise.resolve(creator),
    team: Promise.resolve({
      id: "team",
      key: "MAI",
      name: "Mains",
      color: "#5E6AD2",
      icon: "M",
    }),
    project: Promise.resolve({
      id: "project",
      name: "Desktop",
      url: "https://linear.test/project",
      color: "#4CB782",
      icon: "desktop",
    }),
    cycle: Promise.resolve({
      id: "cycle",
      name: "August",
      number: 8,
      startsAt: DATE,
      endsAt: LATER,
    }),
    parent: Promise.resolve(parent),
    labels: vi.fn().mockResolvedValue({
      nodes: [{ id: "feature", name: "Feature", color: "#A56EFF" }],
    }),
    children: vi.fn().mockResolvedValue({ nodes: [child] }),
    attachments: vi.fn().mockResolvedValue({
      nodes: [
        {
          id: "attachment",
          title: "Product Hunt",
          subtitle: "The best new products",
          url: "https://producthunt.com",
          sourceType: "url",
          createdAt: LATER,
          creator: Promise.resolve(creator),
        },
      ],
    }),
    documents: vi.fn().mockResolvedValue({
      nodes: [
        {
          id: "document",
          title: "Launch notes",
          url: "https://linear.test/document",
          createdAt: LATER,
          creator: Promise.resolve(creator),
        },
      ],
    }),
    comments: vi.fn().mockResolvedValue({
      nodes: [
        {
          id: "comment",
          body: "Ready to ship.",
          url: "https://linear.test/comment",
          createdAt: LATER,
          user: Promise.resolve(assignee),
        },
      ],
    }),
    history: vi.fn().mockResolvedValue({
      nodes: [
        {
          id: "history",
          createdAt: LATER,
          actor: Promise.resolve(creator),
          fromStateId: "todo",
          toStateId: "backlog",
          fromState: Promise.resolve({ name: "Todo" }),
          toState: Promise.resolve({ name: "Backlog" }),
        },
      ],
    }),
    relations: vi.fn().mockResolvedValue({
      nodes: [
        {
          id: "relation",
          type: "blocks",
          relatedIssue: Promise.resolve(related),
        },
      ],
    }),
    inverseRelations: vi.fn().mockResolvedValue({ nodes: [] }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getIssue.mockResolvedValue(issueFixture());
});

describe("fetchLinearIssueDetail", () => {
  it("maps Linear properties, resources, hierarchy, relations, and activity", async () => {
    const detail = await fetchLinearIssueDetail("lin_test", "issue-id");

    expect(getIssue).toHaveBeenCalledWith("issue-id");
    expect(detail).toMatchObject({
      provider: "linear",
      identifier: "MAI-190",
      priorityLabel: "High",
      state: { name: "Backlog", type: "backlog", color: "#5E6AD2" },
      assignee: { name: "Ada" },
      project: { name: "Desktop" },
      cycle: { name: "August" },
      parent: { identifier: "MAI-100" },
      labels: [{ name: "Feature", color: "#A56EFF" }],
      children: [{ identifier: "MAI-191" }],
    });
    expect(detail.resources.map((resource) => resource.kind)).toEqual([
      "attachment",
      "document",
    ]);
    expect(detail.relations).toMatchObject([
      { type: "blocks", direction: "outbound", issue: { identifier: "MAI-89" } },
    ]);
    expect(detail.activity.map((item) => item.kind)).toEqual([
      "created",
      "status",
      "comment",
    ]);
  });

  it("rejects malformed Linear issues without a state", async () => {
    getIssue.mockResolvedValue({
      ...issueFixture(),
      state: Promise.resolve(undefined),
    });

    await expect(fetchLinearIssueDetail("lin_test", "issue-id")).rejects.toThrow(
      "missing its workflow state or team",
    );
  });
});
