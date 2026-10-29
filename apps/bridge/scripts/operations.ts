import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { backupBucket, backupFile, createPrivateDirectory, existingBackupFile, loadOperationsTarget,
  restoreLocalObjects, rollbackPlan, verifyBackup, OperationsError, type BackupFile, type BackupManifest, type OperationsTarget } from "./operations-lib";

const execute = promisify(execFile), wrangler = resolve("node_modules/wrangler/bin/wrangler.js");
process.env.WRANGLER_SEND_METRICS = "false";

export async function runWrangler(args: string[], target?: OperationsTarget): Promise<string> {
  try {
    const { stdout } = await execute(process.execPath, [wrangler, ...args,
      ...(target ? ["--config", target.configPath, ...(!process.env.CLOUDFLARE_API_TOKEN ? ["--profile", target.profile] : [])] : [])],
    { env: { ...process.env, CI: "true" }, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
    return stdout;
  } catch (error) {
    // Wrangler output can contain auth SQL, tokens and signed download URLs.
    // Keep only bounded numeric codes so CI failures remain diagnosable.
    const failure = (error ?? {}) as { code?: unknown; killed?: boolean; stdout?: unknown; stderr?: unknown };
    const output = [failure.stdout, failure.stderr].filter((value): value is string => typeof value === "string").join("\n");
    const codes = [...new Set([...output.matchAll(/\[code: ([1-9]\d{3,5})\]/g)].map((match) => match[1]))].slice(0, 4);
    const details: string[] = [];
    if (typeof failure.code === "number" && Number.isInteger(failure.code) && failure.code >= 0 && failure.code <= 255) details.push(`exit ${failure.code}`);
    if (failure.killed) details.push("process terminated");
    if (codes.length) details.push(`Cloudflare codes: ${codes.join(", ")}`);
    throw new OperationsError(`Wrangler ${args[0]} ${args[1] ?? ""} failed${details.length ? ` (${details.join("; ")})` : ""}; no backup is complete until verification succeeds`);
  }
}

/** The token is captured in memory, never printed/persisted or passed on argv.
 * A temporary config exposes only private R2 and read-only operations RPC. */
export async function withRemoteBindings<T>(target: OperationsTarget, bootstrap: boolean, handle: (env: Record<string, any>) => Promise<T>, backupBucketName?: string): Promise<T> {
  const credentials = JSON.parse(await runWrangler(["auth", "token", "--json"], target));
  if (!["oauth", "api_token"].includes(credentials.type) || typeof credentials.token !== "string") throw new OperationsError("Use a Wrangler OAuth or API-token profile for backups");
  const dir = await mkdtemp(join(tmpdir(), "mains-bridge-operations-"));
  const old = { token: process.env.CLOUDFLARE_API_TOKEN, key: process.env.CLOUDFLARE_API_KEY, email: process.env.CLOUDFLARE_EMAIL, account: process.env.CLOUDFLARE_ACCOUNT_ID };
  let proxy: { dispose(): Promise<void> } | undefined;
  try {
    process.env.CLOUDFLARE_API_TOKEN = credentials.token;
    process.env.CLOUDFLARE_ACCOUNT_ID = target.accountId;
    delete process.env.CLOUDFLARE_API_KEY; delete process.env.CLOUDFLARE_EMAIL;
    const configPath = join(dir, "wrangler.jsonc");
    await writeFile(configPath, JSON.stringify({ name: "mains-bridge-operations-proxy", account_id: target.accountId,
      compatibility_date: "2026-07-30", r2_buckets: [{ binding: "BLOBS", bucket_name: target.blobs, remote: true },
        ...(!bootstrap ? [{ binding: "BLOB_ARCHIVE", bucket_name: target.archive, remote: true }] : []),
        ...(backupBucketName ? [{ binding: "BACKUPS", bucket_name: backupBucketName, remote: true }] : [])],
      ...(!bootstrap ? { services: [{ binding: "OPS", service: target.worker, entrypoint: "BridgeOperations", remote: true }] } : {}) }), { mode: 0o600 });
    const { getPlatformProxy } = await import("wrangler");
    const connected = await getPlatformProxy<Record<string, any>>({ configPath, envFiles: [], persist: false, remoteBindings: true });
    proxy = connected;
    return await handle(connected.env);
  } finally {
    try { await proxy?.dispose(); }
    finally {
      try { await rm(dir, { recursive: true, force: true }); }
      finally {
        for (const [name, value] of Object.entries({ CLOUDFLARE_API_TOKEN: old.token, CLOUDFLARE_API_KEY: old.key, CLOUDFLARE_EMAIL: old.email, CLOUDFLARE_ACCOUNT_ID: old.account })) {
          if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
      }
    }
  }
}

async function backup(target: OperationsTarget, output: string, bootstrap: boolean): Promise<void> {
  const dir = await createPrivateDirectory(output), startedAt = new Date().toISOString(), files: BackupFile[] = [];
  // D1 contains authentication material. Never use inherited stdout for export.
  await runWrangler(["d1", "export", "AUTH_DB", "--remote", "--output", join(dir, "auth.sql"), "--skip-confirmation"], target);
  await chmod(join(dir, "auth.sql"), 0o600); files.push(await existingBackupFile(dir, "auth.sql"));
  for (const [path, args] of [["d1-time-travel.json", ["d1", "time-travel", "info", "AUTH_DB", "--json"]],
    ["deployments.json", ["deployments", "list", "--json"]]] as const) {
    const value = JSON.parse(await runWrangler([...args], target));
    files.push(await backupFile(dir, path, JSON.stringify(value, null, 2)));
  }
  await withRemoteBindings(target, bootstrap, async (env) => {
    if (!bootstrap) {
      const checkpoints: { accountId: string; objectId: string; bookmark: string; capturedAt: string }[] = [];
      let cursor = "";
      for (;;) {
        const accounts: string[] = await env.OPS.accounts(cursor);
        if (!Array.isArray(accounts) || accounts.length > 100) throw new OperationsError("Invalid account backup page");
        for (const accountId of accounts) {
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId) || accountId <= cursor) throw new OperationsError("Invalid account backup cursor");
          const point = await env.OPS.checkpoint(accountId);
          if (typeof point.bookmark !== "string" || !point.bookmark || !/^[a-f0-9]{64}$/.test(point.objectId) || !Number.isFinite(Date.parse(point.capturedAt))) throw new OperationsError("Incomplete Durable Object checkpoint");
          checkpoints.push({ accountId, ...point }); cursor = accountId;
        }
        if (accounts.length < 100) break;
      }
      files.push(await backupFile(dir, "checkpoints.json", JSON.stringify(checkpoints, null, 2)));
    }
    files.push(...await backupBucket(env.BLOBS, "BLOBS", dir));
    if (!bootstrap) files.push(...await backupBucket(env.BLOB_ARCHIVE, "BLOB_ARCHIVE", dir));
  });
  const manifest: BackupManifest = { version: 1, target, startedAt, completedAt: new Date().toISOString(), mode: bootstrap ? "bootstrap" : "checkpoints", files };
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
  await verifyBackup(dir, target);
  console.log(`Verified ${target.environment} backup: ${dir} (${files.filter((file) => file.object).length} encrypted objects; ${manifest.mode}).`);
}

async function restoreLocal(target: OperationsTarget, source: string, output: string): Promise<void> {
  const manifest = await verifyBackup(source, target), dir = await createPrivateDirectory(output);
  const configPath = join(dir, "wrangler.jsonc"), state = join(dir, "state");
  // No account ID, service bindings, remote flags, production names or secrets.
  await writeFile(configPath, JSON.stringify({ name: "bridge-local-recovery", compatibility_date: "2026-07-30",
    d1_databases: [{ binding: "AUTH_DB", database_name: "bridge-local-recovery-auth", database_id: "00000000-0000-4000-8000-000000000001" }],
    r2_buckets: [{ binding: "BLOBS", bucket_name: "bridge-local-recovery-blobs" }, { binding: "BLOB_ARCHIVE", bucket_name: "bridge-local-recovery-archive" }] }), { mode: 0o600 });
  await runWrangler(["d1", "execute", "AUTH_DB", "--local", "--config", configPath, "--persist-to", state, "--file", join(resolve(source), "auth.sql")]);
  const { getPlatformProxy } = await import("wrangler");
  // Wrangler CLI appends /v3 to --persist-to; the JS API takes the final path.
  const proxy = await getPlatformProxy<Record<string, any>>({ configPath, envFiles: [], persist: { path: join(state, "v3") }, remoteBindings: false });
  try {
    const objects = await restoreLocalObjects(source, manifest, proxy.env);
    const counts = await proxy.env.AUTH_DB.prepare(`SELECT (SELECT count(*) FROM user) users,
      (SELECT count(*) FROM bridge_accounts) bridgeAccounts,(SELECT count(*) FROM bridge_backends) devices,
      (SELECT count(*) FROM account_entitlements) entitlements`).first();
    const report = { environment: "local", sourceEnvironment: target.environment, restoredObjects: objects, authRows: counts,
      doRestored: false, note: "DO PITR requires Cloudflare; no live data was restored or modified" };
    await writeFile(join(dir, "restore-verification.json"), JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
    console.log(`Local D1/R2 restore verified: ${dir} (${objects} encrypted objects). DO PITR was not executed.`);
  } finally { await proxy.dispose(); }
}

const usage = "Usage: npm run ops -- backup|verify|restore-local|rollback-plan --environment staging|production [--output NEW_PRIVATE_DIRECTORY] [--backup BACKUP_DIRECTORY] [--bootstrap]";
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) try {
  const args = process.argv.slice(2), command = args.shift(), values = new Map<string, string>();
  let bootstrap = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--bootstrap" && !bootstrap) { bootstrap = true; continue; }
    if (!["--environment", "--output", "--backup"].includes(args[i]) || values.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new OperationsError(usage);
    values.set(args[i], args[++i]);
  }
  if (!["backup", "verify", "restore-local", "rollback-plan"].includes(command ?? "") || !values.has("--environment") ||
    bootstrap && command !== "backup" || ["backup", "restore-local"].includes(command!) && !values.has("--output") || command !== "backup" && !values.has("--backup")) throw new OperationsError(usage);
  const target = await loadOperationsTarget(values.get("--environment")!);
  const source = resolve(values.get("--backup") ?? ".");
  if (command === "backup") await backup(target, values.get("--output")!, bootstrap);
  else if (command === "verify") { const manifest = await verifyBackup(source, target); console.log(`Verified ${target.environment} backup (${manifest.files.length} files).`); }
  else if (command === "restore-local") await restoreLocal(target, source, values.get("--output")!);
  else {
    const plan = await rollbackPlan(source, target);
    await writeFile(join(source, "rollback-plan.json"), JSON.stringify(plan, null, 2), { flag: "wx", mode: 0o600 });
    console.log(`Code-only rollback plan saved for ${target.environment}, version ${plan.versionId}. Nothing was deployed or restored.`);
  }
} catch (error) {
  // Only our bounded, content-free errors leave this boundary; third-party
  // exceptions can embed auth SQL, capability URLs or provider credentials.
  const safe = error instanceof OperationsError;
  console.error(safe ? error.message : "Bridge operation failed. Preserve any partial output, check account/profile access, and retry into a new directory.");
  process.exitCode = 1;
}
