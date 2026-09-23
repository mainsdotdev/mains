import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTeams = vi.fn();
const mockTopLevelIssues = vi.fn();

vi.mock("@linear/sdk", () => ({
  LinearClient: class {
    teams = mockTeams;
    issues = mockTopLevelIssues;
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
    state: Promise.resolve({ name: "In Progress" }),
    assignee: Promise.resolve({ name: "alice" }),
    labels: () => Promise.resolve({ nodes: [{ name: "bug" }] }),
    team: Promise.resolve({ key: "ENG" }),
    ...over,
  };
}

describe("linearIssuesFetcher.fetchForResource", () => {
  it("returns [] when no apiKey in secrets", async () => {
    const result = await linearIssuesFetcher.fetchForResource({
      ...baseArgs,
      secrets: {},
      resource: validResource,
    });
    expect(result).toEqual([]);
    expect(mockTeams).not.toHaveBeenCalled();
  });

  it("returns [] when the team is not found", async () => {
    mockTeams.mockResolvedValue({ nodes: [] });
    const result = await linearIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });
    expect(result).toEqual([]);
  });

  it("fetches and normalizes issues for the team", async () => {
    mockTeams.mockResolvedValue({
      nodes: [
        {
          issues: async () => ({ nodes: [fakeIssue()] }),
        },
      ],
    });

    const result = await linearIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });

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
        labels: ["bug"],
        assignee: "alice",
      },
    });
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

  it("normalizes issues across all teams", async () => {
    mockTopLevelIssues.mockResolvedValue({
      nodes: [fakeIssue({ id: "issue-2", identifier: "DES-7" })],
    });

    const result = await linearIssuesFetcher.fetchAll!({
      ...baseArgs,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "issue",
      externalId: "issue-2",
      connectionId: "conn-1",
      resourceId: null,
      metadata: { teamKey: "ENG" },
    });
  });
});

describe("fetcher metadata", () => {
  it("uses linear_team kind", () => {
    expect(linearIssuesFetcher.provider).toBe("linear");
    expect(linearIssuesFetcher.resourceKind).toBe("linear_team");
    expect(linearIssuesFetcher.id).toBe("linear:issues");
  });
});
