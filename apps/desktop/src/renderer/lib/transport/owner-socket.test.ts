import { afterEach, expect, it } from "vitest";
import WebSocket from "ws";
import { startWsHost, type WsHost } from "@mains/backend/ipc-kit/ws-server-host";
import { registerHandler, unregisterHandler } from "@mains/backend/ipc-kit/handler-registry";
import { WsTransport, type WebSocketLike } from "./ws-transport";
import { ownerSocketFactory } from "./owner-socket";
import { createTestTls } from "../../../../../../packages/backend/test/connect-tls";

let host: WsHost | undefined;
let tls: ReturnType<typeof createTestTls> | undefined;
let transport: WsTransport | undefined;
afterEach(async () => {
  transport?.dispose();
  await host?.close();
  tls?.dispose();
  unregisterHandler("test:identity");
});

it.each(["loopback", "TLS"])("verifies the owner before dispatch and pins the identity over %s", async mode => {
  let id = "first";
  const token = "test-only-shared-owner-secret";
  tls = mode === "TLS" ? createTestTls() : undefined;
  host = await startWsHost({ port: 0, host: tls ? "0:0:0:0:0:0:0:1" : "127.0.0.1", tls, token, getBackendId: async () => id });
  const url = (tls ? "wss://[::1]:" : "ws://127.0.0.1:") + host.port;
  let calls = 0;
  registerHandler("test:identity", async () => ({ success: true, data: ++calls }));
  const offered: string[][] = [];
  const factory = ownerSocketFactory(token, undefined, (target, protocols) => {
    offered.push(protocols ?? []);
    return new WebSocket(target, protocols, { ca: tls?.cert }) as unknown as WebSocketLike;
  });
  transport = new WsTransport(url, { factory, reconnect: false });
  transport.connect();
  await expect(transport.invoke("test:identity")).resolves.toMatchObject({ data: 1 });
  transport.dispose();
  id = "replacement";
  transport = new WsTransport(url, { factory, reconnect: false });
  transport.connect();
  await expect(transport.invoke("test:identity")).rejects.toThrow();
  expect(calls).toBe(1);
  expect(offered).toHaveLength(2);
  expect(JSON.stringify(offered)).not.toContain(token);
  expect(offered[0]).not.toEqual(offered[1]);
});
