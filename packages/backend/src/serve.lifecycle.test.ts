import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DatabaseClient from "./db/client";
import { databaseOwnershipPath } from "./db/database-ownership";
import { configureIpcMainAdapter } from "./ipc-kit/ipc-main";
import { registeredChannels } from "./ipc-kit/handler-registry";
import { installTestBackendRuntime } from "../test/backend-runtime";
import { startBackendServer, type BackendServer, type ServeOptions } from "./serve";

let directory: string, restoreRuntime: () => void, restoreIpc: () => void;
let server: BackendServer | undefined, retry: (() => Promise<void>) | undefined;
const start = (options: ServeOptions = {}) => startBackendServer({ host: "127.0.0.1", port: 0, token: "host-lifecycle-test", webRoot: null, ...options });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "mains-host-lifecycle-"));
  restoreRuntime = installTestBackendRuntime({ getPath: () => directory });
  restoreIpc = configureIpcMainAdapter(null);
});
afterEach(async () => {
  await retry?.(); retry = undefined;
  await server?.close(); server = undefined;
  await DatabaseClient.reset(); restoreIpc(); restoreRuntime(); fs.rmSync(directory, { recursive: true, force: true });
});

describe("backend host acquisition and shutdown", () => {
  it("retires a pending host start and cleans a late database initialization before another start", async () => {
    const ready = deferred(), entered = deferred(), cancellation = new AbortController();
    const restoreReady = installTestBackendRuntime({ getPath: () => directory, whenReady: () => { entered.resolve(); return ready.promise; } });
    try {
      const opening = start({ signal: cancellation.signal }); await entered.promise;
      await expect(start()).rejects.toThrow(/already|own/);
      cancellation.abort(); ready.resolve();
      await expect(opening).rejects.toThrow(/cancel|clos/i);
      expect(registeredChannels()).toEqual([]);
      expect(fs.existsSync(databaseOwnershipPath(path.join(directory, "mains.db")))).toBe(false);
      server = await start();
    } finally { ready.resolve(); restoreReady(); }
  });

  it("shares explicit and signaled close and leaves the next host's handlers intact", async () => {
    const cancellation = new AbortController(); server = await start({ signal: cancellation.signal });
    const old = server; cancellation.abort();
    const closing = old.close(); expect(old.close()).toBe(closing); await closing;
    server = await start();
    await old.close();
    expect(registeredChannels()).toContain("backend:describe");
  });

  it("retains failed startup cleanup and its database lease until the cleanup can be retried", async () => {
    let registered = 0, broken = true;
    const restoreBroken = configureIpcMainAdapter({
      handle() { if (++registered === 2) throw new Error("Injected registration failure"); },
      removeHandler() { if (broken) throw new Error("Injected adapter cleanup failure"); },
    });
    try {
      const failure = await start().catch((error: unknown) => error);
      expect(failure).toHaveProperty("errors", expect.arrayContaining([
        expect.objectContaining({ message: "Injected registration failure" }),
        expect.objectContaining({ message: "Injected adapter cleanup failure" }),
      ]));
      expect(fs.existsSync(databaseOwnershipPath(path.join(directory, "mains.db")))).toBe(true);
      await expect(start()).rejects.toThrow(/already|own/);
      expect(failure).toHaveProperty("close", expect.any(Function));
      retry = (failure as { close: () => Promise<void> }).close;
      broken = false; await retry(); retry = undefined;
      expect(registeredChannels()).toEqual([]);
      expect(fs.existsSync(databaseOwnershipPath(path.join(directory, "mains.db")))).toBe(false);
    } finally { broken = false; restoreBroken(); }
    server = await start();
  });
});
