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
  it("is incremental", () => {
    expect(jiraIssuesFetcher.incremental).toBe(true);
  });

  it("throws when apiToken is missing, so the runner keeps its cursor", async () => {
    await expect(
      jiraIssuesFetcher.fetchForResource({ ...baseArgs, secrets: {}, resource: validResource }),
    ).rejects.toThrow(/API token/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when metadata is missing domain or email", async () => {
    await expect(
      jiraIssuesFetcher.fetchForResource({
        ...baseArgs,
        metadata: { domain: "acme.atlassian.net" },
        resource: validResource,
      }),
    ).rejects.toThrow();
  });

  it("throws when the API responds with a non-ok status", async () => {
    mockFetch.mockResolvedValue(mockResponse({}, false, 401));
    await expect(
      jiraIssuesFetcher.fetchForResource({ ...baseArgs, resource: validResource }),
    ).rejects.toThrow(/401/);
  });

  it("asks for every issue updated since the cursor, as a relative date", async () => {
    vi.useFakeTimers({ now: new Date("2025-03-01T02:00:00Z") });
    try {
      mockFetch.mockResolvedValue(mockResponse({ issues: [], isLast: true }));
      await jiraIssuesFetcher.fetchForResource({
        ...baseArgs,
        resource: validResource,
        since: new Date("2025-03-01T00:30:00Z"),
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.jql).toBe('project = "PROJ" AND updated >= -90m ORDER BY updated DESC');
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows nextPageToken until the last page", async () => {
    const issue = (n: number) => ({
      id: String(n),
      key: `PROJ-${n}`,
      self: "",
      fields: {
        summary: `Issue ${n}`,
        status: { id: "1", name: "To Do", statusCategory: { key: "new" } },
        issuetype: { name: "Task" },
        created: "2025-01-01T00:00:00.000Z",
        updated: "2025-01-01T00:00:00.000Z",
        project: { key: "PROJ", name: "Project" },
      },
    });
    mockFetch
      .mockResolvedValueOnce(mockResponse({ issues: [issue(1)], nextPageToken: "t2", isLast: false }))
      .mockResolvedValueOnce(mockResponse({ issues: [issue(2)], isLast: true }));

    const result = await jiraIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });

    expect(result.map((r) => r.externalId)).toEqual(["PROJ-1", "PROJ-2"]);
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toMatchObject({ nextPageToken: "t2" });
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
                id: "10001",
                name: "In Progress",
                statusCategory: { key: "indeterminate" },
              },
              issuetype: { name: "Bug" },
              priority: { id: "3", name: "Medium" },
              assignee: {
                displayName: "Alice",
                avatarUrls: { "48x48": "https://avatar.atl/alice-48.png" },
              },
              parent: { fields: { summary: "Checkout revamp", issuetype: { name: "Epic" } } },
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
        stateId: "10001",
        statusId: "in_progress",
        identifier: "PROJ-5",
        priorityLevel: 3,
        assigneeAvatarUrl: "https://avatar.atl/alice-48.png",
        group: { name: "Checkout revamp", color: null },
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

describe("jiraIssuesFetcher.listStates", () => {
  it("lists the project's statuses once each, ordered by category", async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        {
          name: "Bug",
          statuses: [
            { id: "3", name: "Done", statusCategory: { key: "done" } },
            { id: "1", name: "To Do", statusCategory: { key: "new" } },
          ],
        },
        {
          name: "Task",
          statuses: [
            { id: "1", name: "To Do", statusCategory: { key: "new" } },
            { id: "2", name: "Ready for QA", statusCategory: { key: "indeterminate" } },
          ],
        },
      ]),
    );

    const states = await jiraIssuesFetcher.listStates!({
      resource: validResource,
      secrets: baseArgs.secrets,
      metadata: baseArgs.metadata,
    });

    expect(mockFetch.mock.calls[0][0]).toBe("https://acme.atlassian.net/rest/api/3/project/PROJ/statuses");
    expect(states).toEqual([
      { id: "1", name: "To Do", color: null, defaultStatusId: "todo" },
      { id: "2", name: "Ready for QA", color: null, defaultStatusId: "in_review" },
      { id: "3", name: "Done", color: null, defaultStatusId: "done" },
    ]);
  });
});

describe("fetcher metadata", () => {
  it("uses jira_project kind", () => {
    expect(jiraIssuesFetcher.provider).toBe("jira");
    expect(jiraIssuesFetcher.resourceKind).toBe("jira_project");
  });
});
