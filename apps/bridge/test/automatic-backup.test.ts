import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterEach, expect, it } from "vitest";
import { backupFile, loadOperationsTarget, sha256 } from "../scripts/operations-lib";
import { backupKeyPair, backupLease, backupRoot, captureAccount, checkFreshness, downloadSnapshot, listObjects, pruneSnapshots, publishSnapshot,
  seal, storeSealed, unseal, type AutomaticManifest } from "../scripts/automatic-backup-lib";
import { createHubBackup, type HubSnapshot } from "../src/hub-backup";
import { runBackup, restoreLocal } from "../scripts/automatic-backup";

const execute = promisify(execFile), cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
async function directory() { const path = await mkdtemp(join(tmpdir(), "bridge-auto-backup-")); cleanup.push(() => rm(path, { recursive: true, force: true })); return path; }
async function runtime() {
  const fixture = await build({ stdin: { contents: `
    import {AccountHub as Base, BridgeOperations} from './src/index';
    import {createHubStore} from './src/store';
    import {createHubBackup} from './src/hub-backup';
    export {BridgeOperations};
    export class AccountHub extends Base {
      seed(records){return createHubStore(this.ctx.storage).push('A','account',records)}
      futureSchema(){this.ctx.storage.sql.exec("CREATE TABLE future_schema(id TEXT)");return true}
      track(key,bytes,uploadId){
        this.ctx.storage.sql.exec('INSERT INTO quota_chunks VALUES(?,?,?,?)',key,bytes,uploadId?0:1,uploadId?Date.now()+600000:0);
        if(uploadId)this.ctx.storage.sql.exec('INSERT INTO blob_uploads VALUES(?,?,?)',key,key.slice(65,108),uploadId);
        return true;
      }
      restartBackupSession(){this.backup=createHubBackup(this.ctx.storage);return true}
      state(){const sql=this.ctx.storage.sql;return {changes:sql.exec('SELECT total_changes() AS n').one().n,
        rows:sql.exec('SELECT * FROM streams').toArray(),deleted:sql.exec('SELECT * FROM deleted').toArray(),
        usage:sql.exec('SELECT * FROM record_usage').toArray()}}
    }
    export default {async fetch(request,env){const v=await request.json();const s=env.ACCOUNT_HUB.get(env.ACCOUNT_HUB.idFromName(v.account));return Response.json(await s[v.method](...(v.args??[])))}}
    `, resolveDir: process.cwd(), sourcefile: "backup-fixture.ts" }, bundle: true, write: false, format: "esm", platform: "browser", external: ["cloudflare:workers", "node:*"] });
  const recovery = await build({ entryPoints: ["src/local-recovery.ts"], bundle: true, write: false, format: "esm", platform: "browser", external: ["cloudflare:workers", "node:*"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ host: "127.0.0.1", port: 0, workers: [
    { name: "hub", modules: true, script: fixture.outputFiles[0].text, compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"],
      d1Databases: { AUTH_DB: "auto-backup-auth" }, r2Buckets: { BLOBS: "source-live", BLOB_ARCHIVE: "source-archive", BACKUPS: "backups" }, durableObjects: { ACCOUNT_HUB: { className: "AccountHub", useSQLite: true } } },
    { name: "operator", modules: true, compatibilityDate: "2026-07-30", serviceBindings: { OPS: { name: "hub", entrypoint: "BridgeOperations" } },
      script: `export default {async fetch(request,env){const v=await request.json();try{return Response.json(await env.OPS[v.method](...v.args))}catch{return new Response('Rejected',{status:400})}}}` },
    { name: "recovery", modules: true, script: recovery.outputFiles[0].text, compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"], durableObjects: { RESTORE: { className: "RecoveryHub", useSQLite: true } } },
  ] }));
  cleanup.push(() => mf.dispose()); await mf.ready;
  const db = await mf.getD1Database("AUTH_DB", "hub");
  await db.prepare("CREATE TABLE bridge_accounts(account_id TEXT PRIMARY KEY)").run();
  await db.prepare("INSERT INTO bridge_accounts VALUES('fixture')").run();
  const call = async (worker: string, value: object) => {
    const response = await (await mf.getWorker(worker)).fetch("http://local.test", { method: "POST", body: JSON.stringify(value) });
    if (!response.ok) throw new Error("Local RPC rejected"); return response.json() as Promise<any>;
  };
  return { mf, call, ops: Object.fromEntries(["snapshotBegin", "snapshotPage", "snapshotValid"].map((method) => [method, (...args: any[]) => call("operator", { method, args })])), bucket: await mf.getR2Bucket("BACKUPS", "hub") };
}
function record(i: number, op = "upsert") {
  return { header: { v: 1, stream: "account", rowKey: sha256(`row-${i}`), ...(op === "upsert" ? { registerKey: sha256(`register-${i}`), blobs: [] } : {}), origin: "A", op,
    hlc: { physicalMs: op === "upsert" ? 1 : 2, counter: 0 }, owner: "A" }, nonce: "opaque", ciphertext: `encrypted-${i}` };
}

it("encrypts backups with the public key; tampering, the wrong environment path and wrong private keys fail closed", () => {
  const pair = backupKeyPair(), bytes = randomBytes(8192), key = "v1/production/object";
  const encrypted = seal(bytes, pair.publicKey, key);
  expect(encrypted.includes(bytes)).toBe(false);
  expect(unseal(encrypted, pair.privateKey, key)).toEqual(bytes);
  expect(() => unseal(encrypted, pair.privateKey, "v1/staging/object")).toThrow(/authentication/);
  expect(() => unseal(encrypted, backupKeyPair().privateKey, key)).toThrow(/authentication/);
  encrypted[encrypted.length - 1] ^= 1;
  expect(() => unseal(encrypted, pair.privateKey, key)).toThrow(/authentication/);
});

it("exports real paginated hub state without writes; restores tombstones, sequences and quota counters in an empty local hub", async () => {
  const { call, ops } = await runtime(), source = new Map<string, string>();
  await call("hub", { account: "fixture", method: "seed", args: [Array.from({ length: 90 }, (_, i) => record(i))] });
  await call("hub", { account: "fixture", method: "seed", args: [[record(4, "delete")]] });
  await call("hub", { account: "fixture", method: "track", args: [`${sha256("fixture")}/${"a".repeat(43)}/0`, 140, "pending-upload"] });
  const before = await call("hub", { account: "fixture", method: "state" });
  const capture = await captureAccount(ops, "fixture", async (path, bytes) => { source.set(path, bytes); }, "hub/0");
  expect(await call("hub", { account: "fixture", method: "state" })).toEqual(before);
  expect(capture.pages.filter((page) => page.table === "log").length).toBeGreaterThan(1);
  const snapshot = JSON.parse(source.get(capture.snapshot)!) as HubSnapshot;
  // Cloudflare reserves _cf_METADATA, so application SQL cannot create that
  // production-only table in local workerd. Exercise the same catalog query
  // against real SQLite with the real exported app schema and platform table.
  const catalog = new DatabaseSync(":memory:");
  try {
    for (const entry of snapshot.schema.filter((entry) => entry.type === "table")) catalog.exec(entry.sql);
    catalog.exec("CREATE TABLE _cf_METADATA(k TEXT PRIMARY KEY,v TEXT); INSERT INTO _cf_METADATA VALUES('internal','platform-only')");
    const exporter = createHubBackup({ kv: { list: () => new Map() }, sql: { exec: (query: string) => {
      const statement = catalog.prepare(query); return { toArray: () => statement.all(), one: () => statement.get() };
    } } });
    expect(exporter.begin().tables).toEqual(snapshot.tables);
    expect(exporter.begin().schema.some((entry) => entry.tbl_name === "_cf_METADATA")).toBe(false);
  } finally { catalog.close(); }
  expect(snapshot.schema.some((entry) => entry.tbl_name === "_cf_METADATA")).toBe(false);
  expect(capture.pages.filter((page) => page.table === "blob_uploads").flatMap((page) => JSON.parse(source.get(page.path)!).rows)).toHaveLength(1);
  const restore = (action: string, args: unknown[]) => call("recovery", { account: "fixture", action, args });
  await restore("initialize", [snapshot]);
  for (const page of capture.pages) await restore("page", [page.table, JSON.parse(source.get(page.path)!)]);
  const expectedRows = capture.pages.reduce((sum, page) => sum + JSON.parse(source.get(page.path)!).rows.length, 0);
  expect(await restore("finish", [snapshot])).toMatchObject({ tables: 21, rows: expectedRows });
  const pulled = await restore("pull", ["account", 0]);
  expect(pulled.records).toHaveLength(91); expect(pulled.next).toBe(91);
  expect(pulled.records.at(-1).envelope.header.op).toBe("delete");
  expect(await restore("push", ["A", "account", [record(4)]])).toMatchObject({ results: [{ deleted: { header: { op: "delete" } } }] });
  expect(await restore("push", ["B", "account", [{ ...record(1), header: { ...record(1).header, origin: "B" } }]])).toMatchObject({ results: [{ error: "notOwner" }] });
  await expect(restore("initialize", [snapshot])).rejects.toThrow();
  // Previously published 18-table backups have no cleanup queue/indexes or
  // triggers. Restore those bytes into a separate empty hub and let normal
  // initialization seed resumable legacy work without changing user data.
  const legacy: HubSnapshot = { ...snapshot, tables: snapshot.tables.filter((table) => !["compaction_jobs", "blob_uploads", "write_budget"].includes(table)),
    schema: snapshot.schema.filter((entry) => !["compaction_jobs", "blob_uploads", "write_budget"].includes(entry.tbl_name) && !entry.sql.includes("compaction_jobs") &&
      !["log_register_seq", "latest_retention"].includes(entry.name)) };
  const oldRestore = (action: string, args: unknown[]) => call("recovery", { account: "legacy", action, args });
  await oldRestore("initialize", [legacy]);
  for (const page of capture.pages.filter((page) => legacy.tables.includes(page.table))) await oldRestore("page", [page.table, JSON.parse(source.get(page.path)!)]);
  expect(await oldRestore("finish", [legacy])).toMatchObject({ tables: 18 });
  expect(await oldRestore("pull", ["account", 0])).toEqual(pulled);
  expect(await oldRestore("push", ["A", "account", [record(4)]])).toMatchObject({ results: [{ deleted: { header: { op: "delete" } } }] });
  const previous: HubSnapshot = { ...snapshot, tables: snapshot.tables.filter((table) => !["blob_uploads", "write_budget"].includes(table)),
    schema: snapshot.schema.filter((entry) => !["blob_uploads", "write_budget"].includes(entry.tbl_name)) };
  const previousRestore = (action: string, args: unknown[]) => call("recovery", { account: "previous", action, args });
  await previousRestore("initialize", [previous]);
  for (const page of capture.pages.filter((page) => previous.tables.includes(page.table))) await previousRestore("page", [page.table, JSON.parse(source.get(page.path)!)]);
  expect(await previousRestore("finish", [previous])).toMatchObject({ tables: 19 });
  expect(await previousRestore("pull", ["account", 0])).toEqual(pulled);
  // A write between pages fences the original snapshot instead of creating a
  // mixture that never existed. Unknown table/cursor cannot inject SQL.
  const old = await ops.snapshotBegin("fixture");
  await call("hub", { account: "fixture", method: "seed", args: [[record(91)]] });
  expect(await ops.snapshotPage("fixture", old.token, "log", 0)).toMatchObject({ changed: true });
  expect(await ops.snapshotValid("fixture", old.token)).toBe(false);
  await expect(ops.snapshotPage("fixture", old.token, "log;DELETE FROM log", 0)).rejects.toThrow();
  await call("hub", { account: "fixture", method: "futureSchema" });
  await expect(ops.snapshotBegin("fixture")).rejects.toThrow();
});

it("retries concurrent changes, rejects continuously busy accounts, and rejects a different object-session nonce", async () => {
  const { call, ops } = await runtime(), pages: string[] = []; let mutated = false;
  const result = await captureAccount(ops, "fixture", async (path) => {
    pages.push(path);
    if (!mutated) { mutated = true; await call("hub", { account: "fixture", method: "seed", args: [[record(1)]] }); }
  }, "hub/0");
  expect(result.snapshot).toContain("/1/"); expect(pages.some((path) => path.includes("/0/"))).toBe(true);
  let i = 2;
  await expect(captureAccount(ops, "fixture", async () => { await call("hub", { account: "fixture", method: "seed", args: [[record(i++)]] }); }, "hub/1")).rejects.toThrow(/three backup attempts/);
  // An instance token is never accepted by another account/object session,
  // even when both SQLite total_changes counters have the same value.
  const snapshot = await ops.snapshotBegin("fixture");
  expect(await ops.snapshotValid("fixture", snapshot.token.replace(/^[^:]+/, "00000000-0000-4000-8000-000000000000"))).toBe(false);
});

it("continues a coherent capture after a read-only object restart when its durable bookmark has not changed", async () => {
  const { call, ops } = await runtime(), source = new Map<string, string>();
  await call("hub", { account: "fixture", method: "seed", args: [Array.from({ length: 90 }, (_, i) => record(i))] });
  // Local workerd has no PITR log. Model the native commit bookmark using the
  // real SQL write counter, preserved while only the export session restarts.
  const durable = { ...ops, checkpoint: async () => ({ bookmark: `local-${(await call("hub", { account: "fixture", method: "state" })).changes}` }) };
  const before = await call("hub", { account: "fixture", method: "state" });
  let restarts = 0;
  const capture = await captureAccount(durable, "fixture", async (path, bytes) => {
    source.set(path, bytes);
    if (path.endsWith("snapshot.json")) return;
    // Invalidate every original session between pages. No SQL data is changed.
    await call("hub", { account: "fixture", method: "restartBackupSession" }); restarts++;
  }, "hub/0");
  expect(restarts).toBeGreaterThan(18);
  expect(capture.snapshot).toContain("/0/");
  const snapshot = JSON.parse(source.get(capture.snapshot)!) as HubSnapshot;
  expect(snapshot).toHaveProperty("sourceBookmark", `local-${before.changes}`);
  expect(capture.pages.filter((page) => page.table === "log").flatMap((page) => JSON.parse(source.get(page.path)!).rows)).toHaveLength(90);
  expect(await call("hub", { account: "fixture", method: "state" })).toEqual(before);
});

it("never accepts writes during bookmark-based resumption, including a write racing its checkpoint", async () => {
  const { call, ops } = await runtime(); let checkpoints = 0, restarted = false;
  const durable = { ...ops, checkpoint: async () => {
    const { changes } = await call("hub", { account: "fixture", method: "state" });
    // A write after the resume checkpoint but before the new session token must
    // still invalidate the whole attempt at the final checkpoint.
    if (++checkpoints === 2) await call("hub", { account: "fixture", method: "seed", args: [[record(1)]] });
    return { bookmark: `local-${changes}` };
  } };
  const source = new Map<string, string>();
  const capture = await captureAccount(durable, "fixture", async (path, bytes) => {
    source.set(path, bytes);
    if (!restarted) { restarted = true; await call("hub", { account: "fixture", method: "restartBackupSession" }); }
  }, "hub/0");
  expect(capture.snapshot).toContain("/1/");
  expect(capture.pages.filter((page) => page.table === "log").flatMap((page) => JSON.parse(source.get(page.path)!).rows)).toHaveLength(1);
  let i = 2;
  await expect(captureAccount(durable, "fixture", async () => {
    await call("hub", { account: "fixture", method: "seed", args: [[record(i++)]] });
  }, "hub/1")).rejects.toThrow(/three backup attempts/);
  await expect(captureAccount({ ...ops, checkpoint: async () => { throw new Error("PITR unavailable"); } }, "fixture", async () => {}, "hub/2")).rejects.toThrow(/PITR unavailable/);
});

it("bounds read-only restart churn when the source never makes page progress", async () => {
  const { call, ops } = await runtime(); let reads = 0, wrote = false;
  const unstable = { ...ops, checkpoint: async () => ({ bookmark: `local-${(await call("hub", { account: "fixture", method: "state" })).changes}` }),
    snapshotPage: async (...args: any[]) => {
      reads++;
      await call("hub", { account: "fixture", method: "restartBackupSession" });
      return ops.snapshotPage(...args);
    } };
  await expect(captureAccount(unstable, "fixture", async () => { wrote = true; }, "hub/0")).rejects.toThrow(/session churn/);
  expect(reads).toBeGreaterThan(0); expect(reads).toBeLessThan(50);
  expect(wrote).toBe(false);
});

it("reuses unchanged encrypted files, publishes only verified snapshots, and locally restores D1/hubs/files from the encrypted R2 backup", async () => {
  const { call, ops, bucket } = await runtime(), pair = backupKeyPair(), target = await loadOperationsTarget("staging"), root = backupRoot(target, pair.publicKey);
  await call("hub", { account: "fixture", method: "seed", args: [[record(1), record(2), record(2, "delete")]] });
  const files: AutomaticManifest["files"] = [], refs: Awaited<ReturnType<typeof storeSealed>>["receipt"][] = [];
  const save = async (path: string, bytes: string | Uint8Array) => {
    const raw = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
    const object = await storeSealed(bucket, root, `test:${sha256(raw)}`, pair.publicKey, async () => raw);
    files.push({ path, size: raw.length, sha256: sha256(raw), key: object.receipt.key }); refs.push(object.receipt);
  };
  let sql = "";
  for (const file of ["0001_auth.sql", "0002_bridge_identity.sql", "0003_bridge_quotas.sql", "0004_account_entitlements.sql", "0005_closed_beta.sql", "0006_backend_token_handover.sql"]) sql += await readFile(`migrations/${file}`, "utf8") + "\n";
  sql += "INSERT INTO user VALUES('fixture','Local user','fixture@example.test',1,NULL,1,1);\n";
  sql += "INSERT INTO bridge_backends(account_id,backend_id,public_key,label,platform,status,token_hash,token_expires_at,created_at,next_token_hash,next_token_expires_at) VALUES('fixture','B','public','Local','test','approved','current-fixture-hash',9999999999999,1,'pending-fixture-hash',9999999999999);\n";
  sql += "INSERT INTO bridge_beta_invites VALUES('fixture@example.test','fixture','active',1,2,2592000002,2);\n";
  await save("auth.sql", sql); await save("deployments.json", "[]"); await save("d1-time-travel.json", "{}");
  const captured = await captureAccount(ops, "fixture", save, "hub/0");
  const bytes = randomBytes(4096), object = await storeSealed(bucket, root, "attachment:unchanged-etag", pair.publicKey, async () => bytes);
  files.push({ path: "r2/BLOBS/0.bin", key: object.receipt.key, size: bytes.length, sha256: sha256(bytes), object: { bucket: "BLOBS", key: "opaque/file/0", etag: "test" } }); refs.push(object.receipt);
  let loads = 0;
  expect(await storeSealed(bucket, root, "attachment:unchanged-etag", pair.publicKey, async () => { loads++; return bytes; })).toEqual(object);
  expect(loads).toBe(0);
  const manifest: AutomaticManifest = { version: 2, target, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), files, accounts: [captured] };
  const index = await publishSnapshot(bucket, root, pair.publicKey, manifest, refs);
  expect(await checkFreshness(bucket, root)).toBe(manifest.completedAt);
  const output = await directory();
  const downloaded = await downloadSnapshot(bucket, index, target, pair.privateKey, async (path, data) => { await backupFile(output, path, data); });
  expect(downloaded).toEqual(manifest);
  await backupFile(output, "manifest.json", JSON.stringify(downloaded)); await backupFile(output, "public-key.pem", pair.publicKey);
  const local = join(await directory(), "restore");
  const result = await execute(process.execPath, ["--import", "tsx", "scripts/automatic-backup.ts", "restore-local", "--environment", "staging", "--backup", output, "--output", local],
    { env: { ...process.env, CLOUDFLARE_API_TOKEN: "invalid-local-only", WRANGLER_SEND_METRICS: "false" }, timeout: 30_000 });
  expect(result.stdout).toContain("Local recovery verified");
  expect(JSON.parse(await readFile(join(local, "restore-verification.json"), "utf8"))).toMatchObject({ environment: "local", users: 1, accounts: 1, restoredObjects: 1, remoteWrites: false });
  const restoredBeta = await execute(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "AUTH_DB", "--local", "--config", join(local, "wrangler.jsonc"), "--persist-to", join(local, "state"), "--json", "--command", "SELECT status,activated_at,expires_at FROM bridge_beta_invites"],
    { env: { ...process.env, CLOUDFLARE_API_TOKEN: "invalid-local-only", WRANGLER_SEND_METRICS: "false" }, timeout: 30_000 });
  expect(JSON.parse(restoredBeta.stdout)[0].results).toEqual([{ status: "active", activated_at: 2, expires_at: 2592000002 }]);
  const restoredHandover = await execute(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "AUTH_DB", "--local", "--config", join(local, "wrangler.jsonc"), "--persist-to", join(local, "state"), "--json", "--command", "SELECT token_hash,next_token_hash,next_token_expires_at FROM bridge_backends"],
    { env: { ...process.env, CLOUDFLARE_API_TOKEN: "invalid-local-only", WRANGLER_SEND_METRICS: "false" }, timeout: 30_000 });
  expect(JSON.parse(restoredHandover.stdout)[0].results).toEqual([{ token_hash: "current-fixture-hash", next_token_hash: "pending-fixture-hash", next_token_expires_at: 9999999999999 }]);
  await expect(downloadSnapshot(bucket, index, await loadOperationsTarget("production"), pair.privateKey, async () => {})).rejects.toThrow(/another environment/);
  const head = await bucket.head(object.receipt.key);
  await bucket.put(object.receipt.key, "corrupt", { customMetadata: head!.customMetadata });
  await expect(storeSealed(bucket, root, "attachment:unchanged-etag", pair.publicKey, async () => bytes)).rejects.toThrow(/integrity/);
  await expect(publishSnapshot(bucket, root, pair.publicKey, manifest, refs)).rejects.toThrow(/changed before/);
}, 45_000);

