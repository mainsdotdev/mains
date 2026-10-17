import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { buildSubprotocols } from "@mains/contracts/ws-protocol";
import type { ServiceResponse } from "@mains/contracts/service-response";
import type { BackendDescriptor, PairDeviceResult } from "@mains/contracts/backend";
import { CHANNELS } from "@mains/contracts/channels";
import { startLocalBridgeHub } from "./local-hub.mjs";

const serverRoot = fileURLToPath(new URL("../../server/", import.meta.url));
const serverEntry = join(serverRoot, ".vite/server/server.cjs");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Real authenticated client, using the same invoke protocol as desktop/web/mobile. */
export async function connectBackend(port: number, token: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, buildSubprotocols(token));
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let nextId = 0;
  const waiting = new Map<number, { resolve(value: ServiceResponse<any>): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (message.kind !== "response") return;
    const request = waiting.get(message.id);
    if (request) { waiting.delete(message.id); clearTimeout(request.timer); request.resolve(message.result); }
  });
  socket.on("close", () => {
    for (const request of waiting.values()) { clearTimeout(request.timer); request.reject(new Error("Backend connection closed")); }
    waiting.clear();
  });
  const api = {
    invoke<T = any>(channel: string, ...args: unknown[]): Promise<ServiceResponse<T>> {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`Backend RPC timed out: ${channel}`)); }, 15_000);
        waiting.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ kind: "invoke", id, channel, args, commandId: randomUUID() }));
      });
    },
    async call<T = any>(channel: string, ...args: unknown[]): Promise<T> {
      const result = await api.invoke<T>(channel, ...args);
      if (!result.success) throw new Error(`${channel}: ${result.error}`);
      return result.data;
    },
    close() { socket.close(); },
  };
  return api;
}

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function createHost(dir: string, label: string, lan = false) {
  await mkdir(dir, { recursive: true });
  const port = await availablePort(), token = randomBytes(32).toString("base64url");
  const configFile = join(dir, "bridge", "dev.json");
  const url = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined, client: Awaited<ReturnType<typeof connectBackend>> | undefined;
  let backendId = "", logs = "";
  const host = {
    dir, label, port, token, configFile, url,
    get backendId() { return backendId; },
    get client() { if (!client) throw new Error(`${label} is stopped`); return client; },
    async start() {
      if (child) throw new Error(`${label} is already running`);
      const env = { ...process.env, MAINS_SERVE_TOKEN: token, MAINS_BRIDGE_CONFIG: configFile };
      child = spawn(process.execPath, [serverEntry, "serve", "--data-dir", dir, "--port", String(port), "--no-pairing", ...(lan ? ["--lan"] : [])], { cwd: serverRoot, env, stdio: ["ignore", "pipe", "pipe"] });
      const append = (data: Buffer) => { logs = (logs + data.toString()).slice(-8000); };
      child.stdout?.on("data", append); child.stderr?.on("data", append);
      let spawnError: Error | undefined;
      child.once("error", (error) => { spawnError = error; });
      for (let i = 0; i < 200; i++) {
        if (spawnError || child.exitCode !== null) throw new Error(`${label} failed to start: ${spawnError?.message ?? logs}`);
        try { client = await connectBackend(port, token); break; } catch { await pause(100); }
      }
      if (!client) throw new Error(`${label} startup timed out: ${logs}`);
      backendId = (await client.call<BackendDescriptor>(CHANNELS.backend.describe)).backendId;
    },
    async stop() {
      client?.close(); client = undefined;
      const processToStop = child; child = undefined;
      if (!processToStop || processToStop.exitCode !== null) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => processToStop.kill("SIGKILL"), 5000);
        processToStop.once("exit", () => { clearTimeout(timer); resolve(); });
        processToStop.kill("SIGTERM");
      });
    },
    async endpoints(): Promise<string[]> {
      const state = JSON.parse(await readFile(join(dir, "server-state.json"), "utf8")) as { endpoints: string[] };
      return state.endpoints;
    },
    async webLogin(baseUrl = url) {
      const response = await fetch(`${url}/__mains/admin/web-login`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl }) });
      if (!response.ok) throw new Error(`Browser login failed: ${response.status}`);
      return (await response.json() as { link: string }).link;
    },
    async pair() {
      const response = await fetch(`${url}/__mains/admin/pairing-code`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ endpoints: [url] }) });
      const { code } = await response.json() as { code: string };
      const paired = await fetch(`${url}/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, deviceName: "Acceptance iPad", platform: "ios" }) });
      if (!paired.ok) throw new Error(`Pairing failed: ${paired.status}`);
      return connectBackend(port, (await paired.json() as PairDeviceResult).deviceToken);
    },
  };
  return host;
}

/** Two actual composition roots, independent data dirs/identities, one temporary workerd hub. */
export async function startLocalBackends(settings: { auth?: boolean; lan?: boolean; truncateRefreshOnce?: boolean; subscriptionInterval?: "monthly" | "yearly" | null } = {}) {
  await access(serverEntry).catch(() => { throw new Error("Build apps/server and apps/desktop's web renderer before running host acceptance tests"); });
  const dir = await mkdtemp(join(tmpdir(), "mains-bridge-hosts-"));
  const { subscriptionInterval, ...hubSettings } = settings;
  const hub = await startLocalBridgeHub({ ...hubSettings, ...(settings.auth && subscriptionInterval !== null ? { subscriptionInterval: subscriptionInterval ?? "monthly" } : {}) });
  const a = await createHost(join(dir, "A"), "Computer A"), b = await createHost(join(dir, "B"), "Computer B", settings.lan);
  const dispose = async () => {
    await Promise.allSettled([a.stop(), b.stop()]); await hub.dispose();
    const locks = await Promise.all([a, b].map((host) => access(join(host.dir, "mains.db.backend.lock")).then(() => true, () => false)));
    if (locks.some(Boolean)) console.warn(`A backend still owns a demo profile; preserved ${dir}`);
    else await rm(dir, { recursive: true, force: true });
  };
  try {
    await a.start(); await b.start();
    const disabled = await a.client.call(CHANNELS.bridge.getStatus);
    if (disabled.enabled || disabled.state !== "disabled") throw new Error("Bridge must be disabled without explicit config");
    if (settings.auth) return { dir, hub, a, b, dispose };
    await a.stop(); await b.stop();
    const accountId = randomUUID(), accountKey = randomBytes(32).toString("base64url");
    for (const host of [a, b]) {
      await mkdir(join(host.dir, "bridge"), { recursive: true });
      await writeFile(host.configFile, JSON.stringify({ version: 1, backendId: host.backendId, url: hub.wsUrl, token: await hub.token(accountId, host.backendId), accountKey, label: host.label }), { mode: 0o600, flag: "wx" });
      await host.start();
    }
    return { dir, hub, a, b, dispose };
  } catch (error) { await dispose(); throw error; }
}

export async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, description: string, timeout = 20_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (accept(value)) return value; await pause(100); }
  throw new Error(`Timed out waiting for ${description}`);
}
