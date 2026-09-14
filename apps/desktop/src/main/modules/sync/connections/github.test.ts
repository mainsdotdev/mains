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
  it("returns [] when no token in secrets", async () => {
    const result = await githubIssuesFetcher.fetchForResource({
      ...baseArgs,
      secrets: {},
      resource: validResource,
    });
    expect(result).toEqual([]);
    expect(mockListForRepo).not.toHaveBeenCalled();
  });

  it("returns [] when resource identifier lacks a slash", async () => {
    const result = await githubIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: { ...validResource, externalId: "no-slash" },
    });
    expect(result).toEqual([]);
    expect(mockListForRepo).not.toHaveBeenCalled();
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
          labels: [{ name: "bug" }, "feature"],
          assignee: { login: "octocat" },
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
        assignee: "octocat",
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