it("retains shared objects for newer backups, removes expired unreferenced data, and preserves the last success and other environment", async () => {
  const { bucket } = await runtime(), pair = backupKeyPair(), target = await loadOperationsTarget("staging"), root = backupRoot(target, pair.publicKey);
  const now = Date.now(), old = new Date(now - 40 * 86_400_000).toISOString(), fresh = new Date(now - 86_400_000).toISOString();
  const shared = await storeSealed(bucket, root, "shared", pair.publicKey, async () => randomBytes(2048));
  const obsolete = await storeSealed(bucket, root, "obsolete", pair.publicKey, async () => randomBytes(1024));
  const base: AutomaticManifest = { version: 2, target, startedAt: old, completedAt: old, files: [], accounts: [] };
  const oldKey = await publishSnapshot(bucket, root, pair.publicKey, base, [shared.receipt, obsolete.receipt]);
  const freshKey = await publishSnapshot(bucket, root, pair.publicKey, { ...base, startedAt: fresh, completedAt: fresh }, [shared.receipt]);
  await bucket.put("v1/production/unrelated", "untouched");
  // Age the pool only for the retention simulation; the freshest snapshot is
  // always retained even when the scheduler has stopped for over 35 days.
  expect((await pruneSnapshots(bucket, root, now + 3 * 86_400_000)).deletedObjects).toBeGreaterThan(0);
  expect(await bucket.head(oldKey)).toBeNull(); expect(await bucket.head(freshKey)).not.toBeNull();
  expect(await bucket.head(shared.receipt.key)).not.toBeNull(); expect(await bucket.head(obsolete.receipt.key)).toBeNull();
  expect(await bucket.head("v1/production/unrelated")).not.toBeNull();
  await pruneSnapshots(bucket, root, now + 100 * 86_400_000);
  expect(await bucket.head(freshKey)).not.toBeNull(); expect(await bucket.head(shared.receipt.key)).not.toBeNull();
  await expect(checkFreshness(bucket, root, now + 3 * 86_400_000)).rejects.toThrow(/stale/);
  await bucket.put(`${root}/snapshots/bad.json`, "{}");
  await expect(pruneSnapshots(bucket, root)).rejects.toThrow(/retention stopped/);
  expect(await bucket.head(shared.receipt.key)).not.toBeNull();
});

