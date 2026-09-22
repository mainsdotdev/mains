import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OWNER_FILE = "owner.json";
const RECOVERY_FILE = "recovery.json";
const RECOVERY_STALE_AFTER_MS = 30_000;
const BOOT_TIME_TOLERANCE_MS = 5_000;

function displayOwner(owner: string): string {
  return owner === "Mains Server" ? "Mains CLI" : owner;
}

interface OwnershipRecordBase {
  token: string;
  pid: number;
  owner: string;
  acquiredAt: string;
}

interface LegacyOwnershipRecord extends OwnershipRecordBase {
  version: 1;
}

interface IdentifiedOwnershipRecord extends OwnershipRecordBase {
  version: 2;
  // PID alone is reusable; this identifies the process instance within a boot.
  processIdentity: string;
}

type OwnershipRecord = LegacyOwnershipRecord | IdentifiedOwnershipRecord;

let bootIdentity: string | null | undefined;

function runSystemCommand(command: string, args: string[]): string | null {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
      timeout: 1_000,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) return null;
    const output = result.stdout.trim();
    return output || null;
  } catch {
    return null;
  }
}

function readBootIdentity(): string | null {
  if (bootIdentity !== undefined) return bootIdentity;
  try {
    if (process.platform === "linux") {
      const identity = fs
        .readFileSync("/proc/sys/kernel/random/boot_id", "utf8")
        .trim();
      bootIdentity = identity || null;
      return bootIdentity;
    }
    if (process.platform === "darwin") {
      bootIdentity = runSystemCommand("/usr/sbin/sysctl", [
        "-n",
        "kern.bootsessionuuid",
      ]);
      return bootIdentity;
    }
  } catch {
    // Fall through to the conservative PID-only compatibility path.
  }
  bootIdentity = null;
  return null;
}

function readProcessIdentity(pid: number): string | null {
  if (pid <= 0) return null;
  if (process.platform === "linux") {
    try {
      const boot = readBootIdentity();
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const commandEnd = stat.lastIndexOf(")");
      if (!boot || commandEnd < 0) return null;
      // Fields after `(comm)` start at field 3; process start ticks are field 22.
      const startTicks = stat.slice(commandEnd + 1).trim().split(/\s+/u)[19];
      return startTicks && /^\d+$/u.test(startTicks)
        ? `linux:${boot}:${startTicks}`
        : null;
    } catch {
      return null;
    }
  }
  if (process.platform !== "darwin") return null;

  const rawStartedAt = runSystemCommand("/bin/ps", [
    "-o",
    "lstart=",
    "-p",
    String(pid),
  ]);
  if (!rawStartedAt) return null;
  const startedAt = rawStartedAt.replace(/\s+/gu, " ");
  return `darwin:${readBootIdentity() ?? "unknown-boot"}:${startedAt}`;
}

function createOwnershipRecord(owner: string): OwnershipRecord {
  const processIdentity = readProcessIdentity(process.pid);
  const record = {
    token: crypto.randomUUID(),
    pid: process.pid,
    owner,
    acquiredAt: new Date().toISOString(),
  };
  return processIdentity
    ? { ...record, version: 2, processIdentity }
    : { ...record, version: 1 };
}

interface OwnershipRecordShape {
  version?: unknown;
  token: string;
  pid: number;
  owner: string;
  acquiredAt: string;
  processIdentity?: unknown;
}

export interface DatabaseOwnership {
  readonly lockPath: string | null;
  release(): void;
}

export class DatabaseOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseOwnershipError";
  }
}

function isInMemoryDatabase(databasePath: string): boolean {
  return databasePath === ":memory:" || databasePath.startsWith("file::memory:");
}

export function databaseOwnershipPath(databasePath: string): string {
  return `${path.resolve(databasePath)}.backend.lock`;
}

function isOwnershipRecord(value: unknown): value is OwnershipRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<OwnershipRecordShape>;
  const hasBaseFields =
    typeof record.token === "string" &&
    Number.isInteger(record.pid) &&
    typeof record.owner === "string" &&
    typeof record.acquiredAt === "string";
  return (
    hasBaseFields &&
    (record.version === 1 ||
      (record.version === 2 &&
        typeof record.processIdentity === "string" &&
        record.processIdentity.length > 0))
  );
}

function readRecord(filePath: string): OwnershipRecord | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return isOwnershipRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function recordBelongsToRunningProcess(record: OwnershipRecord): boolean {
  if (!processIsAlive(record.pid)) return false;

  const currentIdentity = readProcessIdentity(record.pid);
  if (record.version === 2 && currentIdentity) {
    return currentIdentity === record.processIdentity;
  }

  const acquiredAtMs = Date.parse(record.acquiredAt);
  if (Number.isFinite(acquiredAtMs)) {
    const bootedAtMs = Date.now() - os.uptime() * 1_000;
    if (acquiredAtMs + BOOT_TIME_TOLERANCE_MS < bootedAtMs) {
      return false;
    }
  }

  // Identity lookup is best-effort. If it is unavailable, keep the existing
  // lock rather than risk running two backends against the same database.
  return processIsAlive(record.pid);
}

