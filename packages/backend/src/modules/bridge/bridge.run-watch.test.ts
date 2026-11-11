import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createBridgeReplicator } from "./bridge.replicator";

let database: ReturnType<typeof createTestDb>, replicator: ReturnType<typeof createBridgeReplicator>;
beforeEach(() => {
  database = createTestDb();
  database.sqlite.exec(`INSERT INTO accounts(id) VALUES('default');
    INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default','A');
    INSERT INTO providers(id,kind,display_name) VALUES('claude_code','agent_runtime','Claude');
    INSERT INTO runs(id,account_id,owner_backend_id,provider_id,title,status) VALUES
      ('remote','default','B','claude_code','Remote','succeeded'),
      ('local','default','A','claude_code','Local','succeeded')`);
  replicator = createBridgeReplicator({ sqlite: database.sqlite, backendId: "A", autoStart: false,
    config: { url: "ws://127.0.0.1:1/v1/log", token: "test-only", backendId: "A", accountId: "test-account", label: "Test",
      accountKey: new Uint8Array(32).fill(21), signingPrivateKey: new Uint8Array(32).fill(22) } });
});
afterEach(async () => { await replicator.stop(); database.cleanup(); vi.useRealTimers(); });

describe("Bridge remote run watch ownership", () => {
  it("retains a shared stream until the last independently renewed view expires", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    replicator.watchRun("remote", "first");
    vi.setSystemTime(Date.now() + 60_000); replicator.watchRun("remote", "second");
    vi.setSystemTime(Date.now() + 30_000);
    expect(replicator.getStatus().runs.map((run) => run.runId)).toEqual(["remote"]);
    replicator.unwatchRun("first");
    expect(replicator.getStatus().runs).toHaveLength(1);
    vi.setSystemTime(Date.now() + 60_000);
    expect(replicator.getStatus().runs).toEqual([]);
  });

  it("can replace the sole view of a stream at the stream limit", () => {
    const insert = database.sqlite.prepare("INSERT INTO runs(id,account_id,owner_backend_id,provider_id,title,status) VALUES(?,'default','B','claude_code','Remote','succeeded')");
    for (let i = 0; i < 128; i++) insert.run(`remote-${i}`);
    for (let i = 0; i < 127; i++) replicator.watchRun(`remote-${i}`, `view-${i}`);
    expect(() => replicator.watchRun("remote-127", "view-0")).not.toThrow();
    const ids = replicator.getStatus().runs.map((run) => run.runId);
    expect(ids).toHaveLength(127); expect(ids).toContain("remote-127"); expect(ids).not.toContain("remote-0");
    expect(() => replicator.watchRun("remote-0", "extra")).toThrow("Too many open Bridge streams");
  });

  it("releases the previous remote stream when the same view switches to a local run", () => {
    replicator.watchRun("remote", "view");
    replicator.watchRun("local", "view");
    expect(replicator.getStatus().runs).toEqual([]);
  });

  it("removes expired views from status without needing a sync or another watch", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    replicator.watchRun("remote", "view");
    expect(replicator.getStatus().runs).toEqual([{ runId: "remote", ready: false, error: null }]);
    vi.setSystemTime(Date.now() + 90_000);
    expect(replicator.getStatus().runs).toEqual([]);
  });
});
