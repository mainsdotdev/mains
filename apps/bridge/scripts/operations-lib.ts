import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseBridgeConfig, productionConfigErrors } from "./production-config";

export class OperationsError extends Error {}

export type Environment = "staging" | "production";
export interface OperationsTarget {
  environment: Environment; accountId: string; worker: string; configPath: string;
  profile: "default" | "mains-production"; databaseId: string; blobs: string; archive: string;
}
export interface BackupFile {
  path: string; size: number; sha256: string;
  object?: { bucket: "BLOBS" | "BLOB_ARCHIVE"; key: string; etag: string; httpMetadata?: Record<string, unknown>; customMetadata?: Record<string, string> };
}
export interface BackupManifest {
  version: 1; target: OperationsTarget; startedAt: string; completedAt: string;
  mode: "bootstrap" | "checkpoints"; files: BackupFile[];
}
export const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** Environment is mandatory; profile selection never changes Wrangler's saved default. */
export async function loadOperationsTarget(environment: string, root = process.cwd()): Promise<OperationsTarget> {
  if (environment !== "production" && environment !== "staging") throw new OperationsError("Choose --environment staging or production explicitly");
  const configPath = resolve(root, `wrangler.${environment}.jsonc`);
  const production = parseBridgeConfig(await readFile(join(root, "wrangler.production.jsonc"), "utf8"));
  const staging = parseBridgeConfig(await readFile(join(root, "wrangler.staging.jsonc"), "utf8"));
  if (productionConfigErrors(production, staging).length) throw new OperationsError("Production resource isolation checks failed; run production:check");
  const config = environment === "production" ? production : staging;
  const database = config.d1_databases?.find((entry: any) => entry.binding === "AUTH_DB");
  const blobs = config.r2_buckets?.find((entry: any) => entry.binding === "BLOBS")?.bucket_name;
  const archive = config.r2_buckets?.find((entry: any) => entry.binding === "BLOB_ARCHIVE")?.bucket_name;
  if (config.vars?.BRIDGE_ENV !== environment || config.vars?.BRIDGE_DEV_AUTH !== "false" || config.main !== "src/index.ts" ||
    !/^[a-f0-9]{32}$/.test(config.account_id ?? "") || !/^[a-f0-9-]{36}$/.test(database?.database_id ?? "") ||
    !/^[a-z0-9-]{3,63}$/.test(config.name ?? "") || !/^[a-z0-9-]{3,63}$/.test(blobs ?? "") || !/^[a-z0-9-]{3,63}$/.test(archive ?? "") || blobs === archive) {
    throw new OperationsError("Invalid operations resource configuration");
  }
  return { environment, accountId: config.account_id, worker: config.name, configPath,
    profile: environment === "production" ? "mains-production" : "default", databaseId: database.database_id, blobs, archive };
}

export async function createPrivateDirectory(path: string): Promise<string> {
  const dir = resolve(path);
  // No recursive mkdir: never reuse an existing backup or overwrite a profile.
  await mkdir(dir, { mode: 0o700 });
  return dir;
}
export async function backupFile(dir: string, path: string, bytes: Uint8Array | string, object?: BackupFile["object"]): Promise<BackupFile> {
  safeRelativePath(path);
  const file = join(dir, path);
  await mkdir(resolve(file, ".."), { recursive: true, mode: 0o700 });
  await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  const size = typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.byteLength;
  return { path, size, sha256: sha256(bytes), ...(object ? { object } : {}) };
}
export async function existingBackupFile(dir: string, path: string): Promise<BackupFile> {
  safeRelativePath(path); await chmod(join(dir, path), 0o600);
  const bytes = await readFile(join(dir, path));
  return { path, size: bytes.byteLength, sha256: sha256(bytes) };
}

/** Used with real local R2 in tests and authenticated remote bindings by the CLI.
 * Keys become metadata, never filesystem paths. Each encrypted chunk is bounded. */
export async function backupBucket(bucket: any, binding: "BLOBS" | "BLOB_ARCHIVE", dir: string): Promise<BackupFile[]> {
  const files: BackupFile[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ limit: 1000, cursor });
    for (const listed of page.objects) {
      const object = await bucket.get(listed.key, { onlyIf: { etagMatches: listed.etag } });
      const body = object?.body;
      if (!body || object.size > 64 * 1024 * 1024) throw new OperationsError("R2 changed during backup; preserve the incomplete folder and retry");
      // Binding proxies transfer the stream when .body is read. Consume that
      // stream here instead of calling the already-transferred object's method.
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      if (bytes.length !== object.size) throw new OperationsError("Incomplete R2 backup read");
      files.push(await backupFile(dir, `r2/${binding}/${String(files.length).padStart(8, "0")}.bin`, bytes,
        { bucket: binding, key: listed.key, etag: object.etag, httpMetadata: object.httpMetadata, customMetadata: object.customMetadata }));
    }
    if (page.truncated && (!page.cursor || page.cursor === cursor)) throw new OperationsError("Invalid R2 pagination cursor");
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return files;
}

