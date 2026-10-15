import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BRIDGE_BLOB_CHUNK_BYTES, BRIDGE_BLOB_MAX_BYTES } from "@mains/contracts/bridge-blobs";
import { BRIDGE_MAX_RECORD_BYTES } from "@mains/contracts/bridge-wire";
import type { BridgeEnvelope } from "@mains/contracts/bridge-protocol";
import { createTestDb } from "../../../test/setup-db";
import { getLocalBridgeTestWorker, disposeBridgeTestHub, networkMode } from "../../../test/bridge-hub";
import { createBridgeBlobs } from "./bridge.blobs";
import { createBridgeBlobRecords } from "./bridge.blob-records";
import { createBridgeEngine } from "./bridge.engine";
import { createBridgeWebSocketTransport } from "./bridge.websocket";
import { createBridgeSealingCodec } from "./bridge.crypto";
import { deriveBridgeKeys } from "./bridge.keys";
import { createClaudeSessionMirror } from "./bridge.session-mirror";
import { largeToolFixture, seedLargeTools } from "../../../test/large-tool-fixture";

const key = new Uint8Array(32).fill(23);
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
const cleanup: Array<() => void | Promise<void>> = [];
afterAll(disposeBridgeTestHub);
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function files(account: string, backend: string, extra: { cacheLimitBytes?: number; dataDir?: string } = {}) {
  const hub = await getLocalBridgeTestWorker(), dataDir = extra.dataDir ?? await fs.mkdtemp(join(tmpdir(), "mains-bridge-files-"));
  if (!extra.dataDir) cleanup.push(() => fs.rm(dataDir, { recursive: true, force: true }));
  const blobs = createBridgeBlobs({ accountKey: key, dataDir, url: hub.wsUrl, token: () => hub.token(account, backend), ...extra });
  cleanup.push(() => blobs.stop()); return { blobs, dataDir, hub };
}
async function node(account: string, backendId: string, options: { schemaVersion?: number; cacheLimitBytes?: number } = {}) {
  const fixture = createTestDb(); cleanup.push(fixture.cleanup);
  const { sqlite } = fixture;
  sqlite.prepare("INSERT INTO accounts(id) VALUES('default')").run();
  sqlite.prepare("INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default',?)").run(backendId);
  sqlite.prepare("INSERT INTO providers(id,kind,display_name) VALUES('codex','agent_runtime','Codex')").run();
  const { blobs, dataDir, hub } = await files(account, backendId, { cacheLimitBytes: options.cacheLimitBytes });
  const records = createBridgeBlobRecords({ sqlite, backendId, dataDir, blobs });
  const transport = createBridgeWebSocketTransport({ url: hub.wsUrl, token: () => hub.token(account, backendId) }); cleanup.push(() => transport.close());
  const engine = createBridgeEngine({ sqlite, backendId, recordKey: deriveBridgeKeys(key).recordKey, codec: createBridgeSealingCodec(key), transport, blobs: records, experimentalAtlas: true, schemaVersion: options.schemaVersion });
  cleanup.push(() => engine.stop()); await engine.bootstrap();
  return { sqlite, blobs, dataDir, records, engine, transport };
}

