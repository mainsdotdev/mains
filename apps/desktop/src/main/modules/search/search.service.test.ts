import { afterEach, describe, expect, it, vi } from "vitest";
import { searchRepo } from "./search.repo";
import { searchService, searchSnippet } from "./search.service";

describe("searchService", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not touch storage for an empty query", async () => {
    const workspaceSpy = vi.spyOn(searchRepo, "findWorkspaces");

    await expect(searchService.query({ query: "   " })).resolves.toEqual([]);
    expect(workspaceSpy).not.toHaveBeenCalled();
  });

  it("clamps the per-kind limit and scopes every read to the account", async () => {
    const workspaces = vi.spyOn(searchRepo, "findWorkspaces").mockReturnValue([]);
    const runs = vi.spyOn(searchRepo, "findRuns").mockReturnValue([]);
    const messages = vi.spyOn(searchRepo, "findMessages").mockReturnValue([]);
    const documents = vi.spyOn(searchRepo, "findDocuments").mockReturnValue([]);

    await searchService.query({
      query: "  launch plan  ",
      accountId: "account-1",
      limitPerKind: 999,
    });

    const expected = {
      accountId: "account-1",
      query: "launch plan",
      limit: 25,
    };
    expect(workspaces).toHaveBeenCalledWith(expected);
    expect(runs).toHaveBeenCalledWith(expected);
    expect(messages).toHaveBeenCalledWith(expected);
    expect(documents).toHaveBeenCalledWith(expected);
  });

  it("returns a compact navigation projection for runs and documents", async () => {
    vi.spyOn(searchRepo, "findWorkspaces").mockReturnValue([]);
    vi.spyOn(searchRepo, "findRuns").mockReturnValue([
      {
        id: "run-1",
        title: "Launch plan",
        goal: "Prepare the launch plan for next week",
        workspaceId: null,
        collectionId: "collection-1",
        spaceId: "space-1",
        providerId: "codex",
        mode: "work",
        workspaceName: null,
        collectionName: "Product",
        updatedAt: 1_700_000_000,
      },
    ]);
    vi.spyOn(searchRepo, "findMessages").mockReturnValue([]);
    vi.spyOn(searchRepo, "findDocuments").mockReturnValue([
      {
        artifactId: 42,
        id: "run-1",
        path: "/tmp/final-launch-plan.docx",
        content: "A concise launch plan with owners and milestones.",
        createdAt: 1_700_000_100,
        title: "Launch plan",
        goal: "Prepare the launch plan",
        workspaceId: null,
        collectionId: "collection-1",
        spaceId: "space-1",
        providerId: "codex",
        mode: "work",
        workspaceName: null,
        collectionName: "Product",
        updatedAt: 1_700_000_000,
      },
    ]);

    const results = await searchService.query({ query: "launch" });

    expect(results).toEqual([
      expect.objectContaining({
        id: "run-1",
        kind: "run",
        title: "Launch plan",
        collectionId: "collection-1",
        providerId: "codex",
        mode: "work",
        updatedAt: 1_700_000_000_000,
      }),
      expect.objectContaining({
        id: "document:42",
        kind: "document",
        title: "final-launch-plan.docx",
        runId: "run-1",
        path: "/tmp/final-launch-plan.docx",
        updatedAt: 1_700_000_100_000,
      }),
    ]);
  });

  it("merges full-text message matches into one result per run", async () => {
    vi.spyOn(searchRepo, "findWorkspaces").mockReturnValue([]);
    vi.spyOn(searchRepo, "findRuns").mockReturnValue([
      {
        id: "run-1",
        title: "Gyroscope demo",
        goal: "Build an interactive physics demo",
        workspaceId: "workspace-1",
        collectionId: null,
        spaceId: "space-1",
        providerId: "codex",
        mode: "developer",
        workspaceName: "Mains",
        collectionName: null,
        updatedAt: 1_700_000_000,
      },
    ]);
    vi.spyOn(searchRepo, "findMessages").mockReturnValue([
      {
        artifactId: 9,
        id: "run-1",
        matchSnippet: "reverse the spin to reverse its direction",
        speaker: "Agent",
        messageCreatedAt: 1_700_000_100,
        relevance: -2.5,
        title: "Gyroscope demo",
        goal: "Build an interactive physics demo",
        workspaceId: "workspace-1",
        collectionId: null,
        spaceId: "space-1",
        providerId: "codex",
        mode: "developer",
        workspaceName: "Mains",
        collectionName: null,
        updatedAt: 1_700_000_000,
      },
      {
        artifactId: 10,
        id: "run-2",
        matchSnippet: "spin rate changes precession",
        speaker: "You",
        messageCreatedAt: 1_700_000_200,
        relevance: -1.5,
        title: "Physics notes",
        goal: null,
        workspaceId: null,
        collectionId: "collection-1",
        spaceId: "space-1",
        providerId: "codex",
        mode: "chat",
        workspaceName: null,
        collectionName: "Research",
        updatedAt: 1_700_000_200,
      },
    ]);
    vi.spyOn(searchRepo, "findDocuments").mockReturnValue([]);

    const results = await searchService.query({ query: "spin" });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(
      expect.objectContaining({
        id: "run-1",
        snippet: "Agent: reverse the spin to reverse its direction",
      }),
    );
    expect(results[1]).toEqual(
      expect.objectContaining({
        id: "run-2",
        snippet: "You: spin rate changes precession",
      }),
    );
  });
});

describe("searchSnippet", () => {
  it("centres and bounds a match in long content", () => {
    const content = `${"before ".repeat(30)}needle ${"after ".repeat(30)}`;
    const snippet = searchSnippet(content, "needle");

    expect(snippet).toContain("needle");
    expect(snippet?.startsWith("…")).toBe(true);
    expect(snippet?.endsWith("…")).toBe(true);
    expect(snippet!.length).toBeLessThanOrEqual(172);
  });
});
