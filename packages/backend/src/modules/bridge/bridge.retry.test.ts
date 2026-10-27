import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../../../test/setup-db";
import { createMemoryBridgeHub } from "./bridge.transport";
import { createBridgeEngine } from "./bridge.engine";
import { createBridgeBlobs } from "./bridge.blobs";
import { createBridgeBlobRecords } from "./bridge.blob-records";

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });
async function fixture() {
  const db = createTestDb(); cleanups.push(db.cleanup);
  const dataDir = await mkdtemp(join(tmpdir(), "mains-bridge-retry-"));
  cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
  const sqlite = db.sqlite, hub = createMemoryBridgeHub();
  sqlite.exec("INSERT INTO accounts(id) VALUES('default'); INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default','A')");
  const blobs = createBridgeBlobs({ accountKey: new Uint8Array(32).fill(1), dataDir, url: "http://localhost", token: "test" });
  cleanups.push(() => blobs.stop());
  // Keep real snapshot/hash/manifest preparation; this suite only replaces the remote object store.
  vi.spyOn(blobs, "publish").mockImplementation((bytes, description) => blobs.capture(bytes, description));
  const records = createBridgeBlobRecords({ sqlite, backendId: "A", dataDir, blobs });
  const transport = hub.connect("A"), engine = createBridgeEngine({ sqlite, backendId: "A", recordKey: new Uint8Array(32).fill(1), transport, blobs: records });
  cleanups.push(() => engine.stop()); await engine.bootstrap(); await engine.push();
  const bytes = Buffer.from("original");
  async function corruptFile(id: string) {
    await mkdir(join(dataDir, "atlas", "files", id), { recursive: true });
    const file = join(dataDir, "atlas", "files", id, "file.txt"); await writeFile(file, "damaged");
    sqlite.prepare("INSERT INTO atlas_items(id,account_id,kind,title,storage_key,content_hash) VALUES(?,'default','file',?,?,?)")
      .run(id, id, `${id}/file.txt`, createHash("sha256").update(bytes).digest("hex"));
    return file;
  }
  return { sqlite, hub, transport, dataDir, engine, records, corruptFile, bytes };
}

