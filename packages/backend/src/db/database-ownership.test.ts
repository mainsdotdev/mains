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

  it("does not create a filesystem lock for an in-memory database", () => {
    const ownership = acquireDatabaseOwnership(":memory:", "Mains Server");
    expect(ownership.lockPath).toBeNull();
    ownership.release();
  });
});
