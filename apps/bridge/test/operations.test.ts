import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterEach, expect, it } from "vitest";
import { backupBucket, backupFile, createPrivateDirectory, loadOperationsTarget, restoreLocalObjects, rollbackPlan, verifyBackup,
  type BackupManifest } from "../scripts/operations-lib";

const execute = promisify(execFile), directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function directory() { const dir = await mkdtemp(join(tmpdir(), "mains-bridge-ops-test-")); directories.push(dir); return dir; }
async function fixture(dir: string): Promise<BackupManifest> {
  const files = [];
  let sql = "";
  for (const file of ["0001_auth.sql", "0002_bridge_identity.sql", "0003_bridge_quotas.sql", "0004_account_entitlements.sql", "0005_closed_beta.sql"]) sql += await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8") + "\n";
  sql += "INSERT INTO user VALUES('fixture','O''Brien','fixture@example.test',1,NULL,1,1);\n";
  sql += "INSERT INTO bridge_accounts VALUES('fixture','device-a','test-hash','test-key','{\"encrypted\":true}',1);\n";
  sql += "INSERT INTO account_entitlements VALUES('fixture','bridge','standard','monthly','active',1,9999999999999,1);\n";
  files.push(await backupFile(dir, "auth.sql", sql));
  files.push(await backupFile(dir, "d1-time-travel.json", JSON.stringify({ bookmark: "test-only" })));
  files.push(await backupFile(dir, "checkpoints.json", JSON.stringify([{ accountId: "fixture", bookmark: "test-only", objectId: "a".repeat(64) }])));
  files.push(await backupFile(dir, "deployments.json", JSON.stringify([
    { created_on: "2026-10-15T00:00:00.000Z", versions: [{ percentage: 100, version_id: "22222222-2222-4222-8222-222222222222" }] },
    { created_on: "2026-10-16T00:00:00.000Z", versions: [{ percentage: 100, version_id: "11111111-1111-4111-8111-111111111111" }] },
  ])));
  return { version: 1, target: await loadOperationsTarget("staging"), mode: "checkpoints", files, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
}
async function saveManifest(dir: string, manifest: BackupManifest) { await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 }); }

it("requires an environment and pins production's separate profile and resource set offline", async () => {
  await expect(loadOperationsTarget("")).rejects.toThrow(/Choose --environment/);
  const production = await loadOperationsTarget("production"), staging = await loadOperationsTarget("staging");
  expect(production.profile).toBe("mains-production"); expect(staging.profile).toBe("default");
  expect(production.accountId).not.toBe(staging.accountId);
  expect(production.databaseId).not.toBe(staging.databaseId); expect(production.blobs).not.toBe(staging.blobs);
  const root = await directory(), manifest = await fixture(root); await saveManifest(root, manifest);
  await expect(verifyBackup(root, production)).rejects.toThrow(/different environment/);
  const plan = await rollbackPlan(root, staging);
  expect(plan).toMatchObject({ kind: "code-only", restoresData: false, versionId: "11111111-1111-4111-8111-111111111111" });
  expect(plan.args).toContain("--profile"); expect(plan.args).not.toContain("restore");
});

it("detects tampering, unsafe paths and symlinks; never reuses an existing directory", async () => {
  const root = await directory(), manifest = await fixture(root); await saveManifest(root, manifest);
  await expect(createPrivateDirectory(root)).rejects.toThrow();
  await writeFile(join(root, "auth.sql"), "tampered", { mode: 0o600 });
  await expect(verifyBackup(root)).rejects.toThrow(/checksum/);
  manifest.files[0].path = "../outside.sql"; await saveManifest(root, manifest);
  await expect(verifyBackup(root)).rejects.toThrow(/Unsafe backup path/);
  manifest.files[0].path = "auth.sql"; await saveManifest(root, manifest);
  await rm(join(root, "auth.sql"));
  const outside = join(await directory(), "outside.sql"); await writeFile(outside, "private", { mode: 0o600 });
  await symlink(outside, join(root, "auth.sql"));
  await expect(verifyBackup(root)).rejects.toThrow(/ordinary files/);
  await chmod(root, 0o755); await expect(verifyBackup(root)).rejects.toThrow(/private/);
});

it("copies exact ciphertext and archive metadata, rejects changed ETags, and refuses overwrite during a local restore", async () => {
  const root = await directory(), manifest = await fixture(root);
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "backup-test", modules: true, script: "export default {fetch(){return new Response('local')}}",
    compatibilityDate: "2026-07-30", host: "127.0.0.1", port: 0, r2Buckets: { SOURCE: "source", DESTINATION: "destination" } }));
  try {
    await mf.ready; const bucket = await mf.getR2Bucket("SOURCE"), destination = await mf.getR2Bucket("DESTINATION");
    const bytes = randomBytes(4096);
    const cacheExpiry = new Date("2026-11-16T00:00:00.000Z");
    await bucket.put("opaque/key", bytes, { httpMetadata: { contentType: "application/octet-stream", cacheExpiry }, customMetadata: { sourceKey: "opaque/original" } });
    manifest.files.push(...await backupBucket(bucket, "BLOBS", root));
    await saveManifest(root, manifest); const verified = await verifyBackup(root);
    expect(await restoreLocalObjects(root, verified, { BLOBS: destination })).toBe(1);
    expect(Buffer.from(await (await destination.get("opaque/key"))!.arrayBuffer())).toEqual(bytes);
    expect((await destination.head("opaque/key"))!.customMetadata).toEqual({ sourceKey: "opaque/original" });
    expect((await destination.head("opaque/key"))!.httpMetadata?.cacheExpiry).toEqual(cacheExpiry);
    await expect(restoreLocalObjects(root, manifest, { BLOBS: destination })).rejects.toThrow(/overwrite/);
    // Changed objects cannot silently enter a snapshot under an old list receipt.
    await expect(backupBucket({ list: () => ({ objects: [{ key: "changed", etag: "old" }], truncated: false }), get: () => ({ size: 10 }) }, "BLOBS", root)).rejects.toThrow(/R2 changed/);
  } finally { await mf.dispose(); }
});

it("restores an auth SQL backup and encrypted files into a fresh local runtime, without a Cloudflare login", async () => {
  const root = await directory(), manifest = await fixture(root), bytes = randomBytes(8192);
  manifest.files.push(await backupFile(root, "r2/BLOBS/00000000.bin", bytes, { bucket: "BLOBS", key: "opaque/ciphertext/0", etag: "test-etag" }));
  await saveManifest(root, manifest);
  const output = join(await directory(), "restored");
  const result = await execute(process.execPath, ["--import", "tsx", "scripts/operations.ts", "restore-local", "--environment", "staging", "--backup", root, "--output", output],
    { cwd: process.cwd(), env: { ...process.env, CLOUDFLARE_API_TOKEN: "intentionally-invalid-no-live-access", WRANGLER_SEND_METRICS: "false" }, timeout: 40_000 });
  expect(result.stdout).toContain("Local D1/R2 restore verified");
  const report = JSON.parse(await readFile(join(output, "restore-verification.json"), "utf8"));
  expect(report).toMatchObject({ environment: "local", doRestored: false, restoredObjects: 1, authRows: { users: 1, bridgeAccounts: 1, devices: 0, entitlements: 1 } });
  const config = JSON.parse(await readFile(join(output, "wrangler.jsonc"), "utf8"));
  expect(config.account_id).toBeUndefined(); expect(config.services).toBeUndefined(); expect(JSON.stringify(config)).not.toContain('"remote":true');
  await verifyBackup(root); // Drill never modifies the original backup.
}, 45_000);
