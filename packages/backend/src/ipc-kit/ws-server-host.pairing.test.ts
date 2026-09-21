import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startWsHost, type WsHost } from "./ws-server-host";
import { clearHandlers, registerHandler } from "./handler-registry";
import { buildSubprotocols } from "@mains/contracts/ws-protocol";

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

/** Resolves with the error `ws` raises when the server rejects the handshake. */
function rejected(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.once("error", (error) => resolve(error.message));
  });
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) =>
    ws.once("message", (data) => resolve(data.toString())),
  );
}

const SHARED_TOKEN = "shared-pairing-token";
const DEVICE_TOKEN = "device-token-for-d1";

async function verifyDeviceToken(token: string) {
  return token === DEVICE_TOKEN ? { deviceId: "d1" } : null;
}

describe("startWsHost — paired devices and POST /pair", () => {
  let host: WsHost | null = null;
  let client: WebSocket | null = null;

  afterEach(async () => {
    if (client && client.readyState === WebSocket.OPEN) client.close();
    client = null;
    if (host) await host.close();
    host = null;
    clearHandlers();
  });

  async function whoAmI(ws: WebSocket): Promise<unknown> {
    const responsePromise = nextMessage(ws);
    ws.send(
      JSON.stringify({ kind: "invoke", id: 1, channel: "who:ami", args: [] }),
    );
    return JSON.parse(await responsePromise).result.data;
  }

  it("accepts a device token and hands its deviceId to handlers", async () => {
    host = await startWsHost({
      port: 0,
      host: "127.0.0.1",
      token: SHARED_TOKEN,
      verifyDeviceToken,
    });
    registerHandler("who:ami", async (ctx) => ({ success: true, data: ctx }));

    client = new WebSocket(
      `ws://127.0.0.1:${host.port}`,
      buildSubprotocols(DEVICE_TOKEN),
    );
    await opened(client);

    expect(await whoAmI(client)).toEqual({
      clientId: expect.any(String),
      deviceId: "d1",
    });
  });

  it("still accepts the shared token, without a deviceId", async () => {
    host = await startWsHost({
      port: 0,
      host: "127.0.0.1",
      token: SHARED_TOKEN,
      verifyDeviceToken,
    });
    registerHandler("who:ami", async (ctx) => ({ success: true, data: ctx }));

    client = new WebSocket(
      `ws://127.0.0.1:${host.port}`,
      buildSubprotocols(SHARED_TOKEN),
    );
    await opened(client);

    expect(await whoAmI(client)).toEqual({ clientId: expect.any(String) });
  });

  it("rejects a token that is neither shared nor a known device", async () => {
    host = await startWsHost({
      port: 0,
      host: "127.0.0.1",
      token: SHARED_TOKEN,
      verifyDeviceToken,
    });

    client = new WebSocket(
      `ws://127.0.0.1:${host.port}`,
      buildSubprotocols("revoked-or-bogus"),
    );
    expect(await rejected(client)).toBe("Unexpected server response: 401");
  });

  it("refuses channels outside a device's allowlist before any handler runs", async () => {
    host = await startWsHost({
      port: 0,
      host: "127.0.0.1",
      token: SHARED_TOKEN,
      verifyDeviceToken: async (token) =>
        token === DEVICE_TOKEN
          ? { deviceId: "d1", channels: new Set(["who:ami"]) }
          : null,
    });
    let secretCalls = 0;
    registerHandler("who:ami", async (ctx) => ({ success: true, data: ctx }));
    registerHandler("secret:op", async () => {
      secretCalls += 1;
      return { success: true, data: "leaked" };
    });

    client = new WebSocket(
      `ws://127.0.0.1:${host.port}`,
      buildSubprotocols(DEVICE_TOKEN),
    );
    await opened(client);

    const refused = nextMessage(client);
    client.send(
      JSON.stringify({ kind: "invoke", id: 7, channel: "secret:op", args: [] }),
    );
    expect(JSON.parse(await refused)).toEqual({
      kind: "response",
      id: 7,
      result: {
        success: false,
        error: 'Channel "secret:op" is not available to paired devices',
      },
    });
    expect(secretCalls).toBe(0);

    expect(await whoAmI(client)).toEqual({
      clientId: expect.any(String),
      deviceId: "d1",
    });
  });

  it("disconnectDevice drops that device's live sockets and nobody else's", async () => {
    // Revoking is a DB write and device tokens are checked only at the
    // handshake, so without this an already-open socket keeps working.
    host = await startWsHost({
      port: 0,
      host: "127.0.0.1",
      token: SHARED_TOKEN,
      verifyDeviceToken,
    });
    registerHandler("who:ami", async (ctx) => ({ success: true, data: ctx }));

    const phone = new WebSocket(`ws://127.0.0.1:${host.port}`, buildSubprotocols(DEVICE_TOKEN));
    client = new WebSocket(`ws://127.0.0.1:${host.port}`, buildSubprotocols(SHARED_TOKEN));
    await Promise.all([opened(phone), opened(client)]);

    const phoneClosed = new Promise<void>((resolve) => phone.once("close", () => resolve()));
    expect(host.disconnectDevice("someone-else")).toBe(0);
    expect(host.disconnectDevice("d1")).toBe(1);
    await phoneClosed;

    expect(client.readyState).toBe(WebSocket.OPEN);
    expect(await whoAmI(client)).toEqual({ clientId: expect.any(String) });
  });

  describe("commands (idempotent mutations)", () => {
    function memoryReceipts() {
      const rows = new Map<string, string>();
      return {
        rows,
        store: {
          find: async (deviceId: string, commandId: string) =>
            rows.get(`${deviceId}:${commandId}`) ?? null,
          record: async (deviceId: string, commandId: string, _channel: string, result: string) => {
            rows.set(`${deviceId}:${commandId}`, result);
          },
        },
      };
    }

    async function commandHost(store: ReturnType<typeof memoryReceipts>["store"]) {
      return startWsHost({
        port: 0,
        host: "127.0.0.1",
        token: SHARED_TOKEN,
        verifyDeviceToken: async (token) =>
          token === DEVICE_TOKEN
            ? {
                deviceId: "d1",
                channels: new Set(["who:ami"]),
                commandChannels: new Set(["runs:continue"]),
              }
            : null,
        commandReceipts: store,
      });
    }

    function invoke(ws: WebSocket, id: number, commandId?: string): Promise<string> {
      const response = nextMessage(ws);
      ws.send(
        JSON.stringify({
          kind: "invoke",
          id,
          channel: "runs:continue",
          args: [{ runId: "r1" }],
          ...(commandId ? { commandId } : {}),
        }),
      );
      return response;
    }

    it("runs a command once and replays its receipt for the same commandId", async () => {
      const { store, rows } = memoryReceipts();
      host = await commandHost(store);
      let calls = 0;
      registerHandler("runs:continue", async () => {
        calls += 1;
        return { success: true, data: { call: calls, at: new Date("2026-08-25T10:00:00Z") } };
      });

      client = new WebSocket(`ws://127.0.0.1:${host.port}`, buildSubprotocols(DEVICE_TOKEN));
      await opened(client);

      const first = JSON.parse(await invoke(client, 1, "cmd-1"));
      const again = JSON.parse(await invoke(client, 2, "cmd-1"));

      expect(calls).toBe(1);
      expect(first.result).toEqual({
        success: true,
        data: { call: 1, at: { $date: "2026-08-25T10:00:00.000Z" } },
      });
      expect(again.result).toEqual(first.result);
      expect(again.id).toBe(2);
      expect(rows.size).toBe(1);

      // A different id is a different command.
      JSON.parse(await invoke(client, 3, "cmd-2"));
      expect(calls).toBe(2);
    });

    it("replays across a new connection — the retry after a drop", async () => {
      const { store } = memoryReceipts();
      host = await commandHost(store);
      let calls = 0;
      registerHandler("runs:continue", async () => ({ success: true, data: ++calls }));

      client = new WebSocket(`ws://127.0.0.1:${host.port}`, buildSubprotocols(DEVICE_TOKEN));
      await opened(client);
      const first = JSON.parse(await invoke(client, 1, "cmd-1"));
      client.close();

      const second = new WebSocket(`ws://127.0.0.1:${host.port}`, buildSubprotocols(DEVICE_TOKEN));
      await opened(second);
      const retry = JSON.parse(await invoke(second, 1, "cmd-1"));
      second.close();

      expect(calls).toBe(1);
      expect(retry.result).toEqual(first.result);
    });

    it("holds a concurrent retry until the first attempt finishes", async () => {
      const { store } = memoryReceipts();
      host = await commandHost(store);
      let calls = 0;
      let release: (() => void) | null = null;
      registerHandler("runs:continue", async () => {
        calls += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { success: true, data: `done-${calls}` };
      });

      client = new WebSocket(`ws://127.0.0.1:${host.port}`, buildSubprotocols(DEVICE_TOKEN));
      await opened(client);

      const replies: string[] = [];
      const gotTwo = new Promise<void>((resolve) => {
        client!.on("message", (data) => {
          replies.push(data.toString());
          if (replies.length === 2) resolve();
        });
      });
      client.send(JSON.stringify({ kind: "invoke", id: 1, channel: "runs:continue", args: [], commandId: "cmd-1" }));
      client.send(JSON.stringify({ kind: "invoke", id: 2, channel: "runs:continue", args: [], commandId: "cmd-1" }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls).toBe(1);
      release!();
      await gotTwo;

      const results = replies.map((r) => JSON.parse(r).result);
      expect(results).toEqual([
        { success: true, data: "done-1" },
        { success: true, data: "done-1" },
      ]);
    });

    it("refuses a command without a commandId", async () => {
      const { store } = memoryReceipts();
      host = await commandHost(store);
      let calls = 0;
      registerHandler("runs:continue", async () => ({ success: true, data: ++calls }));

      client = new WebSocket(`ws://127.0.0.1:${host.port}`, buildSubprotocols(DEVICE_TOKEN));
      await opened(client);

      expect(JSON.parse(await invoke(client, 1)).result).toEqual({
        success: false,
        error: 'Channel "runs:continue" requires a commandId from paired devices',
      });
      expect(calls).toBe(0);
    });

    it("leaves shared-token clients alone: no device, no receipts", async () => {
      const { store, rows } = memoryReceipts();
      host = await commandHost(store);
      let calls = 0;
      registerHandler("runs:continue", async () => ({ success: true, data: ++calls }));

      client = new WebSocket(`ws://127.0.0.1:${host.port}`, buildSubprotocols(SHARED_TOKEN));
      await opened(client);
      await invoke(client, 1, "cmd-1");
      await invoke(client, 2, "cmd-1");

      expect(calls).toBe(2);
      expect(rows.size).toBe(0);
    });
  });

  describe("POST /pair", () => {
    it("routes the JSON body through the pairDevice hook", async () => {
      host = await startWsHost({
        port: 0,
        host: "127.0.0.1",
        token: SHARED_TOKEN,
        pairDevice: async (body) => ({ echoed: body }),
      });

      const res = await fetch(`http://127.0.0.1:${host.port}/pair`, {
        method: "POST",
        body: JSON.stringify({ code: "abc", deviceName: "Phone" }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect(await res.json()).toEqual({
        echoed: { code: "abc", deviceName: "Phone" },
      });
    });

    it("turns a hook failure into a 400 with the message", async () => {
      host = await startWsHost({
        port: 0,
        host: "127.0.0.1",
        token: SHARED_TOKEN,
        pairDevice: async () => {
          throw new Error("Pairing code is invalid or has expired");
        },
      });

      const res = await fetch(`http://127.0.0.1:${host.port}/pair`, {
        method: "POST",
        body: JSON.stringify({ code: "abc" }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Pairing code is invalid or has expired",
      });
    });

    it("rejects a body that is not JSON", async () => {
      host = await startWsHost({
        port: 0,
        host: "127.0.0.1",
        token: SHARED_TOKEN,
        pairDevice: async (body) => body,
      });

      const res = await fetch(`http://127.0.0.1:${host.port}/pair`, {
        method: "POST",
        body: "{not json",
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Request body is not valid JSON",
      });
    });

    it("is absent when no pairDevice hook is configured", async () => {
      host = await startWsHost({ port: 0, host: "127.0.0.1", token: SHARED_TOKEN });

      const res = await fetch(`http://127.0.0.1:${host.port}/pair`, {
        method: "POST",
        body: "{}",
      });

      expect(res.status).toBe(426);
    });
  });
});