function safeRelativePath(path: string): void {
  if (typeof path !== "string" || !path || isAbsolute(path) || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) throw new OperationsError("Unsafe backup path");
}
export function sameTarget(left: OperationsTarget, right: OperationsTarget): boolean {
  return ["environment", "accountId", "worker", "profile", "databaseId", "blobs", "archive"].every((key) => left[key as keyof OperationsTarget] === right[key as keyof OperationsTarget]);
}
export async function verifyBackup(dir: string, expected?: OperationsTarget): Promise<BackupManifest> {
  const root = await realpath(dir), manifestPath = join(root, "manifest.json");
  const manifestStat = await lstat(manifestPath);
  if ((await lstat(root)).mode & 0o077 || !manifestStat.isFile() || manifestStat.mode & 0o077 || manifestStat.isSymbolicLink()) throw new OperationsError("Backup directory must be private and contain ordinary files");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BackupManifest;
  if (manifest.version !== 1 || !["bootstrap", "checkpoints"].includes(manifest.mode) || !manifest.target ||
    !["production", "staging"].includes(manifest.target.environment) || !Array.isArray(manifest.files) || !manifest.files.length ||
    !Number.isFinite(Date.parse(manifest.startedAt)) || !Number.isFinite(Date.parse(manifest.completedAt))) throw new OperationsError("Invalid backup manifest");
  if (expected && !sameTarget(manifest.target, expected)) throw new OperationsError("Backup belongs to a different environment or resource set");
  await verifyBackupFiles(root, manifest.files);
  const paths = new Set(manifest.files.map((file) => file.path));
  const required = ["auth.sql", "d1-time-travel.json", "deployments.json", ...(manifest.mode === "checkpoints" ? ["checkpoints.json"] : [])];
  if (required.some((path) => !paths.has(path))) throw new OperationsError("Backup is missing a required component");
  return manifest;
}
export async function verifyBackupFiles(dir: string, files: BackupFile[]): Promise<void> {
  const root = await realpath(dir);
  if ((await lstat(root)).mode & 0o077 || !Array.isArray(files)) throw new OperationsError("Backup directory must be private");
  const paths = new Set<string>(), objects = new Set<string>();
  for (const file of files) {
    safeRelativePath(file.path);
    if (paths.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new OperationsError("Invalid backup receipt");
    paths.add(file.path);
    const path = join(root, file.path), stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || relative(root, await realpath(path)).startsWith("..")) throw new OperationsError("Backup files must be private ordinary files inside the backup directory");
    const bytes = await readFile(path);
    if (bytes.length !== file.size || sha256(bytes) !== file.sha256) throw new OperationsError("Backup checksum verification failed");
    if (file.object) {
      const object = file.object, key = `${object.bucket}:${object.key}`;
      if (!["BLOBS", "BLOB_ARCHIVE"].includes(object.bucket) || typeof object.key !== "string" || !object.key || typeof object.etag !== "string" || objects.has(key)) throw new OperationsError("Invalid R2 backup receipt");
      objects.add(key);
    }
  }
}

/** Restores ciphertext only to caller-owned empty LOCAL buckets. Never replaces
 * an object; the CLI constructs these bindings with remote access disabled. */
export async function restoreLocalObjects(dir: string, manifest: Pick<BackupManifest, "files">, buckets: Record<string, any>): Promise<number> {
  let count = 0;
  for (const file of manifest.files) {
    if (!file.object) continue;
    const object = file.object, bucket = buckets[object.bucket];
    const bytes = await readFile(join(dir, file.path));
    const httpMetadata = { ...object.httpMetadata };
    if (typeof httpMetadata.cacheExpiry === "string") httpMetadata.cacheExpiry = new Date(httpMetadata.cacheExpiry);
    const result = await bucket.put(object.key, bytes, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata, customMetadata: object.customMetadata });
    if (!result) throw new OperationsError("Local restore refused to overwrite an object");
    const stored = await bucket.get(object.key);
    if (!stored || sha256(new Uint8Array(await stored.arrayBuffer())) !== file.sha256) throw new OperationsError("Local R2 restore verification failed");
    count++;
  }
  return count;
}

export async function rollbackPlan(dir: string, target: OperationsTarget) {
  await verifyBackup(dir, target);
  const deployments = JSON.parse(await readFile(join(dir, "deployments.json"), "utf8"));
  if (!Array.isArray(deployments) || !deployments.length || deployments.some((entry) => !Number.isFinite(Date.parse(entry.created_on)))) throw new OperationsError("Invalid deployment timestamps");
  // Wrangler prints deployments oldest first; use creation time, not array order.
  const versions = [...deployments].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0].versions;
  if (!Array.isArray(versions) || versions.length !== 1 || versions[0].percentage !== 100 || !/^[a-f0-9-]{36}$/.test(versions[0].version_id ?? "")) throw new OperationsError("Select a known complete deployment; gradual deployment needs an operator review");
  return { kind: "code-only", environment: target.environment, versionId: versions[0].version_id,
    args: ["rollback", versions[0].version_id, "--config", target.configPath, "--profile", target.profile, "--message", "Bridge incident: restore captured known-good code"],
    restoresData: false, requirements: ["Take a fresh backup before executing", "Confirm no intervening Durable Object class migration or incompatible schema change", "Preserve current D1, DO and R2 state"] };
}
