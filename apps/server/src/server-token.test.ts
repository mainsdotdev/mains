import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readStandaloneServerToken,
  resolveStandaloneServerToken,
} from "./server-token";

const temporaryDirectories: string[] = [];
const explicitToken = "a".repeat(32);

function makeDataDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mains-token-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("resolveStandaloneServerToken", () => {
  it("persists and reuses a generated token", () => {
    const dataDir = makeDataDir();
    const first = resolveStandaloneServerToken(dataDir);
    const second = resolveStandaloneServerToken(dataDir);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.token).toBe(first.token);
    expect(readStandaloneServerToken(dataDir)).toBe(first.token);
    expect(second.path).toBe(first.path);
    expect(fs.readFileSync(first.path!, "utf8").trim()).toBe(first.token);
    if (process.platform !== "win32") {
      expect(fs.statSync(first.path!).mode & 0o777).toBe(0o600);
    }
  });

  it("does not create a token while only reading", () => {
    const dataDir = makeDataDir();
    expect(readStandaloneServerToken(dataDir)).toBeNull();
    expect(fs.existsSync(path.join(dataDir, "server-token"))).toBe(false);
  });

  it("rotates the persisted token", () => {
    const dataDir = makeDataDir();
    const first = resolveStandaloneServerToken(dataDir);
    const rotated = resolveStandaloneServerToken(dataDir, { rotate: true });

    expect(rotated.created).toBe(true);
    expect(rotated.token).not.toBe(first.token);
    expect(resolveStandaloneServerToken(dataDir).token).toBe(rotated.token);
  });

  it("uses an explicit token without writing it to disk", () => {
    const dataDir = makeDataDir();
    const result = resolveStandaloneServerToken(dataDir, {
      explicitToken,
    });

    expect(result).toEqual({
      token: explicitToken,
      path: null,
      created: false,
    });
    expect(fs.existsSync(path.join(dataDir, "server-token"))).toBe(false);
  });

  it("rejects conflicting or empty explicit token options", () => {
    const dataDir = makeDataDir();
    expect(() =>
      resolveStandaloneServerToken(dataDir, {
        explicitToken,
        rotate: true,
      }),
    ).toThrow("cannot be combined");
    expect(() =>
      resolveStandaloneServerToken(dataDir, { explicitToken: "  " }),
    ).toThrow("must not be empty");
  });
});
