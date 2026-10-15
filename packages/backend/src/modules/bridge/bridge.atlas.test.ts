import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { AtlasPage } from "@mains/contracts/atlas";
import type { BridgeUpsertBody } from "@mains/contracts/bridge-protocol";
import { createTestDb } from "../../../test/setup-db";
import { createBridgeTestHub, bridgeTestCodec, bridgeTestRecordKey, closeBridgeTestConnections, disposeBridgeTestHub } from "../../../test/bridge-hub";
import { createBridgeEngine, type BridgeEngineOptions } from "./bridge.engine";

const active = vi.hoisted(() => ({ fixture: null as ReturnType<typeof createTestDb> | null }));
vi.mock("../../db/client", () => ({ getDb: () => active.fixture!.db, getSqlite: () => active.fixture!.sqlite }));
vi.mock("../bridge", () => ({ bridgeService: { resolveFile: vi.fn() } }));
import { atlasService } from "../atlas/atlas.service";

const cleanups: (() => void)[] = [];
afterAll(disposeBridgeTestHub);
afterEach(() => { closeBridgeTestConnections(); for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
type Hub = Awaited<ReturnType<typeof createBridgeTestHub>>;
type Node = Awaited<ReturnType<typeof node>>;
async function node(hub: Hub, id: string, extra: Partial<BridgeEngineOptions> = {}) {
  const fixture = createTestDb(); cleanups.push(fixture.cleanup);
  fixture.sqlite.exec(`INSERT INTO accounts(id) VALUES('default');
    INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default','${id}');`);
  const transport = extra.transport ?? hub.connect(id);
  const engine = createBridgeEngine({ sqlite: fixture.sqlite, backendId: id, recordKey: bridgeTestRecordKey,
    codec: bridgeTestCodec, transport, ...extra });
  await engine.bootstrap(); return { ...fixture, fixture, engine, id };
}
async function on<T>(n: Node, work: (service: typeof atlasService) => T | Promise<T>): Promise<T> {
  active.fixture = n.fixture; return work(atlasService);
}
const identity = (page: AtlasPage) => ({ id: page.item.id, accountId: page.item.accountId });
async function page(n: Node, original: AtlasPage) { return (await on(n, (s) => s.getPage(identity(original))))!; }
async function create(n: Node) { return on(n, (s) => s.createPage({ accountId: "default", title: "Base", markdown: "Base content" })); }
async function save(n: Node, original: AtlasPage, title: string) {
  return on(n, (s) => s.savePage({ ...identity(original), expectedVersion: original.item.version, title, markdown: title }));
}
async function drain(n: Node) {
  for (let i = 0; i < 50 && n.engine.pending().length; i++) await n.engine.push();
  expect(n.engine.pending()).toEqual([]);
}
async function settle(a: Node, b: Node) {
  for (let i = 0; i < 3; i++) { await drain(a); await b.engine.pull(); await drain(b); await a.engine.pull(); }
  expect(a.sqlite.pragma("foreign_key_check")).toEqual([]);
  expect(b.sqlite.pragma("foreign_key_check")).toEqual([]);
}

describe("Atlas editing between independent migrated backends", () => {
  it("backfills existing Atlas Pages when a B5 backend first enables Atlas", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A", { experimentalAtlas: false }), b = await node(hub, "B");
    const original = await create(a);
    expect(a.engine.pending().filter((entry) => entry.table_name.startsWith("atlas_"))).toEqual([]);
    await a.engine.stop();
    a.engine = createBridgeEngine({ sqlite: a.sqlite, backendId: "A", recordKey: bridgeTestRecordKey,
      codec: bridgeTestCodec, transport: hub.connect("A") });
    await a.engine.bootstrap(); await settle(a, b);
    expect((await page(b, original)).revision.id).toBe(original.revision.id);
    expect((await page(b, original)).item.currentRevisionId).toBe(original.revision.id);
  });

  it("parks the new schema on a B5 receiver and applies it after upgrade", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B", { schemaVersion: 1, experimentalAtlas: false });
    const original = await create(a); await drain(a); await b.engine.pull();
    expect(await on(b, (s) => s.get(identity(original)))).toBeNull();
    expect(b.sqlite.prepare("SELECT 1 FROM bridge_parked WHERE reason='schema' LIMIT 1").get()).toBeTruthy();
    await b.engine.stop();
    b.engine = createBridgeEngine({ sqlite: b.sqlite, backendId: "B", recordKey: bridgeTestRecordKey,
      codec: bridgeTestCodec, transport: hub.connect("B") });
    await b.engine.bootstrap(); await settle(a, b);
    expect((await page(b, original)).revision.id).toBe(original.revision.id);
    expect(b.sqlite.prepare("SELECT * FROM bridge_parked").all()).toEqual([]);
  });

  it("enables Atlas normally and transfers lossless blocks, pointers and graph in reverse arrival order", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), remote = hub.connect("B");
    const b = await node(hub, "B", { transport: { push: remote.push, async pull(...args) {
      const result = await remote.pull(...args); return { ...result, records: result.records.map((record, index) => ({ seq: record.seq, envelope: result.records[result.records.length - index - 1].envelope })) };
    } } });
    const base = await create(a), edited = await save(a, base, "Written on A");
    await settle(a, b);
    const received = await page(b, base);
    expect(received.revision.id).toBe(edited.revision.id);
    expect(received.revision.blocks).toEqual(edited.revision.blocks);
    expect(received.revision.parentRevisionId).toBe(base.revision.id);
    expect(received.item.currentRevisionId).toBe(edited.revision.id);
    expect(received.conflicts).toEqual([]);
    expect((b.sqlite.prepare("SELECT count(*) AS n FROM bridge_parked").get() as { n: number }).n).toBe(0);
  });

  it.each(["current", "other"] as const)("keeps both concurrent branches and resolves with %s content everywhere", async (choice) => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    const base = await create(a); await settle(a, b);
    const left = await save(a, await page(a, base), "From A"), right = await save(b, await page(b, base), "From B");
    await settle(a, b);
    const current = await page(a, base), other = current.conflicts![0];
    expect(current.conflicts).toHaveLength(1);
    expect((await page(b, base)).conflicts?.map((r) => r.id)).toEqual([other.id]);
    expect(new Set([current.revision.id, other.id])).toEqual(new Set([left.revision.id, right.revision.id]));
    const result = await on(a, (s) => s.resolveConflict({ ...identity(base), revisionId: other.id, choice, expectedVersion: current.item.version }));
    expect(result.revision.parentRevisionId).toBe(current.revision.id);
    expect(result.revision.mergedRevisionId).toBe(other.id);
    expect(result.item.title).toBe(choice === "current" ? current.item.title : other.title);
    await settle(a, b);
    expect((await page(a, base)).conflicts).toEqual([]); expect((await page(b, base)).conflicts).toEqual([]);
    expect((await page(b, base)).revision.id).toBe(result.revision.id);
    expect(await on(a, (s) => s.revisions(identity(base)))).toHaveLength(4);
    // After merging, both branches remain readable by UUID on either backend.
    expect(await on(b, (s) => s.getRevision({ ...identity(base), revisionId: left.revision.id }))).toMatchObject({ title: "From A" });
    await expect(save(b, base, "Stale editor")).rejects.toThrow(/changed elsewhere/);
  });

  it("does not roll content or optimistic version back when B favourites a stale row", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    const base = await create(a); await settle(a, b);
    const edited = await save(a, base, "New content");
    await on(b, (s) => s.update({ ...identity(base), isFavorite: true }));
    await settle(a, b);
    for (const n of [a, b]) {
      const current = await page(n, base);
      expect(current.revision.id).toBe(edited.revision.id); expect(current.item.isFavorite).toBe(true);
      const version = current.item.version;
      await on(n, (s) => s.update({ ...identity(base), metadata: { icon: "emoji:⭐" } }));
      expect((await page(n, base)).item.version).toBe(version);
    }
  });

  it.each(["pull", "deleted ACK", "full pull"])("recovers unsent revision chains before %s deletes the original", async (path) => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    const base = await create(a); await settle(a, b);
    const first = await save(b, await page(b, base), "Offline first");
    await save(b, first, "Offline second");
    await on(a, async (s) => { await s.update({ ...identity(base), trashed: true }); await s.remove(identity(base)); });
    await drain(a);
    if (path === "deleted ACK") await b.engine.push();
    else if (path === "full pull") await b.engine.fullPull();
    else await b.engine.pull();
    const copies = await on(b, (s) => s.list({ accountId: "default", kind: "page" }));
    expect(copies).toHaveLength(1); expect(copies[0].title).toBe("Offline second (recovered)");
    expect(copies[0].id).not.toBe(base.item.id);
    const history = await on(b, (s) => s.revisions({ id: copies[0].id, accountId: "default" }));
    expect(history).toHaveLength(2); expect(history[0].parentRevisionId).toBe(history[1].id);
    expect(history[1].parentRevisionId).toBeNull();
    expect(history.some((r) => [base.revision.id, first.revision.id].includes(r.id))).toBe(false);
    await settle(b, a);
    for (const n of [a, b]) {
      expect(await on(n, (s) => s.get(identity(base)))).toBeNull();
      expect(await on(n, (s) => s.getPage({ id: copies[0].id, accountId: "default" }))).toMatchObject({ item: { title: "Offline second (recovered)" }, conflicts: [] });
    }
  });

  it("does not create a recovered copy for an acknowledged page or metadata-only changes", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    const base = await create(a); await settle(a, b);
    await on(b, (s) => s.update({ ...identity(base), isFavorite: true }));
    await on(a, async (s) => { await s.update({ ...identity(base), trashed: true }); await s.remove(identity(base)); });
    await settle(a, b);
    expect(await on(b, (s) => s.list({ accountId: "default" }))).toEqual([]);
  });

  it("restores by UUID when the same revisions have different ordinals on A and B", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    const base = await create(a); await settle(a, b);
    const left = await save(a, await page(a, base), "Earlier A branch");
    await save(b, await page(b, base), "Later B branch"); await settle(a, b);
    const aRevision = await on(a, (s) => s.getRevision({ ...identity(base), revisionId: left.revision.id }));
    const bRevision = await on(b, (s) => s.getRevision({ ...identity(base), revisionId: left.revision.id }));
    expect(aRevision.version).not.toBe(bRevision.version);
    const current = await page(b, base);
    const restored = await on(b, (s) => s.restore({ ...identity(base), revisionId: left.revision.id, expectedVersion: current.item.version }));
    expect(restored.revision.id).not.toBe(left.revision.id);
    expect(restored.revision.parentRevisionId).toBe(current.revision.id);
    expect(restored.item.version).toBe(4);
    await settle(a, b);
    expect((await page(a, base)).revision.id).toBe(restored.revision.id);
    expect((await page(a, base)).item.title).toBe("Earlier A branch");
  });

  it("resolves embedded file aliases and cover identities after equal saved files merge", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    const base = await create(a); await settle(a, b);
    for (const [n, id] of [[a, "zz"], [b, "aa"]] as const) n.sqlite.prepare(`INSERT INTO atlas_items
      (id,account_id,kind,title,source_key,content_hash,storage_key) VALUES(?,'default','image','Shared','same-source','same-bytes',?)`).run(id, `${id}/image.png`);
    a.sqlite.prepare("UPDATE atlas_items SET metadata=? WHERE id=?").run(JSON.stringify({ coverFileId: "zz" }), base.item.id);
    await settle(a, b);
    // No byte download is needed to retain an existing authenticated embed.
    b.sqlite.prepare("UPDATE bridge_row_clock SET blob_refs_json=? WHERE table_name='atlas_items' AND register='content'")
      .run(JSON.stringify([{ column: "storage_key", blobId: "a".repeat(43), size: 1, name: "image.png", mime: "image/png" }]));
    const embedded = await on(b, (s) => s.savePage({ ...identity(base), expectedVersion: 1,
      title: "Alias embed", markdown: "![Shared image](atlas-file://zz)" }));
    expect(b.sqlite.prepare("SELECT file_id FROM atlas_page_file_refs WHERE revision_id=?").get(embedded.revision.id)).toEqual({ file_id: "aa" });
    for (const n of [a, b]) {
      expect(await on(n, (s) => s.get({ id: "zz", accountId: "default" }))).toMatchObject({ id: "aa" });
      expect((await page(n, base)).item.metadata?.coverFileId).toBe("aa");
      await on(n, (s) => s.update({ accountId: "default", id: "aa", trashed: true }));
      await expect(on(n, (s) => s.remove({ accountId: "default", id: "aa" }))).rejects.toThrow(/used by a Page/);
    }
  });

  it("rejects rewriting an existing revision identity without changing the graph or pull cursor", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    const base = await create(a); await settle(a, b);
    const logged = (await hub.inspect("account")).find((record) => bridgeTestCodec.open(record.envelope).body.pk === base.revision.id)!;
    const body = bridgeTestCodec.open(logged.envelope).body as BridgeUpsertBody;
    const changed = bridgeTestCodec.seal({ ...logged.envelope.header, origin: "B", hlc: { physicalMs: Date.now() + 10_000, counter: 0 } },
      { ...body, values: { ...body.values, title: "Rewritten history" } });
    await hub.connect("B").push("account", [changed]);
    const before = a.sqlite.prepare("SELECT seq FROM bridge_cursors WHERE stream='account'").get();
    await expect(a.engine.pull()).rejects.toThrow(/immutable/);
    expect(a.sqlite.prepare("SELECT seq FROM bridge_cursors WHERE stream='account'").get()).toEqual(before);
    expect((await page(a, base)).revision.title).toBe("Base");
  });

  it("fences a file delete immediately while retaining its row for a later Page recovery", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    const base = await create(a);
    a.sqlite.exec(`INSERT INTO atlas_items(id,account_id,kind,title,storage_key,content_hash)
      VALUES('image','default','image','Image','image/test.png','same-bytes')`);
    await settle(a, b);
    b.sqlite.prepare("UPDATE bridge_row_clock SET blob_refs_json=? WHERE table_name='atlas_items' AND pk='image' AND register='content'")
      .run(JSON.stringify([{ column: "storage_key", blobId: "a".repeat(43), size: 1, name: "test.png", mime: "image/png" }]));
    await on(b, (s) => s.savePage({ ...identity(base), expectedVersion: 1, title: "Offline embed", markdown: "![Image](atlas-file://image)" }));
    await on(a, async (s) => { await s.update({ id: "image", accountId: "default", trashed: true }); await s.remove({ id: "image", accountId: "default" }); });
    await drain(a); await b.engine.pull();
    expect(b.sqlite.prepare("SELECT 1 FROM bridge_tombstones WHERE table_name='atlas_items' AND pk='image'").get()).toBeTruthy();
    expect(b.sqlite.prepare("SELECT 1 FROM atlas_items WHERE id='image'").get()).toBeTruthy();
    await on(b, (s) => s.update({ id: "image", accountId: "default", title: "Delayed rename" }));
    expect(b.engine.pending().filter((entry) => entry.pk === "image")).toEqual([]);
    await on(a, async (s) => { await s.update({ ...identity(base), trashed: true }); await s.remove(identity(base)); });
    await drain(a); await b.engine.pull();
    const copies = await on(b, (s) => s.list({ accountId: "default", kind: "page" }));
    expect(copies.map((item) => item.title)).toEqual(["Offline embed (recovered)"]);
    expect(b.sqlite.prepare("SELECT 1 FROM atlas_items WHERE id='image'").get()).toBeUndefined();
    const recovered = await on(b, (s) => s.getPage({ id: copies[0].id, accountId: "default" }));
    expect(recovered?.revision.markdown).not.toContain("atlas-file://image");
    await settle(b, a);
  });
});
