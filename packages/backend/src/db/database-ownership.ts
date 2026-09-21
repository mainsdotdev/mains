import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const OWNER_FILE = "owner.json";
const RECOVERY_FILE = "recovery.json";

interface OwnershipRecord {
  version: 1;
  token: string;
  pid: number;
  owner: string;
  acquiredAt: string;
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
  const record = value as Partial<OwnershipRecord>;
  return (
    record.version === 1 &&
    typeof record.token === "string" &&
    Number.isInteger(record.pid) &&
    typeof record.owner === "string" &&
    typeof record.acquiredAt === "string"
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
  const recoveryRecord: OwnershipRecord = {
    version: 1,
    token: crypto.randomUUID(),
    pid: process.pid,
    owner: "Mains ownership recovery",
    acquiredAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(recoveryPath, `${JSON.stringify(recoveryRecord)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }

  const quarantinePath = `${lockPath}.stale-${process.pid}-${recoveryRecord.token}`;
  try {
    const current = readRecord(path.join(lockPath, OWNER_FILE));
    if (
      !current ||
      current.token !== staleRecord.token ||
      processIsAlive(current.pid)
    ) {
      return false;
    }
    fs.renameSync(lockPath, quarantinePath);
    return true;
  } finally {
    fs.rmSync(quarantinePath, { recursive: true, force: true });
    try {
      const current = readRecord(path.join(lockPath, OWNER_FILE));
      if (current?.token === staleRecord.token) {
        fs.rmSync(recoveryPath, { force: true });
      }
    } catch {
      // A competing process may have replaced the stale lock.
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
  const record: OwnershipRecord = {
    version: 1,
    token: crypto.randomUUID(),
    pid: process.pid,
    owner,
    acquiredAt: new Date().toISOString(),
  };

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
          "If no Mains Desktop or Mains Server process is running, remove that lock and try again.",
      );
    }
    if (processIsAlive(existing.pid)) {
      throw new DatabaseOwnershipError(
        `Mains data at "${resolvedDatabasePath}" is already in use by ` +
          `${existing.owner} (PID ${existing.pid}). Stop it before starting ${owner}; ` +
          "Desktop and Server cannot safely own the same data at the same time.",
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
