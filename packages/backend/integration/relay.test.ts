import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { createRelaySocket } from "@mains/relay/socket";
import { relayPublicKey } from "@mains/relay/crypto";
import { type PairDeviceResult } from "@mains/contracts/backend";
import { CHANNELS } from "@mains/contracts/channels";
import { ok } from "@mains/contracts/service-response";
import { WsTransport } from "../../../apps/mobile/src/backend/ws-transport";
import { startWsHost, type VerifiedDevice, type WsHost } from "../src/ipc-kit/ws-server-host";
import { clearHandlers, registerHandler } from "../src/ipc-kit/handler-registry";
import { emit } from "../src/ipc-kit/event-bus";

const binary = process.env.MAINS_RELAY_BINARY;
const routingSecret = "integration-test-private-relay-routing-secret";

async function until(check: () => boolean | Promise<boolean>, timeout = 6000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for relay state");
}

describe.skipIf(!binary)("real Go relay and paired Mains application transport", () => {
  let temporary: string, port: number, relayProcess: ChildProcess | undefined, host: WsHost | undefined;
  const transports: WsTransport[] = [];
  const credentials = new Map<string, VerifiedDevice>();
  const wire: string[] = [];
  let nextDevice = 0;

  async function bootRelay() {
    relayProcess = spawn(binary!, ["-listen", `127.0.0.1:${port}`, "-secret-file", path.join(temporary, "routing.secret")], { stdio: "ignore" });
    await until(async () => {
      try { return (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { return false; }
    });
  }
  async function stopRelay() {
    if (!relayProcess || relayProcess.exitCode !== null) return;
    const child = relayProcess;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
    await exited; clearTimeout(timer); relayProcess = undefined;
  }
  async function pair(): Promise<PairDeviceResult> {
    const response = await fetch(`http://127.0.0.1:${host!.port}/pair`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "test-code" }),
    });
    expect(response.status).toBe(200);
    return await response.json() as PairDeviceResult;
  }
  function transport(pairing: PairDeviceResult, reconnect = false): WsTransport {
    const transport = new WsTransport("ws://unused-direct-endpoint", {
      reconnect, reconnectBaseMs: 50, reconnectMaxMs: 100, invokeTimeoutMs: 3000,
      isFatalClose: (event) => event.code === 1008,
      factory: () => createRelaySocket(pairing.relay!, { ...pairing, backendId: pairing.backend.backendId }, (url, protocols) => {
        const raw = new WebSocket(url, protocols);
        wire.push(...protocols);
        const send = raw.send.bind(raw);
        raw.send = ((data: string) => { wire.push(String(data)); send(data); }) as typeof raw.send;
        return raw;
      }, randomBytes),
    });
    transports.push(transport); transport.connect(); return transport;
  }

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "mains-relay-integration-"));
    await writeFile(path.join(temporary, "routing.secret"), routingSecret, { mode: 0o600 });
    const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
    port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    credentials.clear(); wire.length = 0; nextDevice = 0;
    await bootRelay();
    host = await startWsHost({
      port: 0, host: "127.0.0.1", token: "owner-must-never-authorize-a-relay-device",
      relay: { url: `ws://127.0.0.1:${port}`, backendId: "backend-a", routingSecret, privateKey: randomBytes(32) },
      verifyDeviceToken: async (token) => credentials.get(token) ?? null,
      pairDevice: async () => {
        const deviceId = `phone-${++nextDevice}`, deviceToken = `private-device-token-${nextDevice}`;
        credentials.set(deviceToken, { deviceId,
          channels: new Set([CHANNELS.backend.describe]), commandChannels: new Set([CHANNELS.runs.continue, CHANNELS.runs.abort, CHANNELS.runs.toolApprovalResponse]),
          eventChannels: new Set([CHANNELS.runs.statusChanged]),
        });
        return { deviceId, deviceToken, backend: { backendId: "backend-a", name: "Test Mac", protocolVersion: 1, appVersion: "test", capabilities: [], serverTime: new Date().toISOString() } };
      },
      commandReceipts: (() => {
        const receipts = new Map<string, string>();
        return { find: async (device: string, command: string) => receipts.get(`${device}:${command}`) ?? null,
          record: async (device: string, command: string, _channel: string, result: string) => { receipts.set(`${device}:${command}`, result); } };
      })(),
    });
    registerHandler(CHANNELS.backend.describe, async (ctx) => ok({ backendId: "backend-a", deviceId: ctx.deviceId }));
    const readiness = await pair();
    // Wait for the real Go backend registration before opening application sockets.
    await until(() => new Promise<boolean>((resolve) => {
      const test = new WebSocket(`ws://127.0.0.1:${port}/v1/device`, ["mains-relay.v1", `ticket.${readiness.relay!.ticket}`]);
      test.on("open", () => { test.close(); resolve(true); });
      test.on("error", () => resolve(false));
    }));
  });

  afterEach(async () => {
    for (const transport of transports.splice(0)) transport.dispose();
    await host?.close(); host = undefined;
    await stopRelay(); clearHandlers();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  });

  it("pairs directly, authenticates end to end, preserves commands, events and receipts", async () => {
    const pairing = await pair();
    const client = transport(pairing, true);
    await until(() => client.status() === "connected");
    expect(await client.invoke(CHANNELS.backend.describe)).toEqual(ok({ backendId: "backend-a", deviceId: pairing.deviceId }));
    let continued = 0, aborted = 0, approvals = 0;
    registerHandler(CHANNELS.runs.continue, async (_ctx, input) => { continued++; return ok(input); });
    registerHandler(CHANNELS.runs.abort, async () => { aborted++; return ok(null); });
    registerHandler(CHANNELS.runs.toolApprovalResponse, async () => { approvals++; return ok(null); });
    const prompt = { prompt: "private prompt never visible to the relay" };
    expect(await client.invoke(CHANNELS.runs.continue, [prompt], { commandId: "same-command" })).toEqual(ok(prompt));
    await client.invoke(CHANNELS.runs.continue, [prompt], { commandId: "same-command" });
    await client.invoke(CHANNELS.runs.abort, [{}], { commandId: "stop" });
    await client.invoke(CHANNELS.runs.toolApprovalResponse, [{}], { commandId: "approve" });
    expect([continued, aborted, approvals]).toEqual([1, 1, 1]);
    expect((await client.invoke(CHANNELS.runs.continue, [prompt])).success).toBe(false);
    expect((await client.invoke(CHANNELS.fileExplorer.readFile, [{ path: "/etc/passwd" }])).success).toBe(false);
    const events: unknown[] = [];
    client.subscribe(CHANNELS.runs.statusChanged, (value) => events.push(value));
    emit(CHANNELS.runs.statusChanged, { status: "running" });
    await until(() => events.length === 1);
    expect(events).toEqual([{ status: "running" }]);
    expect(host!.connectedDeviceIds().has(pairing.deviceId)).toBe(true);
    expect(wire.join("\n")).not.toContain(pairing.deviceToken);
    expect(wire.join("\n")).not.toContain(prompt.prompt);
    expect(JSON.stringify(pairing)).not.toContain(routingSecret);
  });

  it("refuses wrong device credentials and an incorrect pinned backend key", async () => {
    const pairing = await pair();
    const impostor = transport({ ...pairing, deviceToken: "owner-must-never-authorize-a-relay-device" }, true);
    await until(() => impostor.lastClose?.code === 1008);
    expect(impostor.status()).toBe("offline");
    const otherDevice = await pair();
    const substitution = transport({ ...otherDevice, deviceToken: pairing.deviceToken }, true);
    await until(() => substitution.lastClose?.code === 1008);
    const wrongKey = transport({ ...pairing, relay: { ...pairing.relay!, backendPublicKey: relayPublicKey(randomBytes(32)) } });
    await until(() => wrongKey.lastClose?.code === 1002);
    expect(wrongKey.status()).not.toBe("connected");
  });

  it("revokes an active device and rejects its next encrypted authentication", async () => {
    const pairing = await pair(), client = transport(pairing, true);
    await until(() => client.status() === "connected");
    credentials.delete(pairing.deviceToken);
    expect(host!.disconnectDevice(pairing.deviceId)).toBe(1);
    expect(host!.connectedDeviceIds().has(pairing.deviceId)).toBe(false);
    await until(() => client.lastClose?.code === 1008);
    expect(client.status()).toBe("offline");
  });

  it("recovers after the actual Go process restarts and replays the same command receipt", async () => {
    const pairing = await pair(), client = transport(pairing, true);
    let executions = 0;
    registerHandler(CHANNELS.runs.continue, async () => { executions++; return ok("accepted"); });
    await until(() => client.status() === "connected");
    await client.invoke(CHANNELS.runs.continue, [{}], { commandId: "survives-reconnect" });
    await stopRelay();
    await until(() => client.status() !== "connected");
    await bootRelay();
    await until(() => client.status() === "connected");
    expect(await client.invoke(CHANNELS.runs.continue, [{}], { commandId: "survives-reconnect" })).toEqual(ok("accepted"));
    expect(executions).toBe(1);
  });
});
