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

const fakeFetchers: ResourceFetcher[] = [];
vi.mock("./connections", () => ({
  get RESOURCE_FETCHERS() {
    return fakeFetchers;
  },
}));

import { fetchAllEntities, fetchEntitiesByProvider } from "./sync.fetchers";

function makeFetcher(
  id: string,
  provider: string,
  options: {
    forResource?: ResourceFetcher["fetchForResource"];
    fetchAll?: ResourceFetcher["fetchAll"];
    resourceKind?: string;
    defaultLimit?: number;
  } = {},
): ResourceFetcher {
  return {
    id,
    provider,
    resourceKind: options.resourceKind ?? `${provider}_resource`,
    defaultLimit: options.defaultLimit ?? 25,
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

describe("registry shape (smoke)", () => {
  it("imports the real registry without errors", async () => {
    const mod = await vi.importActual<{ RESOURCE_FETCHERS: ResourceFetcher[] }>(
      "./connections",
    );
    expect(mod.RESOURCE_FETCHERS.length).toBeGreaterThan(0);
    expect(mod.RESOURCE_FETCHERS.every((f) => !!f.id && !!f.provider)).toBe(true);
  });
});
