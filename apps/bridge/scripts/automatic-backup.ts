import { chmod, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { backupFile, createPrivateDirectory, loadOperationsTarget, OperationsError, restoreLocalObjects, sha256, verifyBackupFiles, type OperationsTarget } from "./operations-lib";
import { runWrangler, withRemoteBindings } from "./operations";
import { backupKeyPair, backupLease, backupRoot, captureAccount, checkFreshness, downloadSnapshot, listObjects, pruneSnapshots, publishSnapshot,
  readBackupKey, snapshotIndexes, storeSealed, type AutomaticManifest, type ObjectReceipt, type SealedFile } from "./automatic-backup-lib";
import type { HubPage, HubSnapshot } from "../src/hub-backup";

async function destination(target: OperationsTarget) {
  // This bucket is deliberately NOT bound to the live application. Its only
  // writer is the separately authenticated operations process.
  const config = JSON.parse(await readFile("backup-targets.json", "utf8"));
  const bucket = config[target.environment]?.bucket;
  if (!bucket || !/^[a-z0-9-]{3,63}$/.test(bucket) || [target.blobs, target.archive].includes(bucket) || config.staging?.bucket === config.production?.bucket) throw new OperationsError("Backup destination must be separate from live storage and the other environment");
  return bucket as string;
}
export async function runBackup(target: OperationsTarget, publicKey: string, output: string,
  dependencies = { runWrangler, withRemoteBindings, destination }) {
  const dir = await createPrivateDirectory(output), startedAt = new Date().toISOString();
  const bucketName = await dependencies.destination(target), root = backupRoot(target, publicKey);
  let phase = "connection";
  try { await dependencies.withRemoteBindings(target, false, async (env) => backupLease(env.BACKUPS, root, async (guard) => {
    phase = "backup inventory";
    const verified = new Map<string, ObjectReceipt>();
    for (const { index } of await snapshotIndexes(env.BACKUPS, root)) for (const ref of [index.manifest, ...index.objects]) verified.set(ref.key, ref);
    phase = "D1 export";
    await dependencies.runWrangler(["d1", "export", "AUTH_DB", "--remote", "--output", join(dir, "auth.sql"), "--skip-confirmation"], target);
    await chmod(join(dir, "auth.sql"), 0o600);
    const manifest: AutomaticManifest = { version: 2, target, startedAt, completedAt: "", files: [], accounts: [] };
    const refs: Awaited<ReturnType<typeof storeSealed>>["receipt"][] = [];
    const save = async (path: string, bytes: Uint8Array | string) => {
      const plain = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
      const stored = await storeSealed(env.BACKUPS, root, `file:${sha256(plain)}`, publicKey, async () => plain, verified);
      const file: SealedFile = { path, key: stored.receipt.key, size: stored.plainSize, sha256: stored.plainSha };
      manifest.files.push(file); refs.push(stored.receipt);
    };
    phase = "D1 encryption";
    const auth = await readFile(join(dir, "auth.sql")); await save("auth.sql", auth);
    // Enumerate from the exported D1 point, not a later live query: accounts
    // created during a run must wait for the next complete backup.
    phase = "D1 account inventory";
    const local = new DatabaseSync(":memory:");
    let accounts: { account_id: string }[];
    try { local.exec(auth.toString()); accounts = local.prepare("SELECT account_id FROM bridge_accounts ORDER BY account_id").all() as { account_id: string }[]; }
    finally { local.close(); }
    phase = "deployment metadata";
    for (const [path, args] of [["d1-time-travel.json", ["d1", "time-travel", "info", "AUTH_DB", "--json"]], ["deployments.json", ["deployments", "list", "--json"]]] as const) {
      await save(path, JSON.stringify(JSON.parse(await dependencies.runWrangler([...args], target))));
    }
    const requiredChunks = new Map<string, number>();
    phase = "hub SQL capture";
    for (const [i, account] of accounts.entries()) {
      guard();
      // Spool pages to private runner disk, not memory or remote R2, while the
      // optimistic source fence is open. Slow uploads happen AFTER validation.
      const captured = await captureAccount(env.OPS, account.account_id, async (path, bytes) => { await backupFile(dir, path, bytes); }, `hub/${i}`);
      console.log(`Captured hub ${i + 1}/${accounts.length}: ${captured.pages.length} pages.`);
      phase = "hub encryption";
      for (const [fileIndex, path] of [captured.snapshot, ...captured.pages.map((page) => page.path)].entries()) {
        await save(path, await readFile(join(dir, path)));
        if ((fileIndex + 1) % 20 === 0) console.log(`Verified hub backup files: ${fileIndex + 1}/${captured.pages.length + 1}.`);
      }
      for (const page of captured.pages.filter((page) => page.table === "quota_chunks")) {
        for (const row of (JSON.parse(await readFile(join(dir, page.path), "utf8")) as HubPage).rows) if (row.values[2] === 1) requiredChunks.set(String(row.values[0]), Number(row.values[1]));
      }
      manifest.accounts.push(captured);
      phase = "hub SQL capture";
    }
    const copiedChunks = new Map<string, number>();
    phase = "R2 copy";
    for (const binding of ["BLOBS", "BLOB_ARCHIVE"] as const) {
      let number = 0;
      console.log(`Verifying ${binding} ciphertext inventory.`);
      for (const object of await listObjects(env[binding], "")) {
        guard();
        const stored = await storeSealed(env.BACKUPS, root, `r2:${binding}:${object.key}:${object.etag}`, publicKey, async () => {
          const result = await env[binding].get(object.key, { onlyIf: { etagMatches: object.etag } });
          const stream = result?.body;
          if (!stream || result.size > 64 * 1024 * 1024) throw new OperationsError("Source R2 object changed during backup");
          const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
          if (bytes.length !== object.size) throw new OperationsError("Incomplete source R2 read");
          return bytes;
        }, verified);
        const head = await env[binding].head(object.key);
        if (!head || head.etag !== object.etag) throw new OperationsError("Source R2 object changed during backup");
        manifest.files.push({ path: `r2/${binding}/${number++}.bin`, key: stored.receipt.key, size: stored.plainSize, sha256: stored.plainSha,
          object: { bucket: binding, key: object.key, etag: object.etag, httpMetadata: head.httpMetadata, customMetadata: head.customMetadata } });
        refs.push(stored.receipt);
        copiedChunks.set(binding === "BLOBS" ? object.key : head.customMetadata?.sourceKey ?? "", stored.plainSize);
      }
    }
    if ([...requiredChunks].some(([key, size]) => copiedChunks.get(key) !== size)) throw new OperationsError("A hub snapshot references a missing ciphertext chunk; backup was not published");
    manifest.completedAt = new Date().toISOString(); guard();
    phase = "completion";
    console.log("Verifying snapshot completion references.");
    const used = new Set(manifest.files.map((file) => file.key));
    const key = await publishSnapshot(env.BACKUPS, root, publicKey, manifest, refs.filter((ref) => used.has(ref.key)));
    await backupFile(dir, "receipt.json", JSON.stringify({ version: 1, environment: target.environment, completedAt: manifest.completedAt, index: key,
      accounts: manifest.accounts.length, files: manifest.files.length }));
    phase = "retention"; guard(); await pruneSnapshots(env.BACKUPS, root);
    console.log(`Verified ${target.environment} automatic backup: ${manifest.accounts.length} accounts, ${manifest.files.length} files. Retention: 35 days.`);
  }), bucketName); }
  catch (error) {
    if (error instanceof OperationsError) throw error;
    throw new OperationsError(`Automatic backup failed during ${phase}. No live restore was attempted; sensitive provider details are not logged.`);
  }
}

export async function restoreLocal(target: OperationsTarget, source: string, output: string) {
  const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8")) as AutomaticManifest;
  // Recheck every private local file before importing any SQL or ciphertext.
  if (manifest.version !== 2 || backupRoot(manifest.target, await readFile(join(source, "public-key.pem"), "utf8")) !== backupRoot(target, await readFile(join(source, "public-key.pem"), "utf8"))) throw new OperationsError("Restore environment mismatch");
  await verifyBackupFiles(source, manifest.files);
  const paths = new Set(manifest.files.map((file) => file.path));
  if (!["auth.sql", "deployments.json", "d1-time-travel.json"].every((path) => paths.has(path)) || !Array.isArray(manifest.accounts) ||
    manifest.accounts.some((account) => !paths.has(account.snapshot) || account.pages.some((page) => !paths.has(page.path)))) throw new OperationsError("Incomplete local snapshot manifest");
  const dir = await createPrivateDirectory(output), bundle = await build({ entryPoints: ["src/local-recovery.ts"], bundle: true, write: false,
    format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:workers", "node:*"] });
  const databaseId = "00000000-0000-4000-8000-000000000001", state = join(dir, "state"), configPath = join(dir, "wrangler.jsonc");
  await backupFile(dir, "wrangler.jsonc", JSON.stringify({ name: "local-backup-recovery", compatibility_date: "2026-07-30",
    d1_databases: [{ binding: "AUTH_DB", database_name: "local-recovery-auth", database_id: databaseId }] }));
  await runWrangler(["d1", "execute", "AUTH_DB", "--local", "--config", configPath, "--persist-to", state, "--file", join(source, "auth.sql")]);
  // No remote binding, account ID, live namespace name or credentials.
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "local-recovery", modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"], host: "127.0.0.1", port: 0,
    resourcePersistencePath: join(state, "v3"), d1Databases: { AUTH_DB: databaseId },
    r2Buckets: { BLOBS: "local-recovery-blobs", BLOB_ARCHIVE: "local-recovery-archive" },
    durableObjects: { RESTORE: { className: "RecoveryHub", useSQLite: true } } }));
  try {
    await mf.ready;
    const auth = await mf.getD1Database("AUTH_DB");
    const users = Number((await auth.prepare("SELECT count(*) AS n FROM user").first())!.n);
    const live = await mf.getR2Bucket("BLOBS"), archive = await mf.getR2Bucket("BLOB_ARCHIVE");
    const objects = await restoreLocalObjects(source, manifest, { BLOBS: live, BLOB_ARCHIVE: archive });
    let rehydratedObjects = 0;
    for (const account of manifest.accounts) for (const page of account.pages.filter((page) => page.table === "quota_chunks")) {
      for (const row of (JSON.parse(await readFile(join(source, page.path), "utf8")) as HubPage).rows) {
        if (row.values[2] !== 1) continue;
        const key = String(row.values[0]), size = Number(row.values[1]), existing = await live.head(key);
        if (existing) { if (existing.size !== size) throw new OperationsError("Restored live chunk has the wrong size"); continue; }
        const candidates = manifest.files.filter((file) => file.object?.bucket === "BLOB_ARCHIVE" && file.object.customMetadata?.sourceKey === key);
        const etags = new Set(candidates.map((file) => file.object!.customMetadata?.sourceEtag));
        const file = candidates[0];
        if (!file || file.size !== size || etags.size !== 1) throw new OperationsError("Restored hub chunk is missing or ambiguous in the archive");
        const copy = await live.put(key, await readFile(join(source, file.path)), { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/octet-stream" } });
        if (!copy || copy.etag !== file.object!.customMetadata?.sourceEtag) throw new OperationsError("Archived chunk rehydration failed");
        rehydratedObjects++;
      }
    }
    const worker = await mf.getWorker(); let rows = 0;
    const invoke = async (account: string, action: string, args: unknown[]) => {
      const response = await worker.fetch("http://local-recovery.invalid", { method: "POST", body: JSON.stringify({ account, action, args }) });
      if (!response.ok) throw new OperationsError("Local hub restore failed");
      return response.json() as Promise<{ rows: number }>;
    };
    for (const account of manifest.accounts) {
      const snapshot = JSON.parse(await readFile(join(source, account.snapshot), "utf8")) as HubSnapshot;
      await invoke(account.accountId, "initialize", [snapshot]);
      for (const page of account.pages) await invoke(account.accountId, "page", [page.table, JSON.parse(await readFile(join(source, page.path), "utf8"))]);
      rows += (await invoke(account.accountId, "finish", [snapshot])).rows;
    }
    await backupFile(dir, "restore-verification.json", JSON.stringify({ environment: "local", sourceEnvironment: target.environment, users,
      accounts: manifest.accounts.length, hubRows: rows, restoredObjects: objects, rehydratedObjects, remoteWrites: false }));
    console.log(`Local recovery verified: D1 (${users} users), ${manifest.accounts.length} hubs, ${objects} encrypted objects.`);
  } finally { await mf.dispose(); }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) try {
  const args = process.argv.slice(2), command = args.shift(), options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (!["--environment", "--output", "--public-key", "--private-key", "--index", "--backup"].includes(args[i]) || options.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new OperationsError("Invalid automatic-backup options");
    options.set(args[i], args[++i]);
  }
  const value = (name: string) => { const item = options.get(name); if (!item) throw new OperationsError(`Missing ${name}`); return item; };
  if (command === "keygen") {
    const dir = await createPrivateDirectory(value("--output")), pair = backupKeyPair();
    await backupFile(dir, "public-key.pem", pair.publicKey); await backupFile(dir, "private-key.pem", pair.privateKey);
    console.log("Backup key pair created in the private output directory. Keep the private key offline; the scheduler needs only public-key.pem.");
  } else {
    const target = await loadOperationsTarget(value("--environment"));
    if (command === "restore-local") await restoreLocal(target, resolve(value("--backup")), value("--output"));
    else if (command === "run") await runBackup(target, await readBackupKey(value("--public-key")), value("--output"));
    else if (command === "check") {
      const publicKey = await readBackupKey(value("--public-key"));
      await withRemoteBindings(target, false, async (env) => { await checkFreshness(env.BACKUPS, backupRoot(target, publicKey)); console.log(`${target.environment} backup is fresh.`); }, await destination(target));
    } else if (command === "download") {
      const dir = await createPrivateDirectory(value("--output")), privateKey = await readBackupKey(value("--private-key"));
      await withRemoteBindings(target, false, async (env) => {
        const manifest = await downloadSnapshot(env.BACKUPS, value("--index"), target, privateKey, async (path, bytes) => { await backupFile(dir, path, bytes); });
        await backupFile(dir, "manifest.json", JSON.stringify(manifest));
        const { createPublicKey } = await import("node:crypto");
        await backupFile(dir, "public-key.pem", createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString());
      }, await destination(target));
      console.log("Backup decrypted and checksum-verified into the private local directory. No live data was restored.");
    } else throw new OperationsError("Choose keygen, run, check, download or restore-local");
  }
} catch (error) {
  console.error(error instanceof OperationsError ? error.message : "Automatic backup failed. No live restore was attempted. Inspect configuration/access and retry; sensitive diagnostics are not logged.");
  process.exitCode = 1;
}
