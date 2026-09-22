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
import { writeServerState } from "./server-state";

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
  vi.unstubAllGlobals();
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

describe("runServerCli browser login", () => {
  it("prints a one-use link minted by the running server", async () => {
    const dataDir = makeDataDir();
    const stored = prepareStandaloneServerToken(dataDir);
    commitStandaloneServerToken(stored);
    writeServerState(dataDir, {
      schemaVersion: 1,
      pid: process.pid,
      host: "127.0.0.1",
      port: 8787,
      controlUrl: "http://127.0.0.1:8787",
      endpoints: ["https://mains.example"],
      appVersion: "1.0.0",
      startedAt: new Date().toISOString(),
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            link: "https://mains.example/#login=one-time",
            expiresAt: "2026-09-21T10:05:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runServerCli(["web", "--data-dir", dataDir]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "http://127.0.0.1:8787/__mains/admin/web-login",
    );
    expect(init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ baseUrl: "https://mains.example" }),
    });
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Bearer ${stored.token}`,
    );
    expect(log).toHaveBeenCalledWith(
      "https://mains.example/#login=one-time",
    );
  });
});
