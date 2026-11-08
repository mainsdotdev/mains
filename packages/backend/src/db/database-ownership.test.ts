import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function emulateWindowsDirectoryCollision(): void {
  const rename = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
    if (String(source).includes(".backend.lock.candidate-") && fs.existsSync(destination)) {
      throw Object.assign(new Error("Destination directory already exists"), { code: "EPERM" });
    }
    rename(source, destination);
  });
}

describe("database ownership", () => {
  it("rejects an actual live Desktop process and recovers its lock after a crash", async () => {
    const databasePath = temporaryDatabasePath(), lockPath = databaseOwnershipPath(databasePath);
    const child = spawn(process.execPath, ["-e", `
      const fs = require('node:fs'), path = require('node:path'), lock = process.argv[1];
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ version: 1, token: 'child-owner',
        pid: process.pid, owner: 'Mains Desktop', acquiredAt: new Date().toISOString() }));
      process.send('ready'); setInterval(() => {}, 1000);
    `, lockPath], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    try {
      await once(child, "message");
      expect(() => acquireDatabaseOwnership(databasePath, "Mains CLI")).toThrow(/already in use by Mains Desktop/);
    } finally { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
    const replacement = acquireDatabaseOwnership(databasePath, "Mains CLI"); replacement.release();
  });

  it.runIf(process.platform !== "win32")("shares ownership through a symlinked database file", () => {
    const databasePath = temporaryDatabasePath(), alias = path.join(path.dirname(databasePath), "alias.db");
    fs.writeFileSync(databasePath, ""); fs.symlinkSync(databasePath, alias);
    const owner = acquireDatabaseOwnership(databasePath, "Mains Desktop");
    let replacement: ReturnType<typeof acquireDatabaseOwnership> | undefined;
    try {
      expect(() => { replacement = acquireDatabaseOwnership(alias, "Mains CLI"); }).toThrow(/already in use/);
    } finally { replacement?.release(); owner.release(); }
  });

  it("shares ownership through a symlinked data directory", () => {
    const databasePath = temporaryDatabasePath(), directory = path.dirname(databasePath), alias = path.join(directory, "alias");
    fs.symlinkSync(directory, alias, process.platform === "win32" ? "junction" : "dir");
    const owner = acquireDatabaseOwnership(databasePath, "Mains Desktop");
    try {
      expect(() => acquireDatabaseOwnership(path.join(alias, "mains.db"), "Mains CLI")).toThrow(/already in use/);
    } finally { owner.release(); }
  });

  it("can retry releasing the same owner after a filesystem failure", () => {
    const databasePath = temporaryDatabasePath(), owner = acquireDatabaseOwnership(databasePath, "Mains Desktop");
    vi.spyOn(fs, "rmSync").mockImplementationOnce(() => { throw Object.assign(new Error("Lock is busy"), { code: "EBUSY" }); });
    expect(() => owner.release()).toThrow("Lock is busy");
    expect(() => acquireDatabaseOwnership(databasePath, "Mains CLI")).toThrow(/already in use/);
    owner.release();
    expect(fs.existsSync(databaseOwnershipPath(databasePath))).toBe(false);
  });

  it("does not expire a recovery claim belonging to a live process", () => {
    const identity = acquireDatabaseOwnership(temporaryDatabasePath(), "Live recovery");
    const recovery = JSON.parse(fs.readFileSync(path.join(identity.lockPath!, "owner.json"), "utf8"));
    identity.release(); recovery.acquiredAt = new Date(Date.now() - 60_000).toISOString();
    const databasePath = temporaryDatabasePath(), lockPath = databaseOwnershipPath(databasePath);
    fs.mkdirSync(lockPath);
    writeRecord(path.join(lockPath, "owner.json"), { version: 1, token: "dead", pid: 2_147_483_647,
      owner: "Crashed backend", acquiredAt: "2026-01-01T00:00:00.000Z" });
    const recoveryPath = path.join(lockPath, "recovery.json");
    fs.writeFileSync(recoveryPath, JSON.stringify(recovery));
    expect(() => acquireDatabaseOwnership(databasePath, "New backend")).toThrow(/another process is recovering/);
    expect(JSON.parse(fs.readFileSync(recoveryPath, "utf8"))).toEqual(recovery);
  });

  it("reports the live owner when Windows returns EPERM for a directory collision", () => {
    const databasePath = temporaryDatabasePath();
    const desktop = acquireDatabaseOwnership(databasePath, "Mains Desktop");
    emulateWindowsDirectoryCollision();
    expect(() => acquireDatabaseOwnership(databasePath, "Mains CLI"))
      .toThrow(/already in use by Mains Desktop/u);
    desktop.release();
  });

  it("recovers a dead owner when Windows returns EPERM for a directory collision", () => {
    const databasePath = temporaryDatabasePath();
    const lockPath = databaseOwnershipPath(databasePath);
    fs.mkdirSync(lockPath);
    writeRecord(path.join(lockPath, "owner.json"), {
      version: 1, token: "stale-owner", pid: 2_147_483_647,
      owner: "Mains Desktop", acquiredAt: "2026-01-01T00:00:00.000Z",
    });
    emulateWindowsDirectoryCollision();
    const desktop = acquireDatabaseOwnership(databasePath, "Mains Desktop");
    expect(JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")).pid).toBe(process.pid);
    desktop.release();
  });

  it("keeps genuine EPERM errors when the destination lock does not exist", () => {
    const databasePath = temporaryDatabasePath();
    const error = Object.assign(new Error("Permission denied"), { code: "EPERM" });
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw error; });
    expect(() => acquireDatabaseOwnership(databasePath, "Mains Desktop")).toThrow(error);
    expect(fs.readdirSync(path.dirname(databasePath))).toEqual([]);
  });

  it("allows only one backend owner and releases cleanly", () => {
    const databasePath = temporaryDatabasePath();
    const desktop = acquireDatabaseOwnership(databasePath, "Mains Desktop");

    expect(() =>
      acquireDatabaseOwnership(databasePath, "Mains CLI"),
    ).toThrow(DatabaseOwnershipError);
    expect(() =>
      acquireDatabaseOwnership(databasePath, "Mains CLI"),
    ).toThrow(
      /Mains Desktop.*PID.*Only one Mains backend can safely own the same data at a time/su,
    );

    desktop.release();
    const server = acquireDatabaseOwnership(databasePath, "Mains CLI");
    expect(fs.existsSync(databaseOwnershipPath(databasePath))).toBe(true);
    server.release();
    expect(fs.existsSync(databaseOwnershipPath(databasePath))).toBe(false);
  });

  it("uses current terminology for a lock written by an older CLI", () => {
    const databasePath = temporaryDatabasePath();
    const legacyCli = acquireDatabaseOwnership(databasePath, "Mains Server");

    expect(() =>
      acquireDatabaseOwnership(databasePath, "Mains Desktop"),
    ).toThrow(/already in use by Mains CLI.*before starting Mains Desktop/su);

    legacyCli.release();
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

    const server = acquireDatabaseOwnership(databasePath, "Mains CLI");
    expect(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")).toContain(
      "Mains CLI",
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

    const server = acquireDatabaseOwnership(databasePath, "Mains CLI");
    expect(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")).toContain(
      "Mains CLI",
    );
    server.release();
  });

  // Process-instance identity is currently available on macOS and Linux only.
  it.runIf(process.platform !== "win32")("recovers when a live PID belongs to a different process instance", () => {
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

    const server = acquireDatabaseOwnership(databasePath, "Mains CLI");
    expect(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")).toContain(
      "Mains CLI",
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

    const server = acquireDatabaseOwnership(databasePath, "Mains CLI");
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

    const server = acquireDatabaseOwnership(databasePath, "Mains CLI");
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
      acquireDatabaseOwnership(databasePath, "Mains CLI"),
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
      acquireDatabaseOwnership(databasePath, "Mains CLI"),
    ).toThrow(/another process is recovering/u);
    expect(fs.readFileSync(path.join(lockPath, "recovery.json"), "utf8")).toBe(
      liveRecoveryRecord,
    );
  });

  it("does not create a filesystem lock for an in-memory database", () => {
    const ownership = acquireDatabaseOwnership(":memory:", "Mains CLI");
    expect(ownership.lockPath).toBeNull();
    ownership.release();
  });
});
