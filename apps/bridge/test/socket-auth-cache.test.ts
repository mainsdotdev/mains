import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import WebSocket from "ws";
import { afterEach, expect, it, vi } from "vitest";
import { parseBridgeServerFrame } from "@mains/contracts/bridge-wire";
import { fixtureEntryHash, fixtureGenesis, fixturePublicKey } from "./record-signing.mjs";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const start = Date.parse("2030-01-01T00:00:00Z");
/** The hub admits only its log's members, so B is the account's genesis member. */
const genesis = fixtureGenesis("account", "B", new Uint8Array(32));

/** Instrument the real AccountHub message handler; only its D1 boundary and
 * wall clock are controlled. No test endpoints are added to the shipped hub. */
async function probe() {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), sourcefile: "socket-auth-probe.ts", contents: `
    import { AccountHub } from './src/index.ts';
    export class ProbeHub extends AccountHub {
      constructor(ctx, env) {
        const state = { now: ${start}, active: true, fail: false, hold: false, releases: [], queries: 0 };
        Date.now = () => state.now;
        super(ctx, { ...env, AUTH_DB: { prepare() { return { bind() { return { async first() {
          state.queries++;
          if (state.fail) throw new Error('Injected D1 outage');
          const result = state.active ? { approved: 1 } : null;
          if (state.hold) await new Promise(resolve => { state.releases.push(resolve); });
          return result;
        } }; } }; } } });
        this.probeState = state;
        ctx.storage.sql.exec('INSERT OR IGNORE INTO membership(seq,hash,entry,appended_at) VALUES(0,?,?,0)', ${JSON.stringify(fixtureEntryHash(genesis))}, ${JSON.stringify(JSON.stringify(genesis))});
        ctx.blockConcurrencyWhile(async () => Object.assign(state, await ctx.storage.get('probe-state') ?? {}));
      }
      async configure(input) {
        Object.assign(this.probeState, input);
        const { now, active, fail } = this.probeState;
        await this.ctx.storage.put('probe-state', { now, active, fail });
      }
      metrics() {
        return { queries: this.probeState.queries, presence: this.ctx.storage.sql.exec('SELECT backend_id,last_seen FROM presence').toArray() };
      }
      releaseRead() { this.probeState.hold = false; for (const release of this.probeState.releases.splice(0)) release(); }
    }
    export default { async fetch(request, env) {
      const hub = env.ACCOUNT_HUB.getByName('account');
      const url = new URL(request.url);
      if (url.pathname === '/configure') { await hub.configure(await request.json()); return Response.json({ ok: true }); }
      if (url.pathname === '/metrics') return Response.json(await hub.metrics());
      if (url.pathname === '/revoke') { const input = request.method === 'POST' ? await request.json() : {}; await hub.revoke('B', input.hash); return Response.json({ ok: true }); }
      if (url.pathname === '/release') { await hub.releaseRead(); return Response.json({ ok: true }); }
      const identity = { accountId: 'account', backendId: 'B', signingPublicKey: ${JSON.stringify(fixturePublicKey("account", "B"))}, credentialHash: url.searchParams.get('hash') ?? 'credential-one', expiresAt: Number(url.searchParams.get('expires') ?? ${start + 3_600_000}) };
      const headers = new Headers(request.headers); headers.set('X-Bridge-Identity', JSON.stringify(identity));
      return hub.fetch(new Request(request, { headers }));
    } };
  ` }, bundle: true, write: false, format: "esm", platform: "browser", conditions: ["workerd"], external: ["cloudflare:workers", "node:*"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "socket-auth-probe", modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"], host: "127.0.0.1", port: 0,
    durableObjects: { ACCOUNT_HUB: { className: "ProbeHub", useSQLite: true } }, unsafeInspectDurableObjects: true }));
  cleanup.push(() => mf.dispose());
  const url = await mf.ready;
  async function call(path: string, body?: unknown) {
    const response = await fetch(new URL(path, url), { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body) });
    expect(response.ok).toBe(true); return response.json();
  }
  const sockets: WebSocket[] = [];
  cleanup.push(async () => { for (const socket of sockets) socket.terminate(); });
  return {
    configure: (input: { now?: number; active?: boolean; fail?: boolean; hold?: boolean }) => call("/configure", input),
    metrics: () => call("/metrics") as Promise<{ queries: number; presence: { backend_id: string; last_seen: number }[] }>,
    revoke: (hash?: string) => call("/revoke", hash ? { hash } : undefined),
    release: () => call("/release"),
    async evict() {
      const namespace = await mf.getDurableObjectNamespace("ACCOUNT_HUB");
      await mf.unsafeEvictDurableObject("socket-auth-probe", "ProbeHub", { id: namespace.idFromName("account").toString() });
    },
    async socket(expires = start + 3_600_000, hash = "credential-one") {
      const socket = new WebSocket(new URL(`/socket?expires=${expires}&hash=${hash}`, url).toString().replace(/^http/, "ws")); sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
      let id = 0;
      return {
        closed: new Promise<number>((resolve) => socket.once("close", resolve)),
        close() { socket.close(); },
        ping() {
          return new Promise<string>((resolve) => {
            socket.once("pong", (data) => resolve(data.toString())); socket.ping("control-ping");
          });
        },
        pull() {
          const requestId = `pull-${++id}`;
          return new Promise<void>((resolve, reject) => {
            const receive = (data: WebSocket.RawData) => {
              const frame = parseBridgeServerFrame(data.toString());
              if ("requestId" in frame && frame.requestId === requestId) {
                socket.off("message", receive); socket.off("close", closed);
                if ("error" in frame) reject(new Error(frame.error.message)); else resolve();
              }
            };
            const closed = () => { socket.off("message", receive); reject(new Error("Socket closed")); };
            socket.once("close", closed); socket.on("message", receive);
            socket.send(JSON.stringify({ requestId, message: { type: "pull", stream: "account", after: 0, limit: 10 } }));
          });
        },
      };
    },
  };
}

