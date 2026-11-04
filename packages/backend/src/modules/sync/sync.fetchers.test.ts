import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ResourceFetcher, EntityInput } from "./sync.dto";

// ─────────────────────────────────────────────────────────────
// Stub the runtime registry + connection-utils so the runner can
// be exercised in isolation. Each test sets the fetcher list and
// connection state through these mocks.
// ─────────────────────────────────────────────────────────────

const mockGetConnectionWithSecrets = vi.fn();
const mockGetSelectedResources = vi.fn();

vi.mock("../connections", () => ({
  getConnectionWithSecrets: (...args: unknown[]) =>
    mockGetConnectionWithSecrets(...args),
}));

vi.mock("./sync.connection-utils", () => ({
  getSelectedResources: (...args: unknown[]) =>
    mockGetSelectedResources(...args),
}));

const mockGetCursor = vi.fn();
const mockOldestOpenIssueSeenAt = vi.fn();
vi.mock("./sync.repo", () => ({
  syncRepo: {
    getCursor: (...args: unknown[]) => mockGetCursor(...args),
    oldestOpenIssueSeenAt: (...args: unknown[]) => mockOldestOpenIssueSeenAt(...args),
  },
}));

const fakeFetchers: ResourceFetcher[] = [];
vi.mock("./connections", () => ({
  get RESOURCE_FETCHERS() {
    return fakeFetchers;
  },
}));

import { fetchAllEntities, fetchEntitiesByProvider, listResourceStates } from "./sync.fetchers";

function makeFetcher(
  id: string,
  provider: string,
  options: {
    forResource?: ResourceFetcher["fetchForResource"];
    fetchAll?: ResourceFetcher["fetchAll"];
    resourceKind?: string;
    defaultLimit?: number;
    incremental?: boolean;
  } = {},
): ResourceFetcher {
  return {
    id,
    provider,
    resourceKind: options.resourceKind ?? `${provider}_resource`,
    defaultLimit: options.defaultLimit ?? 25,
    incremental: options.incremental,
    fetchForResource: options.forResource ?? (async () => []),
    fetchAll: options.fetchAll,
  };
}

function entity(id: string): EntityInput {
  return {
    kind: "issue",
    title: id,
    url: `https://example.com/${id}`,
    body: null,
    summary: null,
    occurredAt: "2025-01-01T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeFetchers.length = 0;
});

