import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireDatabaseOwnership,
  DatabaseOwnershipError,
  databaseOwnershipPath,
} from "./database-ownership";

const temporaryDirectories: string[] = [];

function temporaryDatabasePath(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "mains-database-owner-test-"),
  );
  temporaryDirectories.push(directory);
  return path.join(directory, "mains.db");
}

function writeRecord(
  filePath: string,
  record: {
    version: number;
    token: string;
    pid: number;
    owner: string;
    acquiredAt: string;
    processIdentity?: string;
  },
): void {
  fs.writeFileSync(filePath, `${JSON.stringify(record)}\n`);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("database ownership", () => {
  it("allows only one backend owner and releases cleanly", () => {
    const databasePath = temporaryDatabasePath();
    const desktop = acquireDatabaseOwnership(databasePath, "Mains Desktop");

    expect(() =>
      acquireDatabaseOwnership(databasePath, "Mains Server"),
    ).toThrow(DatabaseOwnershipError);
    expect(() =>
      acquireDatabaseOwnership(databasePath, "Mains Server"),
    ).toThrow(/Mains Desktop.*PID/u);

    desktop.release();
    const server = acquireDatabaseOwnership(databasePath, "Mains Server");
    expect(fs.existsSync(databaseOwnershipPath(databasePath))).toBe(true);
    server.release();
    expect(fs.existsSync(databaseOwnershipPath(databasePath))).toBe(false);
  });

  it("recovers an ownership record left by a dead process", () => {
    const databasePath = temporaryDatabasePath();
    const lockPath = databaseOwnershipPath(databasePath);
    fs.mkdirSync(lockPath);
    fs.writeFileSync(
      path.join(lockPath, "owner.json"),
      `${JSON.stringify({
        version: 1,
        token: "stale-owner",
        pid: 2_147_483_647,
        owner: "Mains Desktop",
        acquiredAt: "2026-01-01T00:00:00.000Z",
      })}\n`,
    );

    const server = acquireDatabaseOwnership(databasePath, "Mains Server");
    expect(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")).toContain(
      "Mains Server",
    );
    server.release();
  });

  it("recovers a legacy ownership record left before the current boot even if its PID was reused", () => {
    const databasePath = temporaryDatabasePath();
    const lockPath = databaseOwnershipPath(databasePath);
    fs.mkdirSync(lockPath);
    writeRecord(path.join(lockPath, "owner.json"), {
      version: 1,
      token: "pre-reboot-owner",
      pid: process.pid,
      owner: "Old Mains Desktop",
      acquiredAt: "2000-01-01T00:00:00.000Z",
    });

    const server = acquireDatabaseOwnership(databasePath, "Mains Server");
    expect(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")).toContain(
      "Mains Server",
    );
    server.release();
  });

  it("recovers when a live PID belongs to a different process instance", () => {
    const databasePath = temporaryDatabasePath();
    const lockPath = databaseOwnershipPath(databasePath);
    fs.mkdirSync(lockPath);
    writeRecord(path.join(lockPath, "owner.json"), {
      version: 2,
      token: "reused-pid-owner",
      pid: process.pid,
      owner: "Old Mains Desktop",
      acquiredAt: new Date().toISOString(),
      processIdentity: "a-different-process-instance",
    });

    const server = acquireDatabaseOwnership(databasePath, "Mains Server");
    expect(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")).toContain(
      "Mains Server",
    );
    server.release();
  });

  it("recovers when a dead recovery process left its claim behind", () => {
    const databasePath = temporaryDatabasePath();
    const lockPath = databaseOwnershipPath(databasePath);
    fs.mkdirSync(lockPath);
    writeRecord(path.join(lockPath, "owner.json"), {
      version: 1,
      token: "stale-owner",
      pid: 2_147_483_647,
      owner: "Crashed Mains Desktop",
      acquiredAt: "2026-01-01T00:00:00.000Z",
    });
    writeRecord(path.join(lockPath, "recovery.json"), {
      version: 1,
      token: "orphaned-recovery",
      pid: 2_147_483_647,
      owner: "Mains ownership recovery",
      acquiredAt: "2026-01-01T00:00:00.000Z",
    });

    const server = acquireDatabaseOwnership(databasePath, "Mains Server");
    expect(fs.existsSync(path.join(lockPath, "recovery.json"))).toBe(false);
    server.release();
  });

  it("recovers an old partial recovery claim", () => {
    const databasePath = temporaryDatabasePath();
    const lockPath = databaseOwnershipPath(databasePath);
    const recoveryPath = path.join(lockPath, "recovery.json");
    fs.mkdirSync(lockPath);
    writeRecord(path.join(lockPath, "owner.json"), {
      version: 1,
      token: "stale-owner",
      pid: 2_147_483_647,
      owner: "Crashed Mains Desktop",
      acquiredAt: "2026-01-01T00:00:00.000Z",
    });
    fs.writeFileSync(recoveryPath, "");
    const staleTime = new Date(Date.now() - 60_000);
    fs.utimesSync(recoveryPath, staleTime, staleTime);

    const server = acquireDatabaseOwnership(databasePath, "Mains Server");
    expect(fs.existsSync(recoveryPath)).toBe(false);
    server.release();
  });

  it("does not remove a recent partial recovery claim", () => {
    const databasePath = temporaryDatabasePath();
    const lockPath = databaseOwnershipPath(databasePath);
    const recoveryPath = path.join(lockPath, "recovery.json");
    fs.mkdirSync(lockPath);
    writeRecord(path.join(lockPath, "owner.json"), {
      version: 1,
      token: "stale-owner",
      pid: 2_147_483_647,
      owner: "Crashed Mains Desktop",
      acquiredAt: "2026-01-01T00:00:00.000Z",
    });
    fs.writeFileSync(recoveryPath, "");

    expect(() =>
      acquireDatabaseOwnership(databasePath, "Mains Server"),
    ).toThrow(/another process is recovering/u);
    expect(fs.existsSync(recoveryPath)).toBe(true);
  });

  it("does not steal a stale lock while a live process owns its recovery claim", () => {
    const identityDatabasePath = temporaryDatabasePath();
    const identityOwnership = acquireDatabaseOwnership(
      identityDatabasePath,
      "Recovery process",
    );
    const liveRecoveryRecord = fs.readFileSync(
      path.join(identityOwnership.lockPath!, "owner.json"),
      "utf8",
    );
    identityOwnership.release();

    const databasePath = temporaryDatabasePath();
    const lockPath = databaseOwnershipPath(databasePath);
    fs.mkdirSync(lockPath);
    writeRecord(path.join(lockPath, "owner.json"), {
      version: 1,
      token: "stale-owner",
      pid: 2_147_483_647,
      owner: "Crashed Mains Desktop",
      acquiredAt: "2026-01-01T00:00:00.000Z",
    });
    fs.writeFileSync(path.join(lockPath, "recovery.json"), liveRecoveryRecord);

    expect(() =>
      acquireDatabaseOwnership(databasePath, "Mains Server"),
    ).toThrow(/another process is recovering/u);
    expect(fs.readFileSync(path.join(lockPath, "recovery.json"), "utf8")).toBe(
      liveRecoveryRecord,
    );
  });

  it("does not create a filesystem lock for an in-memory database", () => {
    const ownership = acquireDatabaseOwnership(":memory:", "Mains Server");
    expect(ownership.lockPath).toBeNull();
    ownership.release();
  });
});
