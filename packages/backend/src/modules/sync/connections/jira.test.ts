import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { jiraIssuesFetcher } from "./jira";
import type { SelectedResource } from "../sync.dto";

beforeEach(() => {
  vi.clearAllMocks();
});

const validResource: SelectedResource = {
  id: "res-1",
  connectionId: "conn-1",
  externalId: "PROJ",
  name: "Project",
  kind: "jira_project",
  metadata: {},
};

const baseArgs = {
  secrets: { apiToken: "jira_test" },
  metadata: { domain: "acme.atlassian.net", email: "user@acme.co" },
  limit: 10,
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

describe("jiraIssuesFetcher.fetchForResource", () => {
  it("returns [] when apiToken missing", async () => {
    const result = await jiraIssuesFetcher.fetchForResource({
      ...baseArgs,
      secrets: {},
      resource: validResource,
    });
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns [] when metadata missing domain or email", async () => {
    const result = await jiraIssuesFetcher.fetchForResource({
      ...baseArgs,
      metadata: { domain: "acme.atlassian.net" },
      resource: validResource,
    });
    expect(result).toEqual([]);
  });

  it("returns [] when API responds with non-ok status", async () => {
    mockFetch.mockResolvedValue(mockResponse({}, false, 401));
    const result = await jiraIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });
    expect(result).toEqual([]);
  });

  it("builds the search URL from metadata.domain", async () => {
    mockFetch.mockResolvedValue(mockResponse({ issues: [] }));
    await jiraIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://acme.atlassian.net/rest/api/3/search/jql",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("AND resolution = Unresolved"),
      }),
    );
  });

  it("normalizes issues with ADF description", async () => {
    mockFetch.mockResolvedValue(
      mockResponse({
        issues: [
          {
            id: "10001",
            key: "PROJ-5",
            self: "url",
            fields: {
              summary: "Fix flaky test",
              description: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "Reproduces on CI." },
                    ],
                  },
                ],
              },
              status: {
                name: "In Progress",
                statusCategory: { key: "indeterminate" },
              },
              issuetype: { name: "Bug" },
              priority: { id: "3", name: "Medium" },
              assignee: { displayName: "Alice" },
              reporter: { displayName: "Bob" },
              labels: ["flaky"],
              created: "2025-01-01T00:00:00.000Z",
              updated: "2025-01-02T00:00:00.000Z",
              duedate: null,
              project: { key: "PROJ", name: "Project" },
            },
          },
        ],
      }),
    );

    const result = await jiraIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "issue",
      title: "Fix flaky test",
      body: "Reproduces on CI.",
      externalId: "PROJ-5",
      url: "https://acme.atlassian.net/browse/PROJ-5",
      metadata: {
        provider: "jira",
        key: "PROJ-5",
        projectKey: "PROJ",
        state: "In Progress",
        statusCategory: "indeterminate",
        type: "Bug",
        priority: "Medium",
        assignee: "Alice",
        reporter: "Bob",
        labels: ["flaky"],
        number: 5,
      },
    });
  });
});

describe("fetcher metadata", () => {
  it("uses jira_project kind", () => {
    expect(jiraIssuesFetcher.provider).toBe("jira");
    expect(jiraIssuesFetcher.resourceKind).toBe("jira_project");
  });
});