describe("runner — fetchAllEntities", () => {
  it("returns [] for a fetcher whose provider has no connection", async () => {
    fakeFetchers.push(makeFetcher("ghost:x", "ghost"));
    mockGetConnectionWithSecrets.mockResolvedValue(null);

    const result = await fetchAllEntities();
    expect(result).toEqual([]);
  });

  it("iterates selected resources and accumulates entities", async () => {
    const forResource = vi.fn(async ({ resource }) => [entity(`${resource.id}-a`)]);
    fakeFetchers.push(makeFetcher("acme:items", "acme", { forResource }));

    mockGetConnectionWithSecrets.mockResolvedValue({
      id: "conn-1",
      secrets: { token: "t" },
      metadata: {},
    });
    mockGetSelectedResources.mockResolvedValue([
      { id: "r1", externalId: "x1", connectionId: "conn-1", name: "x1", kind: "acme_resource", metadata: {} },
      { id: "r2", externalId: "x2", connectionId: "conn-1", name: "x2", kind: "acme_resource", metadata: {} },
    ]);

    const result = await fetchAllEntities();
    expect(forResource).toHaveBeenCalledTimes(2);
    expect(result.map((e) => e.title)).toEqual(["r1-a", "r2-a"]);
  });

  it("uses fetchAll when no resources are selected and the fetcher opts in", async () => {
    const fetchAll = vi.fn().mockResolvedValue([entity("all-1")]);
    fakeFetchers.push(makeFetcher("linear:issues", "linear", { fetchAll }));

    mockGetConnectionWithSecrets.mockResolvedValue({
      id: "conn-1",
      secrets: { apiKey: "k" },
    });
    mockGetSelectedResources.mockResolvedValue([]);

    const result = await fetchAllEntities();
    expect(fetchAll).toHaveBeenCalledOnce();
    expect(result).toEqual([entity("all-1")]);
  });

  it("returns [] when no resources selected and fetcher has no fetchAll", async () => {
    fakeFetchers.push(makeFetcher("github:issues", "github"));

    mockGetConnectionWithSecrets.mockResolvedValue({
      id: "conn-1",
      secrets: { token: "t" },
    });
    mockGetSelectedResources.mockResolvedValue([]);

    const result = await fetchAllEntities();
    expect(result).toEqual([]);
  });

  it("survives one resource throwing without dropping the rest", async () => {
    const forResource = vi.fn(async ({ resource }) => {
      if (resource.id === "r-bad") throw new Error("boom");
      return [entity(resource.id)];
    });
    fakeFetchers.push(makeFetcher("acme:items", "acme", { forResource }));

    mockGetConnectionWithSecrets.mockResolvedValue({ id: "conn", secrets: {} });
    mockGetSelectedResources.mockResolvedValue([
      { id: "r-ok", externalId: "ok", connectionId: "conn", name: "ok", kind: "acme_resource", metadata: {} },
      { id: "r-bad", externalId: "bad", connectionId: "conn", name: "bad", kind: "acme_resource", metadata: {} },
      { id: "r-ok2", externalId: "ok2", connectionId: "conn", name: "ok2", kind: "acme_resource", metadata: {} },
    ]);

    const result = await fetchAllEntities();
    expect(result.map((e) => e.title)).toEqual(["r-ok", "r-ok2"]);
  });

  it("survives one fetcher rejecting without dropping siblings", async () => {
    const happy = vi.fn().mockResolvedValue([entity("happy-1")]);
    fakeFetchers.push(
      makeFetcher("broken:x", "broken", {
        forResource: vi.fn().mockRejectedValue(new Error("provider down")),
      }),
    );
    fakeFetchers.push(makeFetcher("happy:y", "happy", { forResource: happy }));

    mockGetConnectionWithSecrets.mockResolvedValue({ id: "conn", secrets: {} });
    mockGetSelectedResources.mockResolvedValue([
      { id: "r1", externalId: "x", connectionId: "conn", name: "x", kind: "k", metadata: {} },
    ]);

    const result = await fetchAllEntities();
    expect(result).toEqual([entity("happy-1")]);
  });

  it("filters fetchers when a provider is specified", async () => {
    const ghForResource = vi.fn().mockResolvedValue([entity("gh")]);
    const lnForResource = vi.fn().mockResolvedValue([entity("ln")]);
    fakeFetchers.push(makeFetcher("github:issues", "github", { forResource: ghForResource }));
    fakeFetchers.push(makeFetcher("linear:issues", "linear", { forResource: lnForResource }));

    mockGetConnectionWithSecrets.mockResolvedValue({ id: "conn", secrets: {} });
    mockGetSelectedResources.mockResolvedValue([
      { id: "r", externalId: "x", connectionId: "conn", name: "x", kind: "k", metadata: {} },
    ]);

    await fetchAllEntities("github");
    expect(ghForResource).toHaveBeenCalledOnce();
    expect(lnForResource).not.toHaveBeenCalled();
  });

  it("falls back to all fetchers for an unknown provider name", async () => {
    const fn1 = vi.fn().mockResolvedValue([]);
    const fn2 = vi.fn().mockResolvedValue([]);
    fakeFetchers.push(makeFetcher("a:x", "a", { forResource: fn1 }));
    fakeFetchers.push(makeFetcher("b:y", "b", { forResource: fn2 }));

    mockGetConnectionWithSecrets.mockResolvedValue({ id: "conn", secrets: {} });
    mockGetSelectedResources.mockResolvedValue([
      { id: "r", externalId: "x", connectionId: "conn", name: "x", kind: "k", metadata: {} },
    ]);

    await fetchAllEntities("totally_unknown");
    expect(fn1).toHaveBeenCalled();
    expect(fn2).toHaveBeenCalled();
  });

  it("passes the fetcher's defaultLimit through to fetchForResource", async () => {
    const forResource = vi.fn().mockResolvedValue([]);
    fakeFetchers.push(
      makeFetcher("acme:items", "acme", { forResource, defaultLimit: 73 }),
    );
    mockGetConnectionWithSecrets.mockResolvedValue({ id: "conn", secrets: {} });
    mockGetSelectedResources.mockResolvedValue([
      { id: "r1", externalId: "x", connectionId: "conn", name: "x", kind: "k", metadata: {} },
    ]);

    await fetchAllEntities();
    expect(forResource).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 73 }),
    );
  });
});