it("serializes manual and scheduled jobs and never publishes success for an interrupted capture", async () => {
  const { bucket } = await runtime(), pair = backupKeyPair(), root = backupRoot(await loadOperationsTarget("staging"), pair.publicKey);
  await backupLease(bucket, root, async () => {
    await expect(backupLease(bucket, root, async () => {})).rejects.toThrow(/lease/);
    await storeSealed(bucket, root, "partial", pair.publicKey, async () => randomBytes(128));
  });
  await expect(backupLease(bucket, root, async () => { throw new Error("interrupted"); })).rejects.toThrow(/interrupted/);
  await backupLease(bucket, root, async () => {});
  expect(await listObjects(bucket, `${root}/snapshots/`)).toHaveLength(0);
  await expect(checkFreshness(bucket, root)).rejects.toThrow(/missing/);
});

it("runs two complete daily jobs locally, reads unchanged source objects once, and refuses a missing referenced file", async () => {
  const { mf, call, ops, bucket } = await runtime(), pair = backupKeyPair(), target = await loadOperationsTarget("staging"), root = backupRoot(target, pair.publicKey);
  const source = await mf.getR2Bucket("BLOBS", "hub"), archive = await mf.getR2Bucket("BLOB_ARCHIVE", "hub");
  const bytes = randomBytes(4096), original = await source.put("opaque/attachment/0", bytes);
  await call("hub", { account: "fixture", method: "track", args: ["opaque/attachment/0", bytes.length] });
  await call("hub", { account: "fixture", method: "seed", args: [[record(1)]] });
  let gets = 0;
  const singleTransfer = (object: any) => {
    if (!object) return object; let read = false;
    return new Proxy(object, { get(target, key) {
      if (key === "body") { if (read) throw new Error("Remote body was transferred twice"); read = true; }
      return Reflect.get(target, key);
    } });
  };
  const backupReads = new Map<string, number>();
  const backupsProxy = { list: (...args: any[]) => (bucket.list as any)(...args), head: (...args: any[]) => (bucket.head as any)(...args),
    put: (...args: any[]) => (bucket.put as any)(...args), delete: (...args: any[]) => (bucket.delete as any)(...args),
    get: async (key: string) => { backupReads.set(key, (backupReads.get(key) ?? 0) + 1); return singleTransfer(await bucket.get(key)); } };
  const sourceProxy = { list: (...args: any[]) => (source.list as any)(...args), head: (...args: any[]) => (source.head as any)(...args),
    get: async (...args: any[]) => { gets++; return singleTransfer(await (source.get as any)(...args)); } };
  let sql = "";
  for (const file of ["0001_auth.sql", "0002_bridge_identity.sql", "0003_bridge_quotas.sql", "0004_account_entitlements.sql", "0005_closed_beta.sql", "0006_backend_token_handover.sql"]) sql += await readFile(`migrations/${file}`, "utf8") + "\n";
  sql += "INSERT INTO user VALUES('fixture','Local user','fixture@example.test',1,NULL,1,1);\n";
  sql += "INSERT INTO bridge_accounts VALUES('fixture','device-a','hash','pub','{}',1);\n";
  const dependencies = {
    destination: async () => "local-backups",
    withRemoteBindings: async <T,>(_target: unknown, _bootstrap: boolean, handle: (env: Record<string, any>) => Promise<T>) => handle({ BLOBS: sourceProxy, BLOB_ARCHIVE: archive, BACKUPS: backupsProxy, OPS: ops }),
    runWrangler: async (args: string[]) => {
      if (args[0] === "d1" && args[1] === "export") await writeFile(args[args.indexOf("--output") + 1], sql, { mode: 0o600 });
      return "[]";
    },
  };
  const base = await directory(), before = await call("hub", { account: "fixture", method: "state" });
  await runBackup(target, pair.publicKey, join(base, "first"), dependencies);
  await runBackup(target, pair.publicKey, join(base, "second"), dependencies);
  expect(gets).toBe(1);
  expect(backupReads.get(`${root}/objects/${sha256(`r2:BLOBS:opaque/attachment/0:${original!.etag}`)}`)).toBe(1);
  expect(await call("hub", { account: "fixture", method: "state" })).toEqual(before);
  expect(await listObjects(bucket, `${root}/snapshots/`)).toHaveLength(2);
  const receipt = JSON.parse(await readFile(join(base, "second", "receipt.json"), "utf8")), restored = await directory();
  const manifest = await downloadSnapshot(bucket, receipt.index, target, pair.privateKey, async (path, data) => { await backupFile(restored, path, data); });
  expect(manifest.accounts).toHaveLength(1);
  expect(await readFile(join(restored, "r2/BLOBS/0.bin"))).toEqual(bytes);
  await source.delete("opaque/attachment/0");
  await expect(runBackup(target, pair.publicKey, join(base, "missing"), dependencies)).rejects.toThrow(/missing ciphertext/);
  expect(await listObjects(bucket, `${root}/snapshots/`)).toHaveLength(2);
  // A chunk collected after the account's point can be recovered from the
  // deletion archive into its original live key, before that hub is restored.
  await archive.put("deleted/fixture/attachment", bytes, { customMetadata: { sourceKey: "opaque/attachment/0", sourceEtag: original!.etag } });
  await runBackup(target, pair.publicKey, join(base, "archived"), dependencies);
  const archived = JSON.parse(await readFile(join(base, "archived", "receipt.json"), "utf8")), download = await directory();
  const archivedManifest = await downloadSnapshot(bucket, archived.index, target, pair.privateKey, async (path, data) => { await backupFile(download, path, data); });
  await backupFile(download, "manifest.json", JSON.stringify(archivedManifest)); await backupFile(download, "public-key.pem", pair.publicKey);
  const drill = join(base, "archived-drill"); await restoreLocal(target, download, drill);
  expect(JSON.parse(await readFile(join(drill, "restore-verification.json"), "utf8"))).toMatchObject({ rehydratedObjects: 1, restoredObjects: 1, remoteWrites: false });
}, 45_000);
