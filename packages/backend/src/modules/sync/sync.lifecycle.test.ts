import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createAccount, createConnection } from "../../../test/factories";
import { installTestBackendRuntime } from "../../../test/backend-runtime";
import type { DatabaseInstance } from "../../db/types";
import { connectionResources, connections, entities, syncCursors } from "../../db/schema";
import type { ResourceFetcher } from "./sync.dto";
let db: DatabaseInstance, cleanup: () => void, restore: () => void;
vi.mock("../../db/client", () => ({ getDb: () => db }));
const fetchers: ResourceFetcher[] = [];
vi.mock("./connections", () => ({ get RESOURCE_FETCHERS() { return fetchers; } }));
import { syncService } from "./sync.service";
import { connectionsService } from "../connections";
import { fetchAllEntities } from "./sync.fetchers";
import { openSourceSync, shutdownSourceSync } from "./sync-lifecycle";
import { openConnectionLifecycle, shutdownConnectionLifecycle } from "../connections/connection-lifecycle";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const item = { kind: "issue" as const, title: "Fetched", url: "https://example.com/issue/1", body: null, summary: null, occurredAt: "2026-01-01T00:00:00Z", connectionId: "connection", resourceId: "resource", metadata: { provider: "github" } };
beforeEach(async () => {
  openSourceSync(); openConnectionLifecycle();
  ({ db, cleanup } = createTestDb()); restore = installTestBackendRuntime();
  createAccount(db, { id: "default" });
  createConnection(db, { id: "connection", provider: "github", status: "active" });
  await connectionsService.saveCredentials({ provider: "github", connectionId: "connection", token: "test-token" });
  db.insert(connectionResources).values({ id: "resource", connectionId: "connection", externalId: "repo", kind: "github_repo", selected: true }).run();
  fetchers.push({ id: "github:issues", provider: "github", resourceKind: "github_repo", defaultLimit: 10, incremental: true, fetchForResource: vi.fn().mockResolvedValue([item]) });
});
afterEach(async () => { await Promise.all([shutdownSourceSync(), shutdownConnectionLifecycle()]); fetchers.length = 0; vi.restoreAllMocks(); restore(); cleanup(); });

it("discards a fetch completed after access was revoked", async () => {
  const gate = deferred<typeof item[]>(), entered = deferred<void>();
  fetchers[0].fetchForResource = async () => { entered.resolve(); return gate.promise; };
  const sync = syncService.runEntitySync("github"); await entered.promise;
  await connectionsService.revoke("github"); gate.resolve([item]); await sync;
  expect(db.select().from(entities).all()).toEqual([]);
  expect(db.select().from(syncCursors).all()).toEqual([]);
});
it("rolls back entities if the cursor checkpoint cannot be stored", async () => {
  db.run(sql`CREATE TRIGGER fail_cursor BEFORE INSERT ON sync_cursors BEGIN SELECT RAISE(ABORT, 'Cursor unavailable'); END`);
  await expect(syncService.runEntitySync("github")).rejects.toThrow();
  expect(db.select().from(entities).all()).toEqual([]);
  expect(db.select().from(syncCursors).all()).toEqual([]);
});
it("does not leave a partial entity or advance the cursor if its issue write fails", async () => {
  db.run(sql`CREATE TRIGGER fail_issue BEFORE INSERT ON issues BEGIN SELECT RAISE(ABORT, 'Issue unavailable'); END`);
  const result = await syncService.runEntitySync("github");
  expect(result.errors).toBe(1);
  expect(db.select().from(entities).all()).toEqual([]);
  expect(db.select().from(syncCursors).all()).toEqual([]);
});
it("joins identical overlapping syncs through persistence", async () => {
  const gate = deferred<typeof item[]>(), entered = deferred<void>();
  const fetch = vi.fn(async () => { entered.resolve(); return gate.promise; }); fetchers[0].fetchForResource = fetch;
  const first = syncService.runEntitySync("github"); await entered.promise;
  const second = syncService.runEntitySync("github"); gate.resolve([item]);
  const results = await Promise.all([first, second]);
  expect(fetch).toHaveBeenCalledTimes(1); expect(results[0]).toEqual(results[1]);
});
it("rejects an unknown provider without falling back to every integration", async () => {
  await expect(syncService.runEntitySync("githbu")).rejects.toThrow(/provider/i);
  expect(fetchers[0].fetchForResource).not.toHaveBeenCalled();
});
it("does not turn an invalid resource record into a global fetch", async () => {
  const select = db.select.bind(db);
  vi.spyOn(db, "select").mockImplementation((() => {
    const query = select(), from = query.from.bind(query);
    vi.spyOn(query, "from").mockImplementation((table: any) => { if (table === connectionResources) throw new Error("Resource read failed"); return from(table); });
    return query;
  }) as typeof db.select);
  const global = vi.fn().mockResolvedValue([item]); fetchers[0].fetchAll = global;
  await fetchAllEntities("github"); expect(global).not.toHaveBeenCalled();
});