describe("runner — fetchEntitiesByProvider generator", () => {
  it("yields one batch per fetcher", async () => {
    fakeFetchers.push(
      makeFetcher("a:x", "a", { forResource: vi.fn().mockResolvedValue([entity("a")]) }),
    );
    fakeFetchers.push(
      makeFetcher("b:y", "b", { forResource: vi.fn().mockResolvedValue([entity("b")]) }),
    );
    mockGetConnectionWithSecrets.mockResolvedValue({ id: "conn", secrets: {} });
    mockGetSelectedResources.mockResolvedValue([
      { id: "r", externalId: "x", connectionId: "conn", name: "x", kind: "k", metadata: {} },
    ]);

    const batches: Array<{ provider: string; count: number }> = [];
    for await (const batch of fetchEntitiesByProvider()) {
      batches.push({ provider: batch.provider, count: batch.entities.length });
    }
    expect(batches).toEqual([
      { provider: "a:x", count: 1 },
      { provider: "b:y", count: 1 },
    ]);
  });
});

describe("runner — incremental cursors", () => {
  const resource = { id: "res-1", externalId: "ENG", connectionId: "conn", name: "Eng", kind: "k", metadata: {} };

  beforeEach(() => {
    mockGetConnectionWithSecrets.mockResolvedValue({ id: "conn", secrets: {} });
    mockGetSelectedResources.mockResolvedValue([resource]);
    mockGetCursor.mockReturnValue(null);
    mockOldestOpenIssueSeenAt.mockReturnValue(null);
  });

  async function runOnce() {
    const batches = [];
    for await (const batch of fetchEntitiesByProvider()) batches.push(batch);
    return batches[0];
  }

  it("leaves non-incremental fetchers alone: no since, no cursor", async () => {
    const forResource = vi.fn().mockResolvedValue([entity("a")]);
    fakeFetchers.push(makeFetcher("a:x", "a", { forResource }));

    const batch = await runOnce();

    expect(forResource.mock.calls[0][0]).not.toHaveProperty("since");
    expect(mockGetCursor).not.toHaveBeenCalled();
    expect(batch.cursors).toEqual([]);
  });

  it("asks for changes since the cursor, minus an overlap, and returns a new cursor", async () => {
    mockGetCursor.mockReturnValue(new Date("2025-03-01T00:10:00Z"));
    const forResource = vi.fn().mockResolvedValue([entity("a")]);
    fakeFetchers.push(makeFetcher("linear:issues", "linear", { forResource, incremental: true }));

    const before = Date.now();
    const batch = await runOnce();

    expect(mockGetCursor).toHaveBeenCalledWith("linear:issues", "res-1");
    expect(forResource).toHaveBeenCalledOnce();
    expect(forResource.mock.calls[0][0].since).toEqual(new Date("2025-03-01T00:05:00Z"));
    expect(batch.cursors).toHaveLength(1);
    expect(batch.cursors[0].resourceId).toBe("res-1");
    expect(batch.cursors[0].syncedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("fetches only the open set on a first run with nothing stored", async () => {
    const forResource = vi.fn().mockResolvedValue([entity("a")]);
    fakeFetchers.push(makeFetcher("linear:issues", "linear", { forResource, incremental: true }));

    const batch = await runOnce();

    expect(forResource).toHaveBeenCalledOnce();
    expect(forResource.mock.calls[0][0].since).toBeNull();
    expect(batch.cursors).toHaveLength(1);
  });

  it("catches up on closures of rows stored before cursors existed", async () => {
    mockOldestOpenIssueSeenAt.mockReturnValue(new Date("2025-01-01T00:05:00Z"));
    const forResource = vi
      .fn()
      .mockResolvedValueOnce([entity("open-1"), entity("closed-later")])
      .mockResolvedValueOnce([{ ...entity("closed-later"), title: "fresher" }, entity("closed-1")]);
    fakeFetchers.push(makeFetcher("linear:issues", "linear", { forResource, incremental: true }));

    const batch = await runOnce();

    expect(forResource.mock.calls.map((call) => call[0].since)).toEqual([
      null,
      new Date("2025-01-01T00:00:00Z"),
    ]);
    // One row per issue; the change feed's copy wins.
    expect(batch.entities.map((e: EntityInput) => e.title)).toEqual(["open-1", "fresher", "closed-1"]);
  });

  it("keeps the old cursor when a resource fails", async () => {
    mockGetCursor.mockReturnValue(new Date("2025-03-01T00:00:00Z"));
    const forResource = vi.fn().mockRejectedValue(new Error("rate limited"));
    fakeFetchers.push(makeFetcher("linear:issues", "linear", { forResource, incremental: true }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const batch = await runOnce();

    expect(batch.entities).toEqual([]);
    expect(batch.cursors).toEqual([]);
  });
});

describe("listResourceStates", () => {
  const resource = { id: "res-1", externalId: "ENG", connectionId: "conn", name: "Eng", kind: "linear_team", metadata: {} };

  it("asks the fetcher that owns the resource kind, with the connection's secrets", async () => {
    const listStates = vi.fn().mockResolvedValue([{ id: "s", name: "Todo", color: null, defaultStatusId: "todo" }]);
    fakeFetchers.push({ ...makeFetcher("linear:issues", "linear", { resourceKind: "linear_team" }), listStates });
    mockGetConnectionWithSecrets.mockResolvedValue({ id: "conn", secrets: { apiKey: "k" }, metadata: {} });

    const states = await listResourceStates(resource);

    expect(listStates).toHaveBeenCalledWith({ resource, secrets: { apiKey: "k" }, metadata: {} });
    expect(states).toHaveLength(1);
  });

  it("returns null for a provider with no states to map", async () => {
    fakeFetchers.push(makeFetcher("github:issues", "github", { resourceKind: "github_repo" }));
    await expect(listResourceStates({ ...resource, kind: "github_repo" })).resolves.toBeNull();
  });

  it("throws when the resource's connection is gone", async () => {
    fakeFetchers.push({ ...makeFetcher("linear:issues", "linear", { resourceKind: "linear_team" }), listStates: vi.fn() });
    mockGetConnectionWithSecrets.mockResolvedValue({ id: "a-newer-connection", secrets: {} });
    await expect(listResourceStates(resource)).rejects.toThrow(/no longer connected/);
  });
});

describe("registry shape (smoke)", () => {
  it("imports the real registry without errors", async () => {
    const mod = await vi.importActual<{ RESOURCE_FETCHERS: ResourceFetcher[] }>(
      "./connections",
    );
    expect(mod.RESOURCE_FETCHERS.length).toBeGreaterThan(0);
    expect(mod.RESOURCE_FETCHERS.every((f) => !!f.id && !!f.provider)).toBe(true);
  });
});
