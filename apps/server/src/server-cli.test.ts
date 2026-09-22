import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startStandaloneServer: vi.fn(),
}));

vi.mock("./standalone-server", () => ({
  startStandaloneServer: mocks.startStandaloneServer,
}));

import { runServerCli } from "./server-cli";
import {
  commitStandaloneServerToken,
  prepareStandaloneServerToken,
  readStandaloneServerToken,
} from "./server-token";

const temporaryDirectories: string[] = [];

function makeDataDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mains-cli-test-"));
  temporaryDirectories.push(root);
  return path.join(root, "data");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("runServerCli argument validation", () => {
  it("rejects a missing token value before creating a token or starting a server", async () => {
    const dataDir = makeDataDir();

    await expect(
      runServerCli([
        "serve",
        "--token",
        "--lan",
        "--data-dir",
        dataDir,
      ]),
    ).rejects.toThrow("--token requires a value");

    expect(readStandaloneServerToken(dataDir)).toBeNull();
    expect(mocks.startStandaloneServer).not.toHaveBeenCalled();
  });
});

describe("runServerCli token rotation", () => {
  it("keeps the stored token when server startup fails", async () => {
    const dataDir = makeDataDir();
    const original = prepareStandaloneServerToken(dataDir);
    commitStandaloneServerToken(original);
    mocks.startStandaloneServer.mockRejectedValueOnce(
      new Error("Mains data is already owned"),
    );

    await expect(
      runServerCli([
        "serve",
        "--rotate-token",
        "--data-dir",
        dataDir,
        "--no-pairing",
      ]),
    ).rejects.toThrow("Mains data is already owned");

    expect(readStandaloneServerToken(dataDir)).toBe(original.token);
  });

  it("commits the rotated token only after server startup succeeds", async () => {
    const dataDir = makeDataDir();
    const original = prepareStandaloneServerToken(dataDir);
    commitStandaloneServerToken(original);
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.startStandaloneServer.mockImplementationOnce(async () => {
      expect(readStandaloneServerToken(dataDir)).toBe(original.token);
      return {
        dataDir,
        port: 8787,
        tailscaleUrl: null,
        close,
      };
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(process, "once").mockReturnValue(process);

    await runServerCli([
      "serve",
      "--rotate-token",
      "--data-dir",
      dataDir,
      "--no-pairing",
    ]);

    expect(readStandaloneServerToken(dataDir)).not.toBe(original.token);
    expect(close).not.toHaveBeenCalled();
  });

  it("closes the newly started server when persisting the token fails", async () => {
    const dataDir = makeDataDir();
    const original = prepareStandaloneServerToken(dataDir);
    commitStandaloneServerToken(original);
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.startStandaloneServer.mockResolvedValueOnce({
      dataDir,
      port: 8787,
      tailscaleUrl: null,
      close,
    });
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    await expect(
      runServerCli([
        "serve",
        "--rotate-token",
        "--data-dir",
        dataDir,
        "--no-pairing",
      ]),
    ).rejects.toThrow("disk full");

    expect(close).toHaveBeenCalledOnce();
    expect(readStandaloneServerToken(dataDir)).toBe(original.token);
  });
});
