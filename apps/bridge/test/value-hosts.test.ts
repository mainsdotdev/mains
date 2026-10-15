import { createRequire } from "node:module";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import type { SQLiteInstance } from "../../../packages/backend/src/db/types";
import { largeToolFixture, seedLargeTools } from "../../../packages/backend/test/large-tool-fixture";
import { startLocalBackends, waitFor } from "./local-backends";

describe.skipIf(process.env.MAINS_BRIDGE_HOST_TESTS !== "1")("Large values through two real backend processes", () => {
  it("syncs the three complete tool records with A offline and retains them across B's restart and cache eviction", async () => {
    const Database = createRequire(new URL("../../../packages/backend/package.json", import.meta.url))("better-sqlite3") as new (file: string) => SQLiteInstance;
    const fixture = await startLocalBackends(), { a, b } = fixture;
    try {
      await a.stop();
      const sqliteA = new Database(join(a.dir, "mains.db"));
      let expected: ReturnType<typeof seedLargeTools>;
      try { expected = seedLargeTools(sqliteA, a.backendId, await largeToolFixture()); }
      finally { sqliteA.close(); }
      await a.start(); await a.client.call(CHANNELS.bridge.syncNow);
      await waitFor(() => a.client.call<{ pendingRecords: number }>(CHANNELS.bridge.getStatus), (status) => status.pendingRecords === 0, "three uploaded tool records");
      for (const record of expected) await waitFor(() => b.client.call<{ isReplica: boolean } | null>(CHANNELS.runs.getById, record.run_id), (run) => run?.isReplica === true, "replicated run root");
      await a.stop();
      for (const record of expected) await b.client.call(CHANNELS.bridge.watchRun, record.run_id, `large-values-${record.run_id}`);
      await b.client.call(CHANNELS.bridge.syncNow);
      await waitFor(() => b.client.call<{ runs: { runId: string; ready: boolean }[] }>(CHANNELS.bridge.getStatus),
        (status) => expected.every((record) => status.runs.some((run) => run.runId === record.run_id && run.ready)), "three restored run streams");
      const verify = async () => {
        await b.stop();
        const sqliteB = new Database(join(b.dir, "mains.db"));
        try {
          for (const record of expected) {
            const actual = sqliteB.prepare("SELECT * FROM tool_calls WHERE run_id=? AND tool_name=?").get(record.run_id, record.tool_name) as Record<string, unknown> | undefined;
            expect(!!actual).toBe(true);
            for (const [column, value] of Object.entries(record)) if (column !== "id")
              expect(actual?.[column] === value, `exact tool field: ${column}`).toBe(true);
          }
        } finally { sqliteB.close(); }
      };
      await verify();
      await rm(join(b.dir, "bridge", "blobs"), { recursive: true, force: true });
      await b.start(); await verify();
    } finally { await fixture.dispose(); }
  }, 90_000);
});
