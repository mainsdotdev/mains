import { describe, it, expect, vi, beforeEach } from "vitest";

import { gitlabIssuesFetcher, gitlabMergeRequestsFetcher } from "./gitlab";
import type { SelectedResource } from "../sync.dto";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

const validResource: SelectedResource = {
  id: "res-1",
  connectionId: "conn-1",
  externalId: "42",
  name: "my-project",
  kind: "gitlab_project",
  metadata: {},
};

const baseArgs = {
  secrets: { token: "glpat_test" },
  metadata: { domain: "gitlab.example.com" },
  limit: 5,
  connectionId: "conn-1",
};

function mockResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("gitlabIssuesFetcher", () => {
  it("returns [] when no token in secrets", async () => {
    const result = await gitlabIssuesFetcher.fetchForResource({
      ...baseArgs,
      secrets: {},
      resource: validResource,
    });
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns [] when API responds with non-ok status", async () => {
    mockFetch.mockResolvedValue(mockResponse({}, false, 500));
    const result = await gitlabIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });
    expect(result).toEqual([]);
  });

  it("uses metadata.domain when building URL", async () => {
    mockFetch.mockResolvedValue(mockResponse([]));
    await gitlabIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://gitlab.example.com/api/v4/projects/42/issues"),
      expect.anything(),
    );
  });

  it("falls back to gitlab.com when metadata.domain is missing", async () => {
    mockFetch.mockResolvedValue(mockResponse([]));
    await gitlabIssuesFetcher.fetchForResource({
      ...baseArgs,
      metadata: {},
      resource: validResource,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://gitlab.com/api/v4/"),
      expect.anything(),
    );
  });

  it("normalizes issues", async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        {
          iid: 17,
          title: "Bug report",
          description: "Something broke",
          web_url: "https://gitlab.example.com/group/proj/-/issues/17",
          created_at: "2025-01-01T00:00:00Z",
          state: "opened",
          labels: ["bug", "regression"],
          assignee: { username: "alice" },
        },
      ]),
    );
    const result = await gitlabIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "issue",
      externalId: "gitlab:42#17",
      connectionId: "conn-1",
      resourceId: "res-1",
      metadata: {
        provider: "gitlab",
        iid: 17,
        labels: ["bug", "regression"],
        state: "opened",
        assignee: "alice",
      },
    });
  });

  it("rewrites relative upload URLs in body", async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        {
          iid: 18,
          title: "Has image",
          description: "![alt](/uploads/abc/image.png){width=900}",
          web_url: "",
          created_at: "2025-01-01T00:00:00Z",
          state: "opened",
          labels: [],
        },
      ]),
    );
    const result = await gitlabIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });
    expect(result[0].body).toBe(
      "![alt](https://gitlab.example.com/-/project/42/uploads/abc/image.png)",
    );
  });
});

describe("gitlabMergeRequestsFetcher", () => {
  it("normalizes merge requests with draft flag", async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        {
          iid: 3,
          title: "Draft MR",
          description: null,
          web_url: "https://gitlab.example.com/group/proj/-/merge_requests/3",
          created_at: "2025-02-01T00:00:00Z",
          state: "opened",
          draft: true,
          labels: [],
          assignee: null,
        },
      ]),
    );
    const result = await gitlabMergeRequestsFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });
    expect(result[0]).toMatchObject({
      kind: "merge_request",
      externalId: "gitlab:42!3",
      metadata: { draft: true, state: "opened" },
    });
  });
});

describe("fetcher metadata", () => {
  it("both fetchers use gitlab_project kind", () => {
    expect(gitlabIssuesFetcher.resourceKind).toBe("gitlab_project");
    expect(gitlabMergeRequestsFetcher.resourceKind).toBe("gitlab_project");
  });
});
