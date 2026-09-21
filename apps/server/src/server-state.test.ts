import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearServerState,
  readServerState,
  serverStatePath,
  writeServerState,
  type StandaloneServerState,
} from "./server-state";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("standalone server state", () => {
  it("writes an owner-only state file and reads it back", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-state-test-"));
    directories.push(dataDir);
    const state: StandaloneServerState = {
      schemaVersion: 1,
      pid: 123,
      host: "0.0.0.0",
      port: 8787,
      controlUrl: "http://127.0.0.1:8787",
      endpoints: ["http://192.168.1.10:8787"],
      appVersion: "test",
      startedAt: "2026-09-21T10:00:00.000Z",
    };

    expect(writeServerState(dataDir, state)).toBe(serverStatePath(dataDir));
    expect(readServerState(dataDir)).toEqual(state);
    if (process.platform !== "win32") {
      expect(fs.statSync(serverStatePath(dataDir)).mode & 0o777).toBe(0o600);
    }
  });

  it("only removes state owned by the stopping process", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-state-test-"));
    directories.push(dataDir);
    writeServerState(dataDir, {
      schemaVersion: 1,
      pid: 321,
      host: "127.0.0.1",
      port: 8787,
      controlUrl: "http://127.0.0.1:8787",
      endpoints: [],
      appVersion: "test",
      startedAt: "2026-09-21T10:00:00.000Z",
    });

    clearServerState(dataDir, 123);
    expect(readServerState(dataDir)?.pid).toBe(321);
    clearServerState(dataDir, 321);
    expect(readServerState(dataDir)).toBeNull();
  });
});
