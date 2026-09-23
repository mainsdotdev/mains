import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { sentryIssuesFetcher } from "./sentry";
import type { SelectedResource } from "../sync.dto";

beforeEach(() => {
  vi.clearAllMocks();
});

const validResource: SelectedResource = {
  id: "res-1",
  connectionId: "conn-1",
  externalId: "my-project",
  name: "My Project",
  kind: "sentry_project",
  metadata: {},
};

const baseArgs = {
  secrets: { token: "sentry_token" },
  metadata: { organization: "my-org" },
  limit: 10,
  connectionId: "conn-1",
};

function mockResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
  };
}

describe("sentryIssuesFetcher.fetchForResource", () => {
  it("returns [] when token missing", async () => {
    const result = await sentryIssuesFetcher.fetchForResource({
      ...baseArgs,
      secrets: {},
      resource: validResource,
    });
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns [] when organization missing from metadata", async () => {
    const result = await sentryIssuesFetcher.fetchForResource({
      ...baseArgs,
      metadata: {},
      resource: validResource,
    });
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns [] when API responds non-ok", async () => {
    mockFetch.mockResolvedValue(mockResponse({}, false, 500));
    const result = await sentryIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });
    expect(result).toEqual([]);
  });

  it("builds URL with org and project slugs", async () => {
    mockFetch.mockResolvedValue(mockResponse([]));
    await sentryIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/projects/my-org/my-project/issues/?query=is:unresolved",
      ),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sentry_token",
        }),
      }),
    );
  });

  it("normalizes issues to signal kind", async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        {
          id: "iss-1",
          title: "TypeError: undefined is not a function",
          culprit: "src/foo.ts in bar()",
          permalink: "https://sentry.io/.../iss-1/",
          shortId: "PROJ-1",
          level: "error",
          status: "unresolved",
          type: "error",
          count: "42",
          userCount: 7,
          firstSeen: "2025-01-01T00:00:00Z",
          lastSeen: "2025-01-02T00:00:00Z",
          metadata: {
            value: "undefined is not a function",
            type: "TypeError",
            filename: "src/foo.ts",
            function: "bar",
          },
          assignedTo: { name: "alice", email: "alice@a.co" },
          project: { slug: "my-project", name: "My Project" },
        },
      ]),
    );

    const result = await sentryIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "signal",
      title: "TypeError: undefined is not a function",
      externalId: "iss-1",
      connectionId: "conn-1",
      resourceId: "res-1",
      metadata: {
        source: "sentry",
        level: "error",
        category: "exception",
        state: "open",
        eventCount: 42,
        affectedUsers: 7,
        file: "src/foo.ts",
        function: "bar",
        assignee: "alice",
        shortId: "PROJ-1",
        projectSlug: "my-project",
      },
    });
  });

  it("maps status=resolved to state=resolved", async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        {
          id: "iss-2",
          title: "Already fixed",
          culprit: "",
          permalink: "",
          shortId: "PROJ-2",
          level: "warning",
          status: "resolved",
          type: "default",
          count: "1",
          userCount: 0,
          firstSeen: "2025-01-01T00:00:00Z",
          lastSeen: "2025-01-01T00:00:00Z",
          metadata: {},
          project: { slug: "p", name: "P" },
        },
      ]),
    );

    const result = await sentryIssuesFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });
    expect(result[0].metadata).toMatchObject({ state: "resolved" });
  });
});

describe("fetcher metadata", () => {
  it("uses sentry_project kind and signal entity kind", () => {
    expect(sentryIssuesFetcher.provider).toBe("sentry");
    expect(sentryIssuesFetcher.resourceKind).toBe("sentry_project");
  });
});
