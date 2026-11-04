import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncService } from "./sync.service";
import * as syncFetchers from "./sync.fetchers";
import { syncRepo } from "./sync.repo";
import * as connectionUtils from "./sync.connection-utils";
import type { EntityInput, SyncCursor, SyncJobStats } from "./sync.dto";

// ─────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────
vi.mock("./sync.fetchers");
vi.mock("./sync.repo");
vi.mock("./sync.connection-utils");

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function makeEntity(overrides: Partial<EntityInput> = {}): EntityInput {
  return {
    kind: "issue",
    title: "Test issue",
    url: `https://github.com/test/repo/issues/${Math.random()}`,
    body: "Test body",
    summary: null,
    occurredAt: new Date().toISOString(),
    connectionId: "conn-1",
    ...overrides,
  };
}

function makeStats(overrides: Partial<SyncJobStats> = {}): SyncJobStats {
  return {
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    ...overrides,
  };
}

/** Wrap one or more provider batches in the async generator shape the
 *  service consumes. Each batch is { provider, entities }. */
function mockFetchBatches(
  batches: Array<{ provider?: string; entities: EntityInput[]; cursors?: SyncCursor[] }>,
) {
  async function* gen() {
    for (const b of batches) {
      yield { provider: b.provider ?? "github", entities: b.entities, cursors: b.cursors ?? [] };
    }
  }
  vi.mocked(syncFetchers.fetchEntitiesByProvider).mockImplementation(() => gen());
}

function mockFetchThrows(err: unknown) {
  vi.mocked(syncFetchers.fetchEntitiesByProvider).mockImplementation(() => {
    async function* gen(): AsyncGenerator<{
      provider: string;
      entities: EntityInput[];
      cursors: SyncCursor[];
    }> {
      throw err;
      yield { provider: "github", entities: [], cursors: [] };
    }
    return gen();
  });
}