it("coalesces identity reads without writing presence for idle pull messages", async () => {
  const p = await probe(), socket = await p.socket();
  await p.configure({ now: start + 1000 });
  for (let i = 0; i < 20; i++) await socket.pull();
  expect(await p.metrics()).toEqual({ queries: 1, presence: [{ backend_id: "B", last_seen: start }] });
  await p.configure({ now: start + 29_999 }); await socket.pull();
  expect((await p.metrics()).queries).toBe(1);
  await p.configure({ now: start + 31_001 }); await socket.pull();
  expect(await p.metrics()).toEqual({ queries: 2, presence: [{ backend_id: "B", last_seen: start }] });
});

it("answers protocol pings after hibernation without a message handler, D1 read or presence write", async () => {
  const p = await probe(), socket = await p.socket(); await socket.pull();
  await p.configure({ now: start + 31_001, fail: true }); await p.evict();
  expect(await socket.ping()).toBe("control-ping");
  expect(await p.metrics()).toEqual({ queries: 0, presence: [{ backend_id: "B", last_seen: start }] });
});

it("persists the connection and disconnection times while idle reads leave last-seen unchanged", async () => {
  const p = await probe(), socket = await p.socket();
  await p.configure({ now: start + 600_000 }); await socket.pull();
  expect((await p.metrics()).presence).toEqual([{ backend_id: "B", last_seen: start }]);
  socket.close(); await socket.closed;
  await vi.waitFor(async () => expect((await p.metrics()).presence).toEqual([{ backend_id: "B", last_seen: start + 600_000 }]));
});

it("does not share a cached approval with a different credential and closes revoked sockets immediately", async () => {
  const p = await probe(), socket = await p.socket(); await socket.pull();
  const replacement = await p.socket(start + 3_600_000, "credential-two"); await replacement.pull();
  expect((await p.metrics()).queries).toBe(2);
  await p.configure({ active: false }); await p.revoke();
  expect(await socket.closed).toBe(1008); expect(await replacement.closed).toBe(1008);
  const retry = await p.socket();
  await expect(retry.pull()).rejects.toThrow("Socket closed"); expect(await retry.closed).toBe(1008);
});

it("shares one in-flight identity query between simultaneous socket messages", async () => {
  const p = await probe(), socket = await p.socket(); await p.configure({ hold: true });
  const pending = Promise.all(Array.from({ length: 8 }, () => socket.pull()));
  try { await vi.waitFor(async () => expect((await p.metrics()).queries).toBe(1)); }
  finally { await p.release(); }
  await pending; expect((await p.metrics()).queries).toBe(1);
});

it("checks exact credential expiry even while approval is cached", async () => {
  const p = await probe(), socket = await p.socket(start + 1000); await socket.pull();
  await p.configure({ now: start + 1000 });
  await expect(socket.pull()).rejects.toThrow("Socket closed"); expect(await socket.closed).toBe(1008);
  expect((await p.metrics()).queries).toBe(1);
});

it("observes a direct D1 revocation at the cache deadline even without a control notification", async () => {
  const p = await probe(), socket = await p.socket(); await socket.pull();
  await p.configure({ now: start + 29_999, active: false }); await socket.pull();
  expect((await p.metrics()).queries).toBe(1);
  await p.configure({ now: start + 30_000 });
  await expect(socket.pull()).rejects.toThrow("Socket closed"); expect(await socket.closed).toBe(1008);
  expect((await p.metrics()).queries).toBe(2);
});

it("does not revive cached approval when a D1 read resolves after revocation", async () => {
  const p = await probe(), socket = await p.socket(); await socket.pull();
  await p.configure({ now: start + 31_001, hold: true });
  const pending = socket.pull().then(() => true, () => false);
  try {
    await vi.waitFor(async () => expect((await p.metrics()).queries).toBe(2));
    await p.configure({ active: false }); await p.revoke();
    expect(await socket.closed).toBe(1008);
  } finally { await p.release(); }
  expect(await pending).toBe(false);
  const retry = await p.socket();
  await expect(retry.pull()).rejects.toThrow("Socket closed"); expect(await retry.closed).toBe(1008);
  expect((await p.metrics()).queries).toBe(3);
});

it("invalidates only the retired credential without interrupting an in-flight check for its successor", async () => {
  const p = await probe(), previous = await p.socket(); await previous.pull();
  const replacement = await p.socket(start + 3_600_000, "credential-two"); await p.configure({ hold: true });
  const pending = replacement.pull().then(() => true, () => false);
  try {
    await vi.waitFor(async () => expect((await p.metrics()).queries).toBe(2));
    await p.revoke("credential-one"); expect(await previous.closed).toBe(1008);
  } finally { await p.release(); }
  expect(await pending).toBe(true);
  await replacement.pull(); expect((await p.metrics()).queries).toBe(2);
});

it("fails closed if D1 is unavailable after the cache expires", async () => {
  const p = await probe(), socket = await p.socket(); await socket.pull();
  await p.configure({ now: start + 30_001, fail: true });
  await expect(socket.pull()).rejects.toThrow("Socket closed"); expect(await socket.closed).toBe(1011);
});

it("revalidates the surviving socket after hibernation instead of persisting cached approval", async () => {
  const p = await probe(), socket = await p.socket(); await socket.pull();
  await p.configure({ now: start + 1000, active: false }); await p.evict();
  await expect(socket.pull()).rejects.toThrow("Socket closed"); expect(await socket.closed).toBe(1008);
  expect((await p.metrics()).queries).toBe(1);
});
