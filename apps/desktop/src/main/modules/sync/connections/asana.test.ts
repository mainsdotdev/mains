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
  it("returns [] when no accessToken in secrets", async () => {
    const result = await asanaTasksFetcher.fetchForResource({
      ...baseArgs,
      secrets: {},
      resource: validResource,
    });
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns [] when API responds with non-ok status", async () => {
    mockFetch.mockResolvedValue(mockResponse({}, false, 401));
    const result = await asanaTasksFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });
    expect(result).toEqual([]);
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
            assignee: { gid: "u1", name: "alice" },
            projects: [{ gid: "12345", name: "My Project" }],
            workspace: { gid: "w1", name: "Workspace" },
            tags: [{ gid: "t1", name: "urgent" }],
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
      },
    });
  });
});

describe("fetcher metadata", () => {
  it("uses asana_project kind", () => {
    expect(asanaTasksFetcher.provider).toBe("asana");
    expect(asanaTasksFetcher.resourceKind).toBe("asana_project");
  });
});