it("persists a complete batch and its incremental checkpoint", async () => {
  const result = await syncService.runEntitySync("github");
  expect(result).toMatchObject({ inserted: 1, errors: 0, total: 1 });
  expect(db.select().from(entities).all()).toHaveLength(1);
  expect(db.select().from(syncCursors).all()).toHaveLength(1);
});
it.each(["rotation", "resource removal", "external revocation"])("retires an old fetch after %s", async (action) => {
  const gate = deferred<typeof item[]>(), entered = deferred<void>();
  fetchers[0].fetchForResource = async () => { entered.resolve(); return gate.promise; };
  const run = syncService.runEntitySync("github"); await entered.promise;
  if (action === "rotation") await connectionsService.saveCredentials({ provider: "github", connectionId: "connection", token: "new-token" });
  else if (action === "resource removal") await connectionsService.deleteResource("resource");
  else db.update(connections).set({ status: "revoked" }).where(eq(connections.id, "connection")).run();
  gate.resolve([item]); await run;
  expect(db.select().from(entities).all()).toEqual([]);
  expect(db.select().from(syncCursors).all()).toEqual([]);
});
it("fences admission during shutdown and drains old fetches before reopening", async () => {
  const gate = deferred<typeof item[]>(), entered = deferred<void>();
  fetchers[0].fetchForResource = async () => { entered.resolve(); return gate.promise; };
  const run = syncService.runEntitySync("github"); await entered.promise;
  let closed = false;
  const stop = Promise.all([shutdownSourceSync(), shutdownConnectionLifecycle()]).then(() => { closed = true; });
  await expect(syncService.runEntitySync("github")).rejects.toThrow("shutting down");
  await Promise.resolve(); expect(closed).toBe(false);
  gate.resolve([item]); await run; await stop;
  expect(db.select().from(entities).all()).toEqual([]);
  openConnectionLifecycle(); openSourceSync();
  expect((await syncService.runEntitySync("github")).inserted).toBe(1);
});
it("keeps a new sync requested after credential rotation instead of joining the retired fetch", async () => {
  const gate = deferred<typeof item[]>(), entered = deferred<void>();
  const fetch = vi.fn().mockImplementationOnce(async () => { entered.resolve(); return gate.promise; }).mockResolvedValue([item]);
  fetchers[0].fetchForResource = fetch;
  const old = syncService.runEntitySync("github"); await entered.promise;
  await connectionsService.saveCredentials({ provider: "github", connectionId: "connection", token: "replacement-token" });
  const replacement = syncService.runEntitySync("github");
  gate.resolve([item]); await old;
  expect((await replacement).inserted).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("rechecks early fetcher results while a later fetcher is still pending", async () => {
  const gate = deferred<typeof item[]>(), entered = deferred<void>();
  fetchers.push({ ...fetchers[0], id: "github:later", fetchForResource: async () => { entered.resolve(); return gate.promise; } });
  const read = fetchAllEntities("github"); await entered.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  await connectionsService.revoke("github"); gate.resolve([item]);
  expect(await read).toEqual([]);
});
