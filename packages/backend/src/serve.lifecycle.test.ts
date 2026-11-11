import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DatabaseClient from "./db/client";
import { databaseOwnershipPath } from "./db/database-ownership";
import { configureIpcMainAdapter } from "./ipc-kit/ipc-main";
import { registeredChannels } from "./ipc-kit/handler-registry";
import { installTestBackendRuntime } from "../test/backend-runtime";
import { startBackendServer, type BackendServer, type ServeOptions } from "./serve";
import { withWorkspaceIntake } from "./modules/workspace/workspace-intake-lifecycle";
import { recordKey, transitionRecord } from "./runtime/record-lifecycle";
import { atlasService } from "./modules/atlas";
import { atlasBookmarks } from "./modules/atlas/atlas.bookmarks";
import { terminalService } from "./modules/terminal";
import * as providers from "./modules/providers";
import { readUsagePrices } from "./modules/stats/stats.pricing";

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
  it("retires price refresh before releasing the host and ignores its late network response", async () => {
    const entered = deferred(); let finish!: (response: Response) => void; let signal: AbortSignal | undefined;
    const response = new Promise<Response>((resolve) => { finish = resolve; });
    vi.stubGlobal("fetch", vi.fn((_url, init) => { signal = init?.signal ?? undefined; entered.resolve(); return response; }));
    let reading: ReturnType<typeof readUsagePrices> | undefined;
    try {
      server = await start(); reading = readUsagePrices(); await entered.promise; await server.close();
      expect(signal?.aborted).toBe(true);
      expect((await readUsagePrices()).pricing.status).toBe("unavailable");
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      finish(new Response(JSON.stringify({ model: { input_cost_per_token: 1, output_cost_per_token: 1 } })));
      await reading; await new Promise<void>((resolve) => setImmediate(resolve)); vi.unstubAllGlobals();
    }
    expect(fs.existsSync(path.join(directory, "usage", "model-prices.json"))).toBe(false);
  });

  it("drains provider cleanup despite a failed terminal stop and retains database ownership for retry", async () => {
    server = await start();
    const entered = deferred(), gate = deferred();
    const terminal = vi.spyOn(terminalService, "destroyAll").mockImplementationOnce(() => { throw new Error("Native stop failed"); });
    const adapters = vi.spyOn(providers, "shutdownAllWorkAdapters").mockImplementationOnce(async () => { entered.resolve(); await gate.promise; });
    const closing = server.close().catch((error: unknown) => error);
    try {
      await entered.promise;
      expect(DatabaseClient.getInstance().isReady()).toBe(true);
      gate.resolve();
      expect(await closing).toBeInstanceOf(Error);
      expect(DatabaseClient.getInstance().isReady()).toBe(true);
      expect(fs.existsSync(databaseOwnershipPath(path.join(directory, "mains.db")))).toBe(true);
    } finally { gate.resolve(); await closing; terminal.mockRestore(); adapters.mockRestore(); }
    await server.close();
    expect(DatabaseClient.getInstance().isReady()).toBe(false);
  });
  it("drains Atlas preparations before closing SQLite and prevents a late bookmark write", async () => {
    server = await start();
    const gate = deferred(), entered = deferred();
    const preferences = vi.spyOn(atlasBookmarks, "preferences").mockImplementationOnce(async () => {
      entered.resolve(); await gate.promise; return { enabled: false, providerId: "", model: "" };
    });
    const saving = atlasService.saveBookmark({ accountId: "default", url: "https://example.com" });
    const outcome = saving.then(() => "saved", (error: Error) => error.message);
    await entered.promise;
    let closed = false;
    const closing = server.close().then(() => { closed = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      expect(DatabaseClient.getInstance().isReady()).toBe(true);
      expect(fs.existsSync(databaseOwnershipPath(path.join(directory, "mains.db")))).toBe(true);
    } finally { gate.resolve(); await outcome; await closing; preferences.mockRestore(); }
    expect(await outcome).toContain("stopping");
    expect(DatabaseClient.getInstance().isReady()).toBe(false);
    server = await start();
    expect(atlasService.list({ accountId: "default", kind: "bookmark" })).toEqual([]);
  });
  it("drains accepted record side effects and their child cleanup before releasing SQLite", async () => {
    server = await start(); const gate = deferred(); let childFinished = false;
    await transitionRecord(recordKey("workspace", "retiring"), "archive", async ({ hold }) => {
      hold(gate.promise.then(() => transitionRecord(recordKey("run", "child"), "delete", async () => { childFinished = true; })));
    });
    const closing = server.close(); let closed = false; void closing.then(() => { closed = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false); expect(DatabaseClient.getInstance().isReady()).toBe(true);
      await expect(transitionRecord(recordKey("run", "new"), "delete", async () => {})).rejects.toThrow("shutting down");
    } finally { gate.resolve(); await closing; }
    expect(childFinished).toBe(true); expect(DatabaseClient.getInstance().isReady()).toBe(false);
  });

  it("keeps the database lease until accepted workspace registration drains", async () => {
    server = await start();
    const gate = deferred();
    const accepted = withWorkspaceIntake({ accountId: "default", source: { kind: "folder", path: directory } }, async () => { await gate.promise; return "registered"; });
    const closing = server.close(); let closed = false; void closing.then(() => { closed = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      expect(DatabaseClient.getInstance().isReady()).toBe(true);
      expect(fs.existsSync(databaseOwnershipPath(path.join(directory, "mains.db")))).toBe(true);
    } finally { gate.resolve(); await accepted; await closing; }
    expect(DatabaseClient.getInstance().isReady()).toBe(false);
  });

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
