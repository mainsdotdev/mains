import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { asanaTasksFetcher } from "./asana";
import type { SelectedResource } from "../sync.dto";

beforeEach(() => {
  vi.clearAllMocks();
});

const validResource: SelectedResource = {
  id: "res-1",
  connectionId: "conn-1",
  externalId: "12345",
  name: "My Project",
  kind: "asana_project",
  metadata: {},
};

const baseArgs = {
  secrets: { accessToken: "asana_test" },
  metadata: {},
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

describe("asanaTasksFetcher.fetchForResource", () => {
  it("is incremental", () => {
    expect(asanaTasksFetcher.incremental).toBe(true);
  });

  it("throws without an accessToken, so the runner keeps its cursor", async () => {
    await expect(
      asanaTasksFetcher.fetchForResource({ ...baseArgs, secrets: {}, resource: validResource }),
    ).rejects.toThrow(/access token/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when the API responds with a non-ok status", async () => {
    mockFetch.mockResolvedValue(mockResponse({}, false, 401));
    await expect(
      asanaTasksFetcher.fetchForResource({ ...baseArgs, resource: validResource }),
    ).rejects.toThrow(/401/);
  });

  it("asks the task search for everything modified since the cursor", async () => {
    mockFetch.mockResolvedValue(mockResponse({ data: [] }));
    await asanaTasksFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
      since: new Date("2025-03-01T00:00:00Z"),
    });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/tasks?project=12345");
    expect(url).toContain(`modified_since=${encodeURIComponent("2025-03-01T00:00:00.000Z")}`);
    expect(url).not.toContain("completed_since");
  });

  it("follows next_page offsets", async () => {
    const task = (gid: string) => ({
      gid,
      name: gid,
      notes: null,
      permalink_url: `https://app.asana.com/0/12345/${gid}`,
      created_at: "2025-01-01T00:00:00Z",
      modified_at: "2025-01-02T00:00:00Z",
      completed: false,
      completed_at: null,
      due_on: null,
      due_at: null,
      assignee: null,
      projects: [],
      workspace: { gid: "w1", name: "Workspace" },
      tags: [],
    });
    mockFetch
      .mockResolvedValueOnce(mockResponse({ data: [task("1")], next_page: { offset: "abc" } }))
      .mockResolvedValueOnce(mockResponse({ data: [task("2")], next_page: null }));

    const result = await asanaTasksFetcher.fetchForResource({ ...baseArgs, resource: validResource });

    expect(result.map((r) => r.externalId)).toEqual(["12345#1", "12345#2"]);
    expect(mockFetch.mock.calls[1][0]).toContain("&offset=abc");
  });

  it("uses the project gid in the URL and bearer token in headers", async () => {
    mockFetch.mockResolvedValue(mockResponse({ data: [] }));
    await asanaTasksFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/projects/12345/tasks?"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer asana_test",
        }),
      }),
    );
  });

  it("normalizes tasks", async () => {
    mockFetch.mockResolvedValue(
      mockResponse({
        data: [
          {
            gid: "1001",
            name: "Write spec",
            notes: "Notes go here",
            permalink_url: "https://app.asana.com/0/12345/1001",
            created_at: "2025-01-01T00:00:00Z",
            modified_at: "2025-01-02T00:00:00Z",
            completed: false,
            completed_at: null,
            due_on: "2025-02-01",
            due_at: null,
            assignee: { gid: "u1", name: "alice", photo: { image_60x60: "https://s3.asana/a.png" } },
            projects: [{ gid: "12345", name: "My Project" }],
            workspace: { gid: "w1", name: "Workspace" },
            tags: [{ gid: "t1", name: "urgent", color: "dark-red" }],
            custom_fields: [{ name: "Priority", enum_value: { name: "High" } }],
          },
        ],
      }),
    );

    const result = await asanaTasksFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "issue",
      externalId: "12345#1001",
      title: "Write spec",
      metadata: {
        provider: "asana",
        taskGid: "1001",
        projectGid: "12345",
        workspaceGid: "w1",
        completed: false,
        assignee: "alice",
        labels: ["urgent"],
        state: "open",
        stateId: null,
        statusId: "todo",
        identifier: null,
        labelColors: { urgent: "#e8384f" },
        assigneeAvatarUrl: "https://s3.asana/a.png",
        priorityLevel: 2,
        dueAt: "2025-02-01",
      },
    });
  });

  it("reads the task's section in this project as its state", async () => {
    mockFetch.mockResolvedValue(
      mockResponse({
        data: [
          {
            gid: "1002",
            name: "Review copy",
            notes: null,
            permalink_url: "https://app.asana.com/0/12345/1002",
            created_at: "2025-01-01T00:00:00Z",
            modified_at: "2025-01-02T00:00:00Z",
            completed: false,
            completed_at: null,
            due_on: null,
            due_at: null,
            assignee: null,
            projects: [{ gid: "12345", name: "My Project" }],
            // Multi-homed: only this project's section counts.
            memberships: [
              { project: { gid: "99999" }, section: { gid: "s-other", name: "Done" } },
              { project: { gid: "12345" }, section: { gid: "s-review", name: "In review" } },
            ],
            workspace: { gid: "w1", name: "Workspace" },
            tags: [],
          },
        ],
      }),
    );

    const [task] = await asanaTasksFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });

    expect(task.metadata).toMatchObject({
      state: "In review",
      stateId: "s-review",
      statusId: "in_review",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("memberships.section.name"),
      expect.anything(),
    );
  });

  it("treats Asana's default section as no state at all", async () => {
    mockFetch.mockResolvedValue(
      mockResponse({
        data: [
          {
            gid: "1003",
            name: "Loose task",
            notes: null,
            permalink_url: "https://app.asana.com/0/12345/1003",
            created_at: "2025-01-01T00:00:00Z",
            modified_at: "2025-01-02T00:00:00Z",
            completed: false,
            completed_at: null,
            due_on: null,
            due_at: null,
            assignee: null,
            projects: [],
            memberships: [{ project: { gid: "12345" }, section: { gid: "s0", name: "(no section)" } }],
            workspace: { gid: "w1", name: "Workspace" },
            tags: [],
          },
        ],
      }),
    );

    const [task] = await asanaTasksFetcher.fetchForResource({ ...baseArgs, resource: validResource });

    expect(task.metadata).toMatchObject({ state: "open", stateId: null, statusId: "todo" });
  });
});

describe("asanaTasksFetcher.listStates", () => {
  it("lists the project's sections, guessing a status from each name", async () => {
    mockFetch.mockResolvedValue(
      mockResponse({
        data: [
          // Asana's bucket for section-less tasks is no state to map.
          { gid: "s0", name: "(no section)" },
          { gid: "s1", name: "To do" },
          { gid: "s2", name: "Doing" },
          { gid: "s3", name: "Done" },
        ],
      }),
    );

    const states = await asanaTasksFetcher.listStates!({
      resource: validResource,
      secrets: baseArgs.secrets,
      metadata: {},
    });

    expect(mockFetch.mock.calls[0][0]).toContain("/projects/12345/sections");
    expect(states.map((s) => [s.id, s.defaultStatusId])).toEqual([
      ["s1", "todo"],
      ["s2", "in_progress"],
      ["s3", "done"],
    ]);
  });
});

describe("fetcher metadata", () => {
  it("uses asana_project kind", () => {
    expect(asanaTasksFetcher.provider).toBe("asana");
    expect(asanaTasksFetcher.resourceKind).toBe("asana_project");
  });
});