describe("syncService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("runEntitySync", () => {
    it("saves a batch's cursors only after upserting its entities", async () => {
      const cursors = [{ resourceId: "res-1", syncedAt: new Date("2025-03-01T00:00:00Z") }];
      mockFetchBatches([{ provider: "linear:issues", entities: [makeEntity()], cursors }]);
      const order: string[] = [];
      vi.mocked(syncRepo.upsertEntities).mockImplementation(() => {
        order.push("upsert");
        return makeStats({ inserted: 1 });
      });
      vi.mocked(syncRepo.saveCursors).mockImplementation(() => {
        order.push("cursors");
      });

      await syncService.runEntitySync();

      expect(order).toEqual(["upsert", "cursors"]);
      expect(syncRepo.saveCursors).toHaveBeenCalledWith("linear:issues", cursors);
    });

    it("advances cursors when nothing changed", async () => {
      const cursors = [{ resourceId: "res-1", syncedAt: new Date("2025-03-01T00:00:00Z") }];
      mockFetchBatches([{ provider: "linear:issues", entities: [], cursors }]);

      await syncService.runEntitySync();

      expect(syncRepo.upsertEntities).not.toHaveBeenCalled();
      expect(syncRepo.saveCursors).toHaveBeenCalledWith("linear:issues", cursors);
    });

    it("returns empty result when no entities are fetched", async () => {
      mockFetchBatches([]);

      const result = await syncService.runEntitySync();
      expect(result.total).toBe(0);
      expect(result.inserted).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.stats.itemsPerSecond).toBe(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("passes provider argument to fetchEntitiesByProvider", async () => {
      mockFetchBatches([]);

      await syncService.runEntitySync("github");

      expect(syncFetchers.fetchEntitiesByProvider).toHaveBeenCalledWith("github");
    });

    it("returns success result when entities are fetched and upserted", async () => {
      const entities = [makeEntity(), makeEntity(), makeEntity()];
      const stats = makeStats({ inserted: 2, updated: 1 });

      mockFetchBatches([{ provider: "github", entities }]);
      vi.mocked(syncRepo.upsertEntities).mockReturnValueOnce(stats);

      const result = await syncService.runEntitySync();
      expect(result.total).toBe(3);
      expect(result.inserted).toBe(2);
      expect(result.updated).toBe(1);
    });

    it("aggregates stats from multiple provider batches", async () => {
      const batchA = [makeEntity(), makeEntity()];
      const batchB = [makeEntity()];

      mockFetchBatches([
        { provider: "github", entities: batchA },
        { provider: "linear", entities: batchB },
      ]);
      vi.mocked(syncRepo.upsertEntities)
        .mockReturnValueOnce(makeStats({ inserted: 2 }))
        .mockReturnValueOnce(makeStats({ updated: 1 }));

      const result = await syncService.runEntitySync();
      expect(result.total).toBe(3);
      expect(result.inserted).toBe(2);
      expect(result.updated).toBe(1);
      expect(syncRepo.upsertEntities).toHaveBeenCalledTimes(2);
      expect(syncRepo.upsertEntities).toHaveBeenNthCalledWith(1, batchA);
      expect(syncRepo.upsertEntities).toHaveBeenNthCalledWith(2, batchB);
    });

    it("does not call upsertEntities when batches are all empty", async () => {
      mockFetchBatches([{ entities: [] }]);

      await syncService.runEntitySync();

      expect(syncRepo.upsertEntities).not.toHaveBeenCalled();
    });

    it("throws when the generator throws", async () => {
      mockFetchThrows(new Error("Network failure"));

      await expect(syncService.runEntitySync()).rejects.toThrow(
        "Network failure",
      );
    });

    it("throws when upsertEntities throws", async () => {
      mockFetchBatches([{ entities: [makeEntity()] }]);
      vi.mocked(syncRepo.upsertEntities).mockImplementationOnce(() => {
        throw new Error("Database error");
      });

      await expect(syncService.runEntitySync()).rejects.toThrow(
        "Database error",
      );
    });
  });

  describe("issue status mapping", () => {
    const resource = { id: "res-1", connectionId: "conn", externalId: "ENG", name: "Eng", kind: "linear_team", metadata: {} };

    it("merges the user's mappings into the provider's states", async () => {
      vi.mocked(connectionUtils.getResourceById).mockReturnValue(resource);
      vi.mocked(syncFetchers.listResourceStates).mockResolvedValue([
        { id: "s-qa", name: "Ready for QA", color: null, defaultStatusId: "in_progress" },
        { id: "s-done", name: "Done", color: null, defaultStatusId: "done" },
      ]);
      vi.mocked(syncRepo.listStatusMappings).mockReturnValue(new Map([["s-qa", "in_review"]]));

      const result = await syncService.listIssueStates("res-1");

      expect(result).toEqual({
        resourceId: "res-1",
        supported: true,
        states: [
          { id: "s-qa", name: "Ready for QA", color: null, defaultStatusId: "in_progress", statusId: "in_review", mapped: true },
          { id: "s-done", name: "Done", color: null, defaultStatusId: "done", statusId: "done", mapped: false },
        ],
      });
    });

    it("reports providers without custom states as unsupported", async () => {
      vi.mocked(connectionUtils.getResourceById).mockReturnValue({ ...resource, kind: "github_repo" });
      vi.mocked(syncFetchers.listResourceStates).mockResolvedValue(null);

      await expect(syncService.listIssueStates("res-1")).resolves.toEqual({
        resourceId: "res-1",
        supported: false,
        states: [],
      });
    });

    it("rejects an unknown resource or status before writing", async () => {
      vi.mocked(connectionUtils.getResourceById).mockReturnValue(null);
      await expect(syncService.listIssueStates("gone")).rejects.toThrow("Resource not found");
      await expect(
        syncService.setIssueStatusMapping({ resourceId: "gone", stateId: "s", statusId: "done" }),
      ).rejects.toThrow("Resource not found");

      vi.mocked(connectionUtils.getResourceById).mockReturnValue(resource);
      vi.mocked(syncRepo.statusExists).mockReturnValue(false);
      await expect(
        syncService.setIssueStatusMapping({ resourceId: "res-1", stateId: "s", statusId: "nope" }),
      ).rejects.toThrow(/Unknown issue status/);
      expect(syncRepo.setStatusMapping).not.toHaveBeenCalled();
    });

    it("sets a mapping, or clears it with null", async () => {
      vi.mocked(connectionUtils.getResourceById).mockReturnValue(resource);
      vi.mocked(syncRepo.statusExists).mockReturnValue(true);
      vi.mocked(syncRepo.setStatusMapping).mockReturnValue(3);

      await expect(
        syncService.setIssueStatusMapping({ resourceId: "res-1", stateId: "s-qa", statusId: "in_review" }),
      ).resolves.toEqual({ updated: 3 });
      await syncService.setIssueStatusMapping({ resourceId: "res-1", stateId: "s-qa", statusId: null });

      expect(syncRepo.setStatusMapping).toHaveBeenNthCalledWith(1, "res-1", "s-qa", "in_review");
      expect(syncRepo.setStatusMapping).toHaveBeenNthCalledWith(2, "res-1", "s-qa", null);
    });
  });
});
