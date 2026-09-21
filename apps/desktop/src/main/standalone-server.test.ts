import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { buildSubprotocols } from "../shared/ipc-kit/ws-protocol";
import {
  startStandaloneServer,
  type StandaloneServer,
} from "./standalone-server";

const TOKEN = "standalone-integration-token";
let server: StandaloneServer | null = null;
let dataDir: string | null = null;

function connect(port: number): Promise<WebSocket> {
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}`,
    buildSubprotocols(TOKEN),
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
    socket.send(JSON.stringify({ kind: "invoke", id, channel, args: [] }), (error) => {
      if (error) reject(error);
    });
  });
}

async function start(): Promise<StandaloneServer> {
  return startStandaloneServer({
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    dataDir: dataDir!,
    appVersion: "test-version",
    appRoot: path.resolve(__dirname, "../.."),
    resourcesPath: path.resolve(__dirname, "db"),
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
});
