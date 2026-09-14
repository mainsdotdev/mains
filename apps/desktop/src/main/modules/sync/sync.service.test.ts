import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncService } from "./sync.service";
import * as syncFetchers from "./sync.fetchers";
import { syncRepo } from "./sync.repo";
import type { EntityInput, SyncJobStats } from "./sync.dto";

// ─────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────
vi.mock("./sync.fetchers");
vi.mock("./sync.repo");

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
  batches: Array<{ provider?: string; entities: EntityInput[] }>,
) {
  async function* gen() {
    for (const b of batches) {
      yield { provider: b.provider ?? "github", entities: b.entities };
    }
  }
  vi.mocked(syncFetchers.fetchEntitiesByProvider).mockImplementation(() => gen());
}

function mockFetchThrows(err: unknown) {
  vi.mocked(syncFetchers.fetchEntitiesByProvider).mockImplementation(() => {
    async function* gen(): AsyncGenerator<{
      provider: string;
      entities: EntityInput[];
    }> {
      throw err;
      yield { provider: "github", entities: [] };
    }
    return gen();
  });
}

describe("syncService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("runEntitySync", () => {
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
});
