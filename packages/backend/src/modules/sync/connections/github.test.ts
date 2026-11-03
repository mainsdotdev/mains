import { describe, it, expect, vi, beforeEach } from "vitest";

const mockListForRepo = vi.fn();
const mockPullsList = vi.fn();

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    issues = { listForRepo: mockListForRepo };
    pulls = { list: mockPullsList };
  },
}));

import { githubIssuesFetcher, githubPullRequestsFetcher } from "./github";
import type { SelectedResource } from "../sync.dto";

beforeEach(() => {
  vi.clearAllMocks();
});

const validResource: SelectedResource = {
  id: "res-1",
  connectionId: "conn-1",
  externalId: "octocat/hello-world",
  name: "hello-world",
  kind: "github_repo",
  metadata: {},
};

const baseArgs = {
  secrets: { token: "ghp_test" },
  metadata: {},
  limit: 5,
  connectionId: "conn-1",
};

describe("githubIssuesFetcher", () => {
  it("is incremental", () => {
    expect(githubIssuesFetcher.incremental).toBe(true);
  });

  it("throws without a token, so the runner keeps its cursor", async () => {
    await expect(
      githubIssuesFetcher.fetchForResource({ ...baseArgs, secrets: {}, resource: validResource }),
    ).rejects.toThrow(/token/);
    expect(mockListForRepo).not.toHaveBeenCalled();
  });

  it("throws when the resource identifier lacks a slash", async () => {
    await expect(
      githubIssuesFetcher.fetchForResource({
        ...baseArgs,
        resource: { ...validResource, externalId: "no-slash" },
      }),
    ).rejects.toThrow(/owner\/repo/);
    expect(mockListForRepo).not.toHaveBeenCalled();
  });

  it("asks for open issues without a cursor", async () => {
    mockListForRepo.mockResolvedValue({ data: [] });
    await githubIssuesFetcher.fetchForResource({ ...baseArgs, resource: validResource, since: null });
    expect(mockListForRepo).toHaveBeenCalledWith(
      expect.objectContaining({ state: "open", page: 1 }),
    );
    expect(mockListForRepo.mock.calls[0][0]).not.toHaveProperty("since");
  });

  it("asks for every state updated since the cursor", async () => {
    mockListForRepo.mockResolvedValue({
      data: [
        {
          number: 3,
          title: "Closed as not planned",
          body: null,
          html_url: "https://github.com/octocat/hello-world/issues/3",
          state: "closed",
          state_reason: "not_planned",
          closed_at: "2025-03-02T00:00:00Z",
          created_at: "2025-01-01T00:00:00Z",
          labels: [],
          assignee: null,
        },
      ],
    });

    const [issue] = await githubIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
      since: new Date("2025-03-01T00:00:00Z"),
    });

    expect(mockListForRepo).toHaveBeenCalledWith(
      expect.objectContaining({ state: "all", since: "2025-03-01T00:00:00.000Z" }),
    );
    expect(issue.metadata).toMatchObject({ state: "closed", statusId: "canceled" });
  });

  it("pages until a short page", async () => {
    const issue = (number: number) => ({
      number,
      title: `#${number}`,
      body: null,
      html_url: `https://github.com/octocat/hello-world/issues/${number}`,
      state: "open",
      created_at: "2025-01-01T00:00:00Z",
      labels: [],
      assignee: null,
    });
    mockListForRepo
      .mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, i) => issue(i + 1)) })
      .mockResolvedValueOnce({ data: [issue(101)] });

    const result = await githubIssuesFetcher.fetchForResource({
      ...baseArgs,
      limit: 1000,
      resource: validResource,
    });

    expect(result).toHaveLength(101);
    // Same page size on every page, or page 2 would overlap page 1.
    expect(mockListForRepo.mock.calls[1][0]).toMatchObject({ page: 2, per_page: 100 });
    expect(mockListForRepo).toHaveBeenCalledTimes(2);
  });

  it("normalizes issues, filtering out pull requests", async () => {
    mockListForRepo.mockResolvedValue({
      data: [
        {
          number: 1,
          title: "Open issue",
          body: "Body text",
          html_url: "https://github.com/octocat/hello-world/issues/1",
          state: "open",
          created_at: "2025-01-01T00:00:00Z",
          labels: [{ name: "bug", color: "d73a4a" }, "feature"],
          assignee: { login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/1" },
          milestone: { title: "v1.0" },
          pull_request: undefined,
        },
        {
          number: 2,
          title: "Actually a PR",
          body: null,
          html_url: "https://github.com/octocat/hello-world/pull/2",
          state: "open",
          created_at: "2025-01-02T00:00:00Z",
          labels: [],
          assignee: null,
          pull_request: { url: "..." },
        },
      ],
    });

    const result = await githubIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "issue",
      title: "Open issue",
      externalId: "octocat/hello-world#1",
      connectionId: "conn-1",
      resourceId: "res-1",
      metadata: {
        provider: "github",
        number: 1,
        repo: "octocat/hello-world",
        labels: ["bug", "feature"],
        state: "open",
        stateId: "open",
        statusId: "todo",
        assignee: "octocat",
        identifier: "#1",
        labelColors: { bug: "#d73a4a" },
        assigneeAvatarUrl: "https://avatars.githubusercontent.com/u/1",
        group: { name: "v1.0", color: null },
      },
    });
  });

  it("clamps limit to 1..100", async () => {
    mockListForRepo.mockResolvedValue({ data: [] });
    await githubIssuesFetcher.fetchForResource({
      ...baseArgs,
      limit: 500,
      resource: validResource,
    });
    expect(mockListForRepo).toHaveBeenCalledWith(
      expect.objectContaining({ per_page: 100 }),
    );
  });
});

describe("githubPullRequestsFetcher", () => {
  it("normalizes pull requests with draft flag", async () => {
    mockPullsList.mockResolvedValue({
      data: [
        {
          number: 7,
          title: "Add feature",
          body: "Description",
          html_url: "https://github.com/octocat/hello-world/pull/7",
          state: "open",
          draft: true,
          created_at: "2025-02-01T00:00:00Z",
          labels: [{ name: "wip" }],
        },
      ],
    });

    const result = await githubPullRequestsFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "pull_request",
      externalId: "octocat/hello-world#7",
      metadata: {
        provider: "github",
        number: 7,
        repo: "octocat/hello-world",
        labels: ["wip"],
        state: "open",
        draft: true,
      },
    });
  });

  it("returns [] when no token in secrets", async () => {
    const result = await githubPullRequestsFetcher.fetchForResource({
      ...baseArgs,
      secrets: {},
      resource: validResource,
    });
    expect(result).toEqual([]);
  });
});

describe("fetcher metadata", () => {
  it("github:issues uses github_repo kind", () => {
    expect(githubIssuesFetcher.provider).toBe("github");
    expect(githubIssuesFetcher.resourceKind).toBe("github_repo");
    expect(githubIssuesFetcher.id).toBe("github:issues");
  });

  it("github:pull_requests uses github_repo kind", () => {
    expect(githubPullRequestsFetcher.resourceKind).toBe("github_repo");
  });
});