describe("Bridge outgoing record isolation", () => {
  it("publishes healthy records beside a damaged file and retries the original generation after repair", async () => {
    const { sqlite, engine, records, corruptFile, bytes } = await fixture();
    const file = await corruptFile("broken");
    sqlite.exec("INSERT INTO collections(id,account_id,name) VALUES('healthy','default','Healthy')");
    const prepare = vi.spyOn(records, "prepare"), now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now);
    await expect(engine.push()).resolves.toBeGreaterThan(0);
    expect(engine.pending()).toEqual([expect.objectContaining({ pk: "broken", register: "content" })]);
    const attempted = prepare.mock.calls.filter(([, entry]) => entry.pk === "broken" && entry.register === "content").length;
    await engine.push();
    expect(prepare.mock.calls.filter(([, entry]) => entry.pk === "broken" && entry.register === "content")).toHaveLength(attempted);
    await writeFile(file, bytes); clock.mockReturnValue(now + 61_000);
    await engine.push(); expect(engine.pending()).toEqual([]);
    expect(sqlite.prepare("SELECT synced_seq FROM bridge_row_clock WHERE table_name='atlas_items' AND pk='broken' AND register='content'").get())
      .toEqual({ synced_seq: expect.any(Number) });
  });

  it("reaches records beyond a batch full of failed preparations and lets a new generation retry immediately", async () => {
    const { sqlite, engine, corruptFile } = await fixture();
    for (let i = 0; i < 3; i++) await corruptFile(`broken-${i}`);
    sqlite.exec("INSERT INTO collections(id,account_id,name) VALUES('later','default','Later')");
    for (let i = 0; i < 10; i++) await engine.push("account", 1);
    expect(engine.pending().map((entry) => entry.pk)).not.toContain("later");
    expect(engine.pending()).toHaveLength(3);
    sqlite.exec("UPDATE atlas_items SET storage_key=NULL WHERE id='broken-0'");
    await engine.push();
    expect(engine.pending().map((entry) => entry.pk)).not.toContain("broken-0");
  });
  it("retains retry state across engine restart and lets a deletion supersede the blocked content", async () => {
    const { sqlite, engine, transport, records, corruptFile } = await fixture();
    await corruptFile("broken"); await engine.push();
    expect(engine.blocked()).toMatchObject({ total: 1, records: [expect.objectContaining({ pk: "broken", attempts: 1 })] });
    await engine.stop();
    const restarted = createBridgeEngine({ sqlite, backendId: "A", recordKey: new Uint8Array(32).fill(1), transport, blobs: records });
    cleanups.push(() => restarted.stop());
    expect(restarted.blocked()).toEqual(engine.blocked());
    const prepare = vi.spyOn(records, "prepare"); await restarted.push(); expect(prepare).not.toHaveBeenCalled();
    sqlite.exec("DELETE FROM atlas_items WHERE id='broken'");
    await restarted.push(); expect(restarted.pending()).toEqual([]); expect(restarted.blocked().total).toBe(0);
  });
  it("keeps processing healthy ACKs when an expired file can no longer be republished", async () => {
    const { sqlite, engine, records, transport, corruptFile, bytes } = await fixture();
    const file = await corruptFile("orphan"); await writeFile(file, bytes);
    sqlite.exec("INSERT INTO collections(id,account_id,name) VALUES('healthy','default','Healthy')");
    const push = transport.push;
    vi.spyOn(transport, "push").mockImplementation(async (stream, envelopes) => {
      const results = await push(stream, envelopes);
      return results.map((result, index) => envelopes[index].header.blobs?.length ? { error: "blobMissing" as const } : result);
    });
    vi.spyOn(records, "republish").mockRejectedValue(new Error("Bridge file is unavailable locally"));
    await expect(engine.push()).resolves.toBeGreaterThan(0);
    expect(engine.pending()).toEqual([expect.objectContaining({ pk: "orphan", register: "content" })]);
    expect(engine.blocked().records).toContainEqual(expect.objectContaining({ pk: "orphan", error: expect.stringMatching(/unavailable/) }));
  });
  it("retains an attachment reference until its separately published file metadata is acknowledged", async () => {
    const { sqlite, engine, records, transport, dataDir, bytes } = await fixture();
    sqlite.exec("INSERT INTO providers(id,kind,display_name) VALUES('codex','agent_runtime','Codex'); INSERT INTO runs(id,account_id,owner_backend_id,provider_id) VALUES('r','default','A','codex')");
    await engine.push();
    const id = createHash("sha256").update(bytes).digest("hex");
    await mkdir(join(dataDir, "attachments", id), { recursive: true }); await writeFile(join(dataDir, "attachments", id, "file.txt"), bytes);
    sqlite.prepare("INSERT INTO run_attachments(id,name,type,mime_type,storage_key,byte_size,content_hash) VALUES(?,'file.txt','file','text/plain',?,?,?)")
      .run(id, `attachments/${id}/file.txt`, bytes.length, id);
    sqlite.prepare("INSERT INTO run_attachment_refs(run_id,attachment_id,input_key,ordinal) VALUES('r',?,'input',0)").run(id);
    await engine.push("run:r"); expect(engine.pending()).toEqual([]);
    sqlite.exec("INSERT INTO runs(id,account_id,owner_backend_id,provider_id) VALUES('z','default','A','codex')");
    await engine.push();
    // A fork reuses the acknowledged attachment but needs metadata in its own lazy stream.
    sqlite.prepare("INSERT INTO run_attachment_refs(run_id,attachment_id,input_key,ordinal) VALUES('z',?,'fork',0)").run(id);
    const push = transport.push;
    const interrupted = vi.spyOn(transport, "push").mockImplementation(async (stream, envelopes) => {
      const results = await push(stream, envelopes);
      return results.map((result, index) => envelopes[index].header.blobs?.length ? { error: "blobMissing" as const } : result);
    });
    vi.spyOn(records, "republish").mockRejectedValue(new Error("Bridge file is unavailable locally"));
    await engine.push("run:z");
    expect(engine.pending()).toEqual([expect.objectContaining({ table_name: "run_attachment_refs" })]);
    expect(engine.blocked().records).toContainEqual(expect.objectContaining({ table: "run_attachment_refs", error: expect.stringMatching(/unavailable/) }));
    interrupted.mockRestore(); engine.retryBlocked(); await engine.push("run:z");
    expect(engine.pending()).toEqual([]);
  });
});
