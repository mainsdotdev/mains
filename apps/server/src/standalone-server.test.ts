import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSubprotocols } from "@mains/contracts/ws-protocol";
import { parsePairingLink } from "@mains/contracts/backend";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import {
  startStandaloneServer,
  type StandaloneServer,
} from "./standalone-server";

const TOKEN = "standalone-integration-token";
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

async function start(): Promise<StandaloneServer> {
  return startStandaloneServer({
    host: "127.0.0.1",
    port: 0,
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