function recoveryClaimIsStale(
  recoveryPath: string,
  record: OwnershipRecord | null,
): boolean {
  if (record) {
    if (!recordBelongsToRunningProcess(record)) return true;
    // Recovery is a synchronous rename/delete critical section. A live claim
    // this old was suspended or abandoned and is safe to supersede after the
    // owner token is revalidated below.
    const acquiredAtMs = Date.parse(record.acquiredAt);
    return (
      Number.isFinite(acquiredAtMs) &&
      Date.now() - acquiredAtMs > RECOVERY_STALE_AFTER_MS
    );
  }

  try {
    return (
      Date.now() - fs.statSync(recoveryPath).mtimeMs > RECOVERY_STALE_AFTER_MS
    );
  } catch {
    return true;
  }
}

function removeObservedRecoveryClaim(
  recoveryPath: string,
  observed: OwnershipRecord | null,
): boolean {
  const current = readRecord(recoveryPath);
  if (observed ? current?.token !== observed.token : current !== null) {
    return false;
  }
  try {
    fs.rmSync(recoveryPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

function claimRecovery(
  recoveryPath: string,
  recoveryRecord: OwnershipRecord,
): boolean {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(recoveryPath, `${JSON.stringify(recoveryRecord)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = readRecord(recoveryPath);
      if (
        !recoveryClaimIsStale(recoveryPath, existing) ||
        !removeObservedRecoveryClaim(recoveryPath, existing)
      ) {
        return false;
      }
    }
  }
  return false;
}

function releaseRecoveryClaim(
  recoveryPath: string,
  recoveryRecord: OwnershipRecord,
): void {
  const current = readRecord(recoveryPath);
  if (current?.token === recoveryRecord.token) {
    fs.rmSync(recoveryPath, { force: true });
  }
}

function publishLock(lockPath: string, record: OwnershipRecord): boolean {
  const candidatePath = `${lockPath}.candidate-${record.pid}-${record.token}`;
  fs.mkdirSync(candidatePath, { mode: 0o700 });
  try {
    fs.writeFileSync(
      path.join(candidatePath, OWNER_FILE),
      `${JSON.stringify(record)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    try {
      fs.renameSync(candidatePath, lockPath);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST" || code === "ENOTEMPTY") return false;
      throw error;
    }
  } finally {
    fs.rmSync(candidatePath, { recursive: true, force: true });
  }
}

function recoverStaleLock(
  lockPath: string,
  staleRecord: OwnershipRecord,
): boolean {
  const recoveryPath = path.join(lockPath, RECOVERY_FILE);
  const recoveryRecord = createOwnershipRecord("Mains ownership recovery");
  if (!claimRecovery(recoveryPath, recoveryRecord)) return false;

  const quarantinePath = `${lockPath}.stale-${process.pid}-${recoveryRecord.token}`;
  let quarantined = false;
  try {
    const current = readRecord(path.join(lockPath, OWNER_FILE));
    if (
      !current ||
      current.token !== staleRecord.token ||
      recordBelongsToRunningProcess(current)
    ) {
      return false;
    }
    try {
      fs.renameSync(lockPath, quarantinePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    quarantined = true;
    return true;
  } finally {
    if (quarantined) {
      fs.rmSync(quarantinePath, { recursive: true, force: true });
    } else {
      releaseRecoveryClaim(recoveryPath, recoveryRecord);
    }
  }
}

/**
 * Claim exclusive ownership of a Mains database for one backend process.
 *
 * SQLite can coordinate individual writes, but two complete Mains backends
 * would also run schedulers, providers and automations against the same state.
 * This process lock makes that unsupported topology fail before SQLite opens.
 */
export function acquireDatabaseOwnership(
  databasePath: string,
  owner: string,
): DatabaseOwnership {
  if (isInMemoryDatabase(databasePath)) {
    return { lockPath: null, release() {} };
  }

  const resolvedDatabasePath = path.resolve(databasePath);
  const lockPath = databaseOwnershipPath(resolvedDatabasePath);
  const record = createOwnershipRecord(owner);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (publishLock(lockPath, record)) {
      let released = false;
      return {
        lockPath,
        release() {
          if (released) return;
          released = true;
          const current = readRecord(path.join(lockPath, OWNER_FILE));
          if (current?.token === record.token) {
            fs.rmSync(lockPath, { recursive: true, force: true });
          }
        },
      };
    }

    const existing = readRecord(path.join(lockPath, OWNER_FILE));
    if (!existing) {
      throw new DatabaseOwnershipError(
        `The Mains data ownership lock at "${lockPath}" is unreadable. ` +
          "If no Mains process is running, remove that lock and try again.",
      );
    }
    if (recordBelongsToRunningProcess(existing)) {
      throw new DatabaseOwnershipError(
        `Mains data at "${resolvedDatabasePath}" is already in use by ` +
          `${displayOwner(existing.owner)} (PID ${existing.pid}). Stop it before starting ${displayOwner(owner)}; ` +
          "Only one Mains backend can safely own the same data at a time.",
      );
    }
    if (!recoverStaleLock(lockPath, existing)) {
      continue;
    }
  }

  throw new DatabaseOwnershipError(
    `Could not claim Mains data at "${resolvedDatabasePath}" because another process is recovering its ownership lock. Try again.`,
  );
}
