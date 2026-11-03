import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequest = vi.fn();

vi.mock("@linear/sdk", () => ({
  LinearClient: class {
    client = { request: mockRequest };
  },
}));

import { linearIssuesFetcher } from "./linear";
import type { SelectedResource } from "../sync.dto";

beforeEach(() => {
  vi.clearAllMocks();
});

const validResource: SelectedResource = {
  id: "res-1",
  connectionId: "conn-1",
  externalId: "ENG",
  name: "Engineering",
  kind: "linear_team",
  metadata: {},
};

const baseArgs = {
  secrets: { apiKey: "lin_test" },
  metadata: {},
  limit: 5,
  connectionId: "conn-1",
};

function fakeIssue(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "issue-1",
    title: "Investigate auth bug",
    url: "https://linear.app/co/issue/ENG-42",
    description: "Something is wrong",
    identifier: "ENG-42",
    priority: 2,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
    completedAt: null,
    dueDate: "2025-02-01",
    state: { id: "state-1", name: "In Progress", type: "started" },
    assignee: { name: "alice", avatarUrl: "https://public.linear.app/a.png" },
    labels: { nodes: [{ name: "bug", color: "#EB5757" }] },
    project: { name: "Desktop", color: "#5e6ad2" },
    team: { key: "ENG" },
    ...over,
  };
}

function page(nodes: unknown[], endCursor: string | null = null) {
  return { issues: { nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } } };
}

const filterOf = (call: number) => mockRequest.mock.calls[call][1].filter;

describe("linearIssuesFetcher.fetchForResource", () => {
  it("is incremental", () => {
    expect(linearIssuesFetcher.incremental).toBe(true);
  });

  it("throws without an apiKey, so the runner keeps its cursor", async () => {
    await expect(
      linearIssuesFetcher.fetchForResource({ ...baseArgs, secrets: {}, resource: validResource }),
    ).rejects.toThrow(/API key/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("fetches and normalizes the team's issues in one request per page", async () => {
    mockRequest.mockResolvedValue(page([fakeIssue()]));

    const result = await linearIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "issue",
      title: "Investigate auth bug",
      externalId: "issue-1",
      connectionId: "conn-1",
      resourceId: "res-1",
      metadata: {
        provider: "linear",
        identifier: "ENG-42",
        number: 42,
        teamKey: "ENG",
        state: "In Progress",
        stateId: "state-1",
        statusId: "in_progress",
        labels: ["bug"],
        assignee: "alice",
        labelColors: { bug: "#eb5757" },
        assigneeAvatarUrl: "https://public.linear.app/a.png",
        priority: 2,
        group: { name: "Desktop", color: "#5e6ad2" },
        dueAt: "2025-02-01",
      },
    });
  });

  it("asks for open issues of the team without a cursor", async () => {
    mockRequest.mockResolvedValue(page([]));

    await linearIssuesFetcher.fetchForResource({ ...baseArgs, resource: validResource, since: null });

    expect(filterOf(0)).toEqual({
      team: { key: { eq: "ENG" } },
      completedAt: { null: true },
      canceledAt: { null: true },
    });
  });

  it("asks for every change since the cursor, closed issues included", async () => {
    mockRequest.mockResolvedValue(
      page([fakeIssue({ state: { id: "state-done", name: "Done", type: "completed" } })]),
    );

    const [issue] = await linearIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
      since: new Date("2025-03-01T00:00:00Z"),
    });

    expect(filterOf(0)).toEqual({
      team: { key: { eq: "ENG" } },
      updatedAt: { gt: "2025-03-01T00:00:00.000Z" },
    });
    expect(issue.metadata).toMatchObject({ state: "Done", statusId: "done" });
  });

  it("pages until Linear runs out, within the limit", async () => {
    mockRequest
      .mockResolvedValueOnce(page([fakeIssue({ id: "a" }), fakeIssue({ id: "b" })], "cursor-1"))
      .mockResolvedValueOnce(page([fakeIssue({ id: "c" })]));

    const result = await linearIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });

    expect(result.map((r) => r.externalId)).toEqual(["a", "b", "c"]);
    expect(mockRequest.mock.calls[1][1]).toMatchObject({ after: "cursor-1" });
  });
});

describe("linearIssuesFetcher.fetchAll", () => {
  it("is defined (Linear opts into the no-resources fallback)", () => {
    expect(linearIssuesFetcher.fetchAll).toBeDefined();
  });

  it("returns [] when no apiKey in secrets", async () => {
    const result = await linearIssuesFetcher.fetchAll!({
      ...baseArgs,
      secrets: {},
    });
    expect(result).toEqual([]);
  });

  it("normalizes open issues across all teams", async () => {
    mockRequest.mockResolvedValue(
      page([fakeIssue({ id: "issue-2", identifier: "DES-7", team: { key: "DES" } })]),
    );

    const result = await linearIssuesFetcher.fetchAll!({
      ...baseArgs,
    });

    expect(filterOf(0)).toEqual({ completedAt: { null: true }, canceledAt: { null: true } });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "issue",
      externalId: "issue-2",
      connectionId: "conn-1",
      resourceId: null,
      metadata: { teamKey: "DES" },
    });
  });
});

describe("linearIssuesFetcher.listStates", () => {
  it("lists the team's workflow states in Linear's board order, with default statuses", async () => {
    mockRequest.mockResolvedValue({
      workflowStates: {
        nodes: [
          { id: "s-done", name: "Done", type: "completed", color: "#5e6ad2", position: 0 },
          { id: "s-qa", name: "Ready for QA", type: "started", color: "#f2c94c", position: 2 },
          { id: "s-doing", name: "In Progress", type: "started", color: "#f2994a", position: 1 },
          { id: "s-backlog", name: "Backlog", type: "backlog", color: null, position: 0 },
        ],
      },
    });

    const states = await linearIssuesFetcher.listStates!({
      resource: validResource,
      secrets: baseArgs.secrets,
      metadata: {},
    });

    expect(mockRequest.mock.calls[0][1]).toEqual({ filter: { team: { key: { eq: "ENG" } } } });
    expect(states).toEqual([
      { id: "s-backlog", name: "Backlog", color: null, defaultStatusId: "backlog" },
      { id: "s-doing", name: "In Progress", color: "#f2994a", defaultStatusId: "in_progress" },
      // Linear files review under "started"; the name tells it apart.
      { id: "s-qa", name: "Ready for QA", color: "#f2c94c", defaultStatusId: "in_review" },
      { id: "s-done", name: "Done", color: "#5e6ad2", defaultStatusId: "done" },
    ]);
  });
});

describe("fetcher metadata", () => {
  it("uses linear_team kind", () => {
    expect(linearIssuesFetcher.provider).toBe("linear");
    expect(linearIssuesFetcher.resourceKind).toBe("linear_team");
    expect(linearIssuesFetcher.id).toBe("linear:issues");
  });
});
