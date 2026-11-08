import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSubprotocols } from "@mains/contracts/ws-protocol";
import { parsePairingLink } from "@mains/contracts/backend";
import WebSocket from "ws";
import { createServer, type AddressInfo } from "node:net";
import { once } from "node:events";
import { getSqlite } from "@mains/backend/db/client";
import { databaseOwnershipPath } from "@mains/backend/db/database-ownership";
import { getBackendRuntime } from "@mains/backend/runtime/backend-runtime";
import { registerHandler, unregisterHandler } from "@mains/backend/ipc-kit/handler-registry";
import { afterEach, describe, expect, it } from "vitest";
import {
  startStandaloneServer,
  type StandaloneServer,
} from "./standalone-server";

const TOKEN = "standalone-integration-token";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
let server: StandaloneServer | null = null;
let dataDir: string | null = null;

function connect(port: number, token = TOKEN): Promise<WebSocket> {
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}`,
    buildSubprotocols(token),
  );
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function invoke(socket: WebSocket, id: number, channel: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString());
      if (message.kind !== "response" || message.id !== id) return;
      socket.off("message", onMessage);
      resolve(message.result);
    };
    socket.on("message", onMessage);
    socket.send(
      JSON.stringify({ kind: "invoke", id, channel, args: [] }),
      (error) => {
        if (error) reject(error);
      },
    );
  });
}

async function start(port = 0, signal?: AbortSignal): Promise<StandaloneServer> {
  return startStandaloneServer({
    host: "127.0.0.1",
    port,
    signal,
    token: TOKEN,
    dataDir: dataDir!,
    appVersion: "test-version",
    appRoot: path.resolve(__dirname, ".."),
    resourcesPath: path.resolve(__dirname, "../../../packages/backend/src/db"),
    webRoot: null,
  });
}

afterEach(async () => {
  if (server) await server.close();
  server = null;
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  dataDir = null;
});

describe("standalone Mains server", () => {
  it("does not acquire resources for a canceled start and allows a later start", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-server-test-"));
    const cancellation = new AbortController(); cancellation.abort();
    let unexpected: StandaloneServer | undefined;
    try {
      await expect(start(0, cancellation.signal).then((value) => { unexpected = value; })).rejects.toThrow(/cancel|abort|clos/i);
    } finally { await unexpected?.close(); }
    expect(fs.existsSync(databaseOwnershipPath(path.join(dataDir, "mains.db")))).toBe(false);
    server = await start();
  });

  it("drains an accepted WebSocket write before closing SQLite and releasing its lock", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-server-test-")); server = await start();
    const entered = deferred(), gate = deferred(), finished = deferred(); let writeError: unknown;
    registerHandler("test:drain-write", async () => {
      entered.resolve(); await gate.promise;
      try { getSqlite().prepare("UPDATE accounts SET bio='drained before close' WHERE id='default'").run(); }
      catch (error) { writeError = error; }
      finally { finished.resolve(); }
      return { success: true, data: null };
    });
    const socket = await connect(server.port);
    socket.send(JSON.stringify({ kind: "invoke", id: 44, channel: "test:drain-write", args: [] }));
    await entered.promise;
    const disconnected = once(socket, "close"); let closed = false;
    const closing = server.close().then(() => { closed = true; });
    try {
      await disconnected; await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
    } finally { gate.resolve(); await finished.promise; await closing; unregisterHandler("test:drain-write"); }
    expect(writeError).toBeUndefined();
    server = await start();
    const reconnected = await connect(server.port);
    expect(await invoke(reconnected, 45, "account:get")).toMatchObject({ success: true, data: { bio: "drained before close" } }); reconnected.close();
  });

  it("rolls back a failed network bind and can start against the same database afterwards", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-server-test-"));
    const occupied = createServer(); occupied.listen(0, "127.0.0.1"); await once(occupied, "listening");
    try {
      await expect(start((occupied.address() as AddressInfo).port)).rejects.toThrow(/EADDRINUSE|address already in use/);
      expect(fs.existsSync(databaseOwnershipPath(path.join(dataDir, "mains.db")))).toBe(false);
      server = await start();
      const socket = await connect(server.port);
      expect(await invoke(socket, 43, "backend:describe")).toMatchObject({ success: true }); socket.close();
    } finally { await new Promise<void>((resolve) => occupied.close(() => resolve())); }
  });

  it("retains runtime and database ownership after failed close and can finish the same close on retry", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-server-test-"));
    server = await start();
    const reader = getSqlite().prepare("SELECT * FROM accounts").iterate(); reader.next();
    try {
      await expect(server.close()).rejects.toThrow();
      expect(getBackendRuntime().getPath("userData")).toBe(dataDir);
      expect(fs.existsSync(databaseOwnershipPath(path.join(dataDir, "mains.db")))).toBe(true);
      await expect(start()).rejects.toThrow(/already|own/);
    } finally { reader.return?.(); }
    await server.close();
    expect(fs.existsSync(databaseOwnershipPath(path.join(dataDir, "mains.db")))).toBe(false);
    server = await start();
    const socket = await connect(server.port);
    expect(await invoke(socket, 42, "backend:describe")).toMatchObject({ success: true }); socket.close();
  });

  it("rejects a second in-process host without disturbing the running server", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-server-test-"));
    server = await start();
    let duplicate: StandaloneServer | undefined;
    try {
      await expect(start().then((value) => { duplicate = value; })).rejects.toThrow(/already|active|own/i);
      const socket = await connect(server.port);
      expect(await invoke(socket, 41, "backend:describe")).toMatchObject({ success: true, data: { appVersion: "test-version" } });
      socket.close();
    } finally { await duplicate?.close(); }
  });

  it("serves real handlers and restarts against its persisted database", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-server-test-"));
    server = await start();

    let socket = await connect(server.port);
    const firstDescription = await invoke(socket, 1, "backend:describe");
    const account = await invoke(socket, 2, "account:get");
    expect(firstDescription).toMatchObject({
      success: true,
      data: { appVersion: "test-version", protocolVersion: 1 },
    });
    expect(firstDescription.data.capabilities).toEqual(
      expect.arrayContaining(["pullRequests", "runs", "workspace"]),
    );
    expect(account.success).toBe(true);
    socket.close();

    const backendId = firstDescription.data.backendId;
    await server.close();
    server = await start();
    socket = await connect(server.port);
    const restartedDescription = await invoke(socket, 3, "backend:describe");
    expect(restartedDescription.data.backendId).toBe(backendId);
    expect(fs.existsSync(path.join(dataDir, "mains.db"))).toBe(true);
    socket.close();
  });

  it("mints a one-time link and persists the phone's device session", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-server-test-"));
    server = await start();
    const baseUrl = `http://127.0.0.1:${server.port}`;

    const minted = await fetch(`${baseUrl}/__mains/admin/pairing-code`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ endpoints: [baseUrl] }),
    });
    expect(minted.status).toBe(200);
    const pairing = (await minted.json()) as {
      code: string;
      link: string;
    };
    expect(pairing.link).toContain("mains://pair#");
    expect(parsePairingLink(pairing.link)).toMatchObject({
      code: pairing.code,
      endpoints: [baseUrl],
    });

    const paired = await fetch(`${baseUrl}/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: pairing.code,
        deviceName: "Test Phone",
        platform: "ios",
        appVersion: "test-mobile",
      }),
    });
    expect(paired.status).toBe(200);
    const device = (await paired.json()) as {
      deviceId: string;
      deviceToken: string;
    };
    expect(device.deviceToken).toEqual(expect.any(String));

    let socket = await connect(server.port, device.deviceToken);
    expect(await invoke(socket, 10, "backend:describe")).toMatchObject({
      success: true,
      data: { appVersion: "test-version" },
    });
    socket.close();

    await server.close();
    server = await start();
    socket = await connect(server.port, device.deviceToken);
    expect(await invoke(socket, 11, "backend:describe")).toMatchObject({
      success: true,
    });

    const currentBaseUrl = `http://127.0.0.1:${server.port}`;
    const headers = { Authorization: `Bearer ${TOKEN}` };
    const listed = await fetch(
      `${currentBaseUrl}/__mains/admin/devices`,
      { headers },
    );
    expect(await listed.json()).toEqual([
      expect.objectContaining({ id: device.deviceId, name: "Test Phone" }),
    ]);

    const closed = new Promise<void>((resolve) =>
      socket.once("close", () => resolve()),
    );
    const revoked = await fetch(
      `${currentBaseUrl}/__mains/admin/devices/${device.deviceId}`,
      { method: "DELETE", headers },
    );
    expect(revoked.status).toBe(200);
    await closed;
    await expect(connect(server.port, device.deviceToken)).rejects.toThrow(
      "Unexpected server response: 401",
    );
  });
});
