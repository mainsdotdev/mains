import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import type { SQLiteInstance } from "../../../packages/backend/src/db/types";
import { claudeSessionFixture } from "../../../packages/backend/test/claude-session-fixture";
import { createClaudeSessionMirror, importClaudeSessionMirror } from "../../../packages/backend/src/modules/bridge/bridge.session-mirror";
import { startLocalBackends, waitFor } from "./local-backends";

describe.skipIf(process.env.MAINS_BRIDGE_HOST_TESTS !== "1")("B9 through two real backend processes", () => {
  it("imports native Claude session files on A and retains exact main/subagent entries on B across restart", async () => {
    const Database = createRequire(new URL("../../../packages/backend/package.json", import.meta.url))("better-sqlite3") as new (file: string) => SQLiteInstance;
    const fixture = await startLocalBackends(), { a, b } = fixture, native = await claudeSessionFixture();
    const runId = randomUUID(), sessionId = native.sessionId;
    try {
      await a.client.call(CHANNELS.runs.create, { id: runId, accountId: "default", providerId: "claude_code", mode: "work", title: "Claude session mirror", status: "succeeded" });
      // Fixture import is the real SDK API; no agent/model request is executed.
      // Stop the host before opening its SQLite, preserving the ownership lock.
      await a.stop(); vi.stubEnv("CLAUDE_CONFIG_DIR", native.configDir);
      const sqliteA = new Database(join(a.dir, "mains.db"));
      try {
        sqliteA.prepare("UPDATE runs SET session_id=? WHERE id=?").run(sessionId, runId);
        const options = { sqlite: sqliteA, backendId: a.backendId, runId, sessionId, dir: native.dir };
        await importClaudeSessionMirror(options); await importClaudeSessionMirror(options);
      } finally { sqliteA.close(); vi.unstubAllEnvs(); }
      await a.start(); await a.client.call(CHANNELS.bridge.syncNow);
      await waitFor(() => b.client.call<{ isReplica: boolean } | null>(CHANNELS.runs.getById, runId), (run) => run?.isReplica === true, "mirrored Claude root");
      await b.client.call(CHANNELS.bridge.watchRun, runId, "session-mirror-acceptance");
      await b.client.call(CHANNELS.bridge.syncNow); await a.stop(); await native.cleanup();
      const verify = async () => {
        await b.stop();
        const sqliteB = new Database(join(b.dir, "mains.db"));
        try {
          const store = createClaudeSessionMirror({ sqlite: sqliteB, backendId: b.backendId, runId, sessionId });
          const key = { projectKey: "computer-b", sessionId };
          expect(await store.load(key)).toEqual(native.main);
          expect(await store.load({ ...key, subpath: "subagents/agent-review" })).toEqual(native.child);
          expect(sqliteB.prepare("SELECT count(*) n FROM provider_session_entries WHERE run_id=?").get(runId)).toEqual({ n: native.main.length + native.child.length });
          await expect(store.append(key, [{ type: "assistant", uuid: randomUUID() }])).rejects.toThrow("owner");
        } finally { sqliteB.close(); }
      };
      await verify(); await b.start(); await verify();
    } finally { vi.unstubAllEnvs(); await native.cleanup(); await fixture.dispose(); }
  }, 60_000);
});