describe.skipIf(!networkMode)("Bridge encrypted files through real R2 and two SQLite backends", () => {
  it("restores the complete Read, Read and Grep records byte for byte on B with A offline", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B");
    const records = await largeToolFixture();
    expect(records.map((record) => record.tool_name)).toEqual(["Read", "Read", "Grep"]);
    const expected = seedLargeTools(a.sqlite, "A", records);
    for (const record of expected) b.sqlite.prepare("INSERT OR IGNORE INTO providers(id,kind,display_name) VALUES(?,'agent_runtime','Test provider')").run(record.provider_id);
    await a.engine.push("account"); await b.engine.pull("account");
    for (const record of expected) await a.engine.push(`run:${record.run_id}`);
    expect(a.engine.pending()).toEqual([]);
    a.transport.close(); await a.blobs.stop(); await fs.rm(a.dataDir, { recursive: true, force: true });
    for (const record of expected) {
      await b.engine.pull(`run:${record.run_id}`);
      const actual = b.sqlite.prepare("SELECT * FROM tool_calls WHERE run_id=? AND tool_name=?").get(record.run_id, record.tool_name) as Record<string, unknown>;
      expect(!!actual).toBe(true);
      for (const [column, value] of Object.entries(record)) if (column !== "id") {
        // Boolean equality keeps private document bytes out of assertion reports.
        expect(actual[column] === value, `exact tool field: ${column}`).toBe(true);
      }
    }
    const hub = await getLocalBridgeTestWorker(), wire = await hub.inspect(account) as { envelope: string }[];
    const envelopes = wire.map((record) => JSON.parse(record.envelope) as BridgeEnvelope);
    expect(envelopes.every((envelope) => Buffer.byteLength(JSON.stringify(envelope)) <= BRIDGE_MAX_RECORD_BYTES)).toBe(true);
    const tools = envelopes.map((envelope) => createBridgeSealingCodec(key).open(envelope).body).filter((body) => body.table === "tool_calls");
    expect(tools).toHaveLength(3);
    for (const body of tools) {
      expect("schemaVersion" in body && body.schemaVersion).toBe(4);
      expect("values" in body && body.values.output === null).toBe(true);
    }
  });

  it("automatically restores a large ordinary database field on B with A offline", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B");
    const bio = "Large private field — Türkçe 🙂\n".repeat(60_000);
    a.sqlite.prepare("UPDATE accounts SET bio=? WHERE id='default'").run(bio);
    await a.engine.push("account");
    a.transport.close(); await a.blobs.stop();
    await fs.rm(a.dataDir, { recursive: true, force: true });
    await b.engine.pull("account");
    const actual = b.sqlite.prepare("SELECT bio FROM accounts WHERE id='default'").get() as { bio: string };
    expect(Buffer.from(actual.bio).equals(Buffer.from(bio))).toBe(true);
    const hub = await getLocalBridgeTestWorker(), wire = JSON.stringify(await hub.inspect(account));
    expect(wire).not.toContain("Large private field");
    expect(wire.length).toBeLessThan(20_000);
    expect(a.engine.pending()).toEqual([]);
  });

  it("leaves a newer field edit queued when it changes during upload, then sends the exact newer image", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B");
    const newer = "new captured value".repeat(100_000);
    a.sqlite.prepare("UPDATE accounts SET bio=? WHERE id='default'").run("previous captured value".repeat(100_000));
    const real = globalThis.fetch; let changed = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const response = await real(url, init);
      if (!changed && init?.method === "PUT") { changed = true; a.sqlite.prepare("UPDATE accounts SET bio=? WHERE id='default'").run(newer); }
      return response;
    });
    await a.engine.push("account");
    expect(a.engine.pending().some((entry) => entry.table_name === "accounts")).toBe(true);
    expect((await b.transport.pull("account", 0, 100)).records).toEqual([]);
    vi.restoreAllMocks();
    await a.engine.push("account"); await b.engine.pull();
    expect((b.sqlite.prepare("SELECT bio FROM accounts WHERE id='default'").get() as { bio: string }).bio === newer).toBe(true);
    expect(a.engine.pending()).toEqual([]);
  });

  it("keeps the row and cursor unchanged on corrupt value bytes, then retries successfully", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B");
    const bio = `${randomUUID()} private field`.repeat(30_000);
    a.sqlite.prepare("UPDATE accounts SET bio=? WHERE id='default'").run(bio); await a.engine.push();
    const page = await a.transport.pull("account", 0, 100), body = createBridgeSealingCodec(key).open(page.records[0].envelope).body;
    if (!("blobRefs" in body)) throw new Error("Expected value manifest");
    const ref = body.blobRefs.find((entry) => entry.kind === "value")!;
    const hub = await getLocalBridgeTestWorker(), bucket = await hub.bucket();
    const object = (await bucket.list()).objects.find((entry) => entry.key.includes(ref.blobId))!;
    const original = Buffer.from(await (await bucket.get(object.key))!.arrayBuffer()), damaged = Buffer.from(original); damaged[damaged.length - 1] ^= 1;
    const before = b.sqlite.prepare("SELECT seq FROM bridge_cursors WHERE stream='account'").get();
    await bucket.put(object.key, damaged);
    await expect(b.engine.pull()).rejects.toThrow();
    expect(b.sqlite.prepare("SELECT bio FROM accounts WHERE id='default'").get()).toMatchObject({ bio: null });
    expect(b.sqlite.prepare("SELECT seq FROM bridge_cursors WHERE stream='account'").get()).toEqual(before);
    await bucket.put(object.key, original); await b.engine.pull();
    expect((b.sqlite.prepare("SELECT bio FROM accounts WHERE id='default'").get() as { bio: string }).bio === bio).toBe(true);
  });

  it("parks schema 4 values on an older backend and restores them after upgrading", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B", { schemaVersion: 3 });
    const bio = "waiting for an upgraded backend".repeat(50_000);
    a.sqlite.prepare("UPDATE accounts SET bio=? WHERE id='default'").run(bio); await a.engine.push();
    await b.engine.pull();
    expect(b.sqlite.prepare("SELECT bio FROM accounts WHERE id='default'").get()).toMatchObject({ bio: null });
    expect(b.sqlite.prepare("SELECT reason FROM bridge_parked").get()).toMatchObject({ reason: "schema" });
    await b.engine.stop();
    const upgraded = createBridgeEngine({ sqlite: b.sqlite, backendId: "B", recordKey: deriveBridgeKeys(key).recordKey, codec: createBridgeSealingCodec(key), transport: b.transport, blobs: b.records });
    cleanup.push(() => upgraded.stop()); await upgraded.retryParked();
    expect((b.sqlite.prepare("SELECT bio FROM accounts WHERE id='default'").get() as { bio: string }).bio === bio).toBe(true);
    expect(b.sqlite.prepare("SELECT count(*) n FROM bridge_parked").get()).toMatchObject({ n: 0 });
  });

  it("packs medium records within the frame limit and drains every queued row", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B");
    a.sqlite.exec("INSERT INTO runs(id,owner_backend_id,account_id,provider_id) VALUES('medium','A','default','codex')");
    const input = JSON.stringify("i".repeat(100_000)), output = JSON.stringify("o".repeat(100_000));
    const insert = a.sqlite.prepare("INSERT INTO tool_calls(account_id,run_id,tool_name,input,output) VALUES('default','medium','Search',?,?)");
    a.sqlite.transaction(() => { for (let i = 0; i < 70; i++) insert.run(input, output); })();
    await a.engine.push(); await b.engine.pull();
    for (let i = 0; i < 5 && a.engine.pending().length; i++) await a.engine.push("run:medium");
    expect(a.engine.pending()).toEqual([]);
    await b.engine.pull("run:medium");
    expect(b.sqlite.prepare("SELECT count(*) n FROM tool_calls WHERE run_id='medium'").get()).toMatchObject({ n: 70 });
  }, 30_000);

  it("spills accumulated small fields and returns to inline values when they shrink", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B");
    const value = "x".repeat(100_000);
    a.sqlite.prepare("UPDATE accounts SET bio=?,company=?,website=? WHERE id='default'").run(value, value, value);
    await a.engine.push(); await b.engine.pull();
    const actual = b.sqlite.prepare("SELECT bio,company,website FROM accounts WHERE id='default'").get() as Record<string, string>;
    expect(Object.values(actual).every((field) => field === value)).toBe(true);
    const clock = a.sqlite.prepare("SELECT blob_refs_json FROM bridge_row_clock WHERE table_name='accounts'").get() as { blob_refs_json: string };
    expect(JSON.parse(clock.blob_refs_json).some((ref: { kind?: string }) => ref.kind === "value")).toBe(true);
    a.sqlite.exec("UPDATE accounts SET bio='small',company='small',website='small' WHERE id='default'");
    await a.engine.push(); await b.engine.pull();
    expect(b.sqlite.prepare("SELECT bio,company,website FROM accounts WHERE id='default'").get()).toEqual({ bio: "small", company: "small", website: "small" });
    expect(b.sqlite.prepare("SELECT blob_refs_json FROM bridge_row_clock WHERE table_name='accounts'").get()).toMatchObject({ blob_refs_json: "[]" });
  });

  it("restores a large opaque Claude session entry from R2 on B after A's profile disappears", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B"), sessionId = randomUUID();
    for (const n of [a, b]) n.sqlite.exec("INSERT INTO providers(id,kind,display_name) VALUES('claude_code','agent_runtime','Claude')");
    a.sqlite.prepare("INSERT INTO runs(id,owner_backend_id,account_id,provider_id,session_id) VALUES('r','A','default','claude_code',?)").run(sessionId);
    const entry = { type: "assistant", uuid: randomUUID(), message: { role: "assistant", content: [
      { type: "thinking", thinking: "Private signed thinking", signature: "opaque-signature" },
      { type: "tool_result", content: "private-tool-output-".repeat(100_000) },
    ] } };
    const key = { projectKey: "source-directory", sessionId };
    await createClaudeSessionMirror({ sqlite: a.sqlite, backendId: "A", runId: "r", sessionId }).append(key, [entry]);
    await a.engine.push("account"); await b.engine.pull(); await a.engine.push("run:r"); await b.engine.pull("run:r");
    const row = b.sqlite.prepare("SELECT id,entry FROM provider_session_entries").get() as { id: string; entry: null };
    expect(row.entry).toBeNull();
    const hub = await getLocalBridgeTestWorker(), wire = JSON.stringify(await hub.inspect(account));
    expect(wire).not.toContain("Private signed thinking"); expect(wire.length).toBeLessThan(20_000);
    const payloads = await (await hub.bucket()).list();
    const object = await (await hub.bucket()).get(payloads.objects[0].key);
    expect(Buffer.from(await object!.arrayBuffer()).includes(Buffer.from("private-tool-output"))).toBe(false);
    a.transport.close(); await a.blobs.stop(); await fs.rm(a.dataDir, { recursive: true, force: true });
    const replica = createClaudeSessionMirror({ sqlite: b.sqlite, backendId: "B", runId: "r", sessionId,
      resolveEntry: (id) => b.records.resolve("provider_session_entries", id, "entry") });
    expect(await replica.load({ ...key, projectKey: "different-device" })).toEqual([entry]);
    expect(await replica.load(key)).toEqual([entry]);
  });

  it("lazily opens A's attached image on B, with A disconnected, without reading A's path", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B");
    a.sqlite.exec("INSERT INTO runs(id,owner_backend_id,account_id,provider_id,title) VALUES('r','A','default','codex','Image attachment');");
    const id = "a".repeat(64), directory = join(a.dataDir, "attachments", id); await fs.mkdir(directory, { recursive: true }); await fs.writeFile(join(directory, "private-image.png"), image);
    a.sqlite.prepare("INSERT INTO run_attachments(id,name,type,mime_type,storage_key,byte_size,content_hash) VALUES(?,'private-image.png','image','image/png',?,?,?)")
      .run(id, `attachments/${id}/private-image.png`, image.length, createHash("sha256").update(image).digest("hex"));
    a.sqlite.prepare("INSERT INTO run_attachment_refs(run_id,attachment_id,input_key,ordinal) VALUES('r',?,'prompt',0)").run(id);
    await a.engine.push("account"); await b.engine.pull("account"); await a.engine.push("run:r"); await b.engine.pull("run:r");
    expect(await fs.readdir(join(b.dataDir, "bridge")).catch(() => [])).toEqual([]); // Metadata does not eagerly download.
    a.transport.close(); await fs.rm(join(a.dataDir, "attachments"), { recursive: true });
    const opened = await b.records.resolve("run_attachments", id, "storage_key");
    expect(opened.startsWith(join(b.dataDir, "bridge", "blobs"))).toBe(true); expect(await fs.readFile(opened)).toEqual(image);
    expect((await fs.readFile(opened)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(b.engine.pending().some((entry) => entry.table_name.startsWith("run_"))).toBe(false); expect(b.sqlite.pragma("foreign_key_check")).toEqual([]);
    b.sqlite.prepare("DELETE FROM run_attachment_refs WHERE attachment_id=?").run(id);
    b.sqlite.prepare("DELETE FROM run_attachments WHERE id=?").run(id);
    await expect(b.records.resolve("run_attachments", id)).rejects.toThrow(/no longer exists/);
  });

  it("externalizes inline image bytes, remaps integer ids and retains the manifest across full rebuilds", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B");
    for (const [owner, n] of [["A", a], ["B", b]] as const) {
      n.sqlite.prepare("INSERT INTO runs(id,owner_backend_id,account_id,provider_id,title) VALUES(?,?,'default','codex','Images')").run(owner, owner);
      n.sqlite.prepare("INSERT INTO run_artifacts(run_id,kind,content) VALUES(?,'report','First artifact')").run(owner);
    }
    const result = a.sqlite.prepare("INSERT INTO run_artifacts(run_id,kind,blob_data,metadata) VALUES('A','image',?,?)").run(image, JSON.stringify({ fileName: "image.png", mimeType: "image/png" }));
    b.sqlite.exec("INSERT INTO run_artifacts(run_id,kind,content) VALUES('B','report','collision')");
    await a.engine.push("account"); await b.engine.pull("account"); await a.engine.push("run:A"); await b.engine.pull("run:A");
    const local = b.sqlite.prepare("SELECT id,blob_data FROM run_artifacts WHERE run_id='A' AND kind='image'").get() as { id: number; blob_data: unknown };
    expect(local.id).not.toBe(Number(result.lastInsertRowid)); expect(local.blob_data).toBeNull();
    await b.engine.fullPull("run:A");
    expect(await fs.readFile(await b.records.resolve("run_artifacts", local.id))).toEqual(image);
    const stored = JSON.stringify(await (await getLocalBridgeTestWorker()).inspect(account));
    expect(stored).not.toContain("image.png"); expect(stored).not.toContain(image.toString("base64"));
  });

  it("resumes interrupted multi-chunk uploads and downloads, and stores only ciphertext in R2", async () => {
    const account = randomUUID(), a = await files(account, "A"), b = await files(account, "B");
    const bytes = Buffer.alloc(BRIDGE_BLOB_CHUNK_BYTES + 153, 91); bytes.write("private-file-sentinel");
    const real = globalThis.fetch; let puts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (init?.method === "PUT" && ++puts === 2) throw new Error("upload interrupted"); return real(url, init);
    });
    const description = { column: "path", name: "secret-name.bin", mime: null };
    await expect(a.blobs.publish(bytes, description)).rejects.toThrow("interrupted"); vi.restoreAllMocks();
    let resumedPuts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => { if (init?.method === "PUT") resumedPuts++; return real(url, init); });
    const ref = await a.blobs.publish(bytes, description); expect(resumedPuts).toBe(1); vi.restoreAllMocks();
    const bucket = await a.hub.bucket(), entries = (await bucket.list()).objects;
    const chunks = entries.filter((entry) => entry.key.includes(ref.blobId)); expect(chunks).toHaveLength(2);
    const sealed = Buffer.from(await (await bucket.get(chunks[0].key))!.arrayBuffer()); expect(sealed.includes(Buffer.from("private-file-sentinel"))).toBe(false); expect(chunks[0].key).not.toContain(description.name);
    let gets = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).includes("/chunk?") && !init?.method && ++gets === 2) throw new Error("download interrupted"); return real(url, init);
    });
    await expect(b.blobs.resolve(ref)).rejects.toThrow("interrupted"); vi.restoreAllMocks();
    let resumedGets = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => { if (String(url).includes("/chunk?") && !init?.method) resumedGets++; return real(url, init); });
    expect(await fs.readFile(await b.blobs.resolve(ref))).toEqual(bytes); expect(resumedGets).toBe(1); vi.restoreAllMocks();
    const restarted = await files(account, "B", { dataDir: b.dataDir });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    expect(await fs.readFile(await restarted.blobs.resolve(ref))).toEqual(bytes);
  });
  it("freezes selected turn outputs before the original changes and releases the upload snapshot after ACK", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B");
    a.sqlite.exec("INSERT INTO runs(id,owner_backend_id,account_id,provider_id,title) VALUES('output','A','default','codex','Output');");
    const source = join(a.dataDir, "turn-image.png"); await fs.writeFile(source, image);
    const ref = await a.records.captureOutput(source, [a.dataDir], "image/png"); expect(ref).toBeDefined();
    await fs.writeFile(source, Buffer.from("a later turn overwrote the original"));
    a.sqlite.prepare("INSERT INTO run_artifacts(run_id,kind,content,metadata) VALUES('output','report','Selected image',?)")
      .run(JSON.stringify({ turnIndex: 0, bridgeOutputs: [{ path: source, kind: "image", metadata: { outputSelected: true, fileName: "turn-image.png" }, blobRef: ref }] }));
    await a.engine.push("account"); await b.engine.pull("account"); await a.engine.push("run:output"); await b.engine.pull("run:output");
    const artifact = b.sqlite.prepare("SELECT id FROM run_artifacts WHERE run_id='output'").get() as { id: number };
    expect(await fs.readFile(await b.records.resolve("run_artifacts", artifact.id, "metadata", source))).toEqual(image);
    expect(await fs.readdir(join(a.dataDir, "bridge", "uploads"))).toEqual([]);
  });

  it("does not bind an uploaded file to a newer local generation captured during upload", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B");
    a.sqlite.exec("INSERT INTO runs(id,owner_backend_id,account_id,provider_id,title) VALUES('changing','A','default','codex','Changing');");
    const inserted = a.sqlite.prepare("INSERT INTO run_artifacts(run_id,kind,blob_data,metadata) VALUES('changing','image',?,?)").run(image, JSON.stringify({ fileName: "image.png" }));
    await a.engine.push("account"); await b.engine.pull("account");
    const newer = Buffer.concat([image, Buffer.from("new-version")]), real = globalThis.fetch; let changed = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const response = await real(url, init);
      if (!changed && init?.method === "PUT") { changed = true; a.sqlite.prepare("UPDATE run_artifacts SET blob_data=? WHERE id=?").run(newer, inserted.lastInsertRowid); }
      return response;
    });
    await a.engine.push("run:changing"); expect(a.engine.pending().some((entry) => entry.table_name === "run_artifacts")).toBe(true);
    expect((await b.transport.pull("run:changing", 0, 100)).records).toEqual([]); vi.restoreAllMocks();
    await a.engine.push("run:changing"); await b.engine.pull("run:changing");
    const row = b.sqlite.prepare("SELECT id FROM run_artifacts WHERE run_id='changing'").get() as { id: number };
    expect(await fs.readFile(await b.records.resolve("run_artifacts", row.id))).toEqual(newer);
  });

  it("transfers collection and gated Atlas files, retaining their blobs through metadata edits on B", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B");
    a.sqlite.exec("INSERT INTO collections(id,account_id,name) VALUES('c','default','Files');");
    const hash = createHash("sha256").update(image).digest("hex"), key = "collections/c/sources/source/content.png";
    await fs.mkdir(join(a.dataDir, "collections/c/sources/source"), { recursive: true }); await fs.writeFile(join(a.dataDir, key), image);
    a.sqlite.prepare("INSERT INTO collection_sources(id,collection_id,kind,name,mime_type,byte_size,content_hash,storage_key) VALUES('source','c','file','image.png','image/png',?,?,?)").run(image.length, hash, key);
    await fs.mkdir(join(a.dataDir, "atlas/files/atlas-image"), { recursive: true }); await fs.writeFile(join(a.dataDir, "atlas/files/atlas-image/image.png"), image);
    a.sqlite.prepare("INSERT INTO atlas_items(id,account_id,kind,title,file_name,storage_key,mime_type,byte_size,content_hash) VALUES('atlas-image','default','image','Image','image.png','atlas-image/image.png','image/png',?,?)").run(image.length, hash);
    await a.engine.push("account"); await b.engine.pull("account");
    expect(await fs.readFile(await b.records.resolve("collection_sources", "source"))).toEqual(image);
    expect(await fs.readFile(await b.records.resolve("atlas_items", "atlas-image"))).toEqual(image);
    b.sqlite.exec("UPDATE atlas_items SET title='Renamed on B' WHERE id='atlas-image'");
    await b.engine.push("account"); await a.engine.pull("account");
    expect(await fs.readFile(await a.records.resolve("atlas_items", "atlas-image"))).toEqual(image);
    expect(a.sqlite.prepare("SELECT title FROM atlas_items WHERE id='atlas-image'").get()).toMatchObject({ title: "Renamed on B" });
    b.sqlite.exec("UPDATE bridge_row_clock SET blob_refs_json=NULL WHERE table_name='atlas_items' AND pk='atlas-image'; UPDATE atlas_items SET title='Newer local metadata' WHERE id='atlas-image'");
    const newerClock = b.sqlite.prepare("SELECT physical_ms,counter FROM bridge_row_clock WHERE table_name='atlas_items' AND pk='atlas-image' AND register='content'").get();
    await b.engine.fullPull();
    expect(b.sqlite.prepare("SELECT title FROM atlas_items WHERE id='atlas-image'").get()).toMatchObject({ title: "Newer local metadata" });
    expect(b.sqlite.prepare("SELECT physical_ms,counter FROM bridge_row_clock WHERE table_name='atlas_items' AND pk='atlas-image' AND register='content'").get()).toEqual(newerClock);
    expect(await fs.readFile(await b.records.resolve("atlas_items", "atlas-image"))).toEqual(image);
    // Logout must preserve opened shared files as ordinary local files, including
    // collection context, without traversing a substituted storage directory.
    const diverted = join(b.dataDir, "diverted"); await fs.mkdir(diverted);
    await fs.symlink(diverted, join(b.dataDir, "collections"));
    await expect(b.records.preserveAccountFiles()).rejects.toThrow(/Unsafe shared file storage directory/);
    expect(await fs.readdir(diverted)).toEqual([]);
    await fs.unlink(join(b.dataDir, "collections"));
    await b.records.preserveAccountFiles(); await b.blobs.stop();
    await fs.rm(join(b.dataDir, "bridge", "blobs"), { recursive: true, force: true });
    expect(await fs.readFile(join(b.dataDir, key))).toEqual(image);
    expect(await fs.readFile(join(b.dataDir, "atlas/files/atlas-image/image.png"))).toEqual(image);
  });

  it("upgrades B4's acknowledged file rows with new clocks so existing replicas receive their manifests", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B");
    a.sqlite.exec("INSERT INTO runs(id,owner_backend_id,account_id,provider_id,title) VALUES('legacy','A','default','codex','Legacy');");
    a.sqlite.prepare("INSERT INTO run_artifacts(run_id,kind,blob_data,metadata) VALUES('legacy','image',?,?)").run(image, JSON.stringify({ fileName: "legacy.png" }));
    await a.engine.push("account"); await b.engine.pull("account"); await a.engine.push("run:legacy"); await b.engine.pull("run:legacy");
    const before = a.sqlite.prepare("SELECT physical_ms,counter FROM bridge_row_clock WHERE table_name='run_artifacts'").get();
    a.sqlite.exec("UPDATE bridge_row_clock SET blob_refs_json=NULL WHERE table_name='run_artifacts'; UPDATE bridge_config SET backfill_done=0,backfill_table=NULL,backfill_pk=NULL;");
    b.sqlite.exec("UPDATE bridge_row_clock SET blob_refs_json='[]' WHERE table_name='run_artifacts'");
    await a.engine.backfill();
    expect(a.sqlite.prepare("SELECT physical_ms,counter FROM bridge_row_clock WHERE table_name='run_artifacts'").get()).not.toEqual(before);
    await a.engine.push("run:legacy"); await b.engine.pull("run:legacy");
    const row = b.sqlite.prepare("SELECT id FROM run_artifacts WHERE run_id='legacy'").get() as { id: number };
    expect(await fs.readFile(await b.records.resolve("run_artifacts", row.id))).toEqual(image);
  });
  it("limits artifact snapshots to this run's roots and never uploads configuration paths or symlink escapes", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B");
    a.sqlite.exec("INSERT INTO runs(id,owner_backend_id,account_id,provider_id,title,mode) VALUES('safe-run','A','default','codex','Safe files','work');");
    const root = join(a.dataDir, "runs", "safe-run", "work"); await fs.mkdir(root, { recursive: true });
    const secret = join(a.dataDir, "private-config.png"); await fs.writeFile(secret, image);
    const selected = join(root, "selected.png"); await fs.writeFile(selected, image);
    const linked = join(root, "linked.png"); await fs.symlink(secret, linked);
    for (const file of [secret, linked, selected]) a.sqlite.prepare("INSERT INTO run_artifacts(run_id,kind,path,metadata) VALUES('safe-run','image',?,?)").run(file, JSON.stringify({ path: file, fileName: file.split("/").pop() }));
    await a.engine.push("account"); await b.engine.pull("account"); await a.engine.push("run:safe-run"); await b.engine.pull("run:safe-run");
    const rows = b.sqlite.prepare("SELECT id,metadata FROM run_artifacts WHERE run_id='safe-run' ORDER BY id").all() as { id: number; metadata: string }[];
    await expect(b.records.resolve("run_artifacts", rows[0].id)).rejects.toThrow(/source device/);
    await expect(b.records.resolve("run_artifacts", rows[1].id)).rejects.toThrow(/source device/);
    const opened = await b.records.resolve("run_artifacts", rows[2].id);
    expect(await fs.readFile(opened)).toEqual(image); expect(await b.blobs.isCachedFile(await fs.realpath(opened))).toBe(true);
    expect(await b.blobs.isCachedFile(secret)).toBe(false);
  });

  it("rejects corrupted chunks, repairs a damaged cache, and cannot download another account's blobs", async () => {
    const account = randomUUID(), a = await files(account, "A"), b = await files(account, "B"), other = await files(randomUUID(), "C");
    const ref = await a.blobs.publish(image, { column: "storage_key", name: "image.png", mime: "image/png" });
    await expect(other.blobs.resolve(ref)).rejects.toThrow(/unavailable.*404/);
    const target = await b.blobs.resolve(ref); await fs.chmod(target, 0o600); await fs.writeFile(target, Buffer.alloc(image.length));
    expect(await fs.readFile(await b.blobs.resolve(ref))).toEqual(image);
    const prefix = createHash("sha256").update(account).digest("hex");
    const bucket = await a.hub.bucket(), entry = (await bucket.list()).objects.find((entry) => entry.key.startsWith(prefix) && entry.key.includes(ref.blobId))!;
    await bucket.put(entry.key, Buffer.alloc(image.length + 40));
    const fresh = await files(account, "D"); await expect(fresh.blobs.resolve(ref)).rejects.toThrow();
    expect((await fs.readdir(join(fresh.dataDir, "bridge", "blobs"))).some((name) => name.endsWith(".png"))).toBe(false);
  });

  it("enforces an LRU cache cap and rejects oversized files before upload", async () => {
    const account = randomUUID(), a = await files(account, "A", { cacheLimitBytes: image.length + 1 });
    await a.blobs.publish(image, { column: "path", name: "first.png", mime: "image/png" });
    await a.blobs.publish(Buffer.alloc(image.length, 8), { column: "path", name: "second.png", mime: "image/png" });
    expect((await fs.readdir(join(a.dataDir, "bridge", "blobs"))).filter((name) => !name.startsWith("."))).toHaveLength(1);
    await expect(a.blobs.publish(Buffer.alloc(BRIDGE_BLOB_MAX_BYTES + 1), { column: "path", name: "large.bin", mime: null })).rejects.toThrow(/50 MiB/);
  });
});
