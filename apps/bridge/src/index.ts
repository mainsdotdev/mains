import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import type { BridgeRpcRequest, BridgeRpcResponse, BridgeServerMessage, BridgeStream } from "@mains/contracts/bridge-protocol";
import { BRIDGE_MAX_FRAME_BYTES, parseBridgeRpcRequest } from "@mains/contracts/bridge-wire";
import { authenticate, createBridgeSocketAuth, type BridgeIdentity, type DevAuthEnv } from "./auth";
import { handleSignIn } from "./sign-in";
import { handleDevices } from "./devices";
import type { BridgeApprovalRequest } from "@mains/contracts/bridge-auth";
import { createHubStore } from "./store";
import { handleBlobs, type BlobEnv } from "./blobs";
import { createBlobQuota, BridgeQuotaError, type BlobReservation, type QuotaEnv } from "./quota";
import { createBridgeSubscriptions } from "./subscriptions";
import { signedInUser } from "./identity";
import type { BridgeBlobIdentity } from "@mains/contracts/bridge-blobs";
import { observeBridgeRequest, reportBridgeFailure } from "./observability";
import { createHubBackup } from "./hub-backup";
import { createBridgeLimits } from "./limits";
import { createSqlUsage, type SqlUsageEnv } from "./sql-usage";

interface Env extends DevAuthEnv, BlobEnv, QuotaEnv, SqlUsageEnv { ACCOUNT_HUB: DurableObjectNamespace<AccountHub> }
interface Session extends BridgeIdentity { streams: BridgeStream[] }
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return observeBridgeRequest(env, () => handleRequest(request, env));
  },
};
async function handleRequest(request: Request, env: Env): Promise<Response> {
    const rotated = async (account: string, backend: string, oldHash: string) => {
      await env.ACCOUNT_HUB.get(env.ACCOUNT_HUB.idFromName(account)).revoke(backend, oldHash);
    };
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return Response.json({ ok: true, protocol: 1 });
    if (url.pathname === "/v1/subscription") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      const identity = await authenticate(request, env, rotated);
      const accountId = identity?.accountId ?? (env.AUTH_DB && request.headers.has("Cookie") ? (await signedInUser(env, request))?.id : null);
      if (!accountId) return new Response("Unauthorized", { status: 401 });
      try { return Response.json(await env.ACCOUNT_HUB.get(env.ACCOUNT_HUB.idFromName(accountId)).getSubscription(accountId), { headers: { "Cache-Control": "no-store" } }); }
      catch { reportBridgeFailure(env, "subscription"); return new Response("Bridge subscription status is unavailable", { status: 503 }); }
    }
    if (env.AUTH_DB && (url.pathname.startsWith("/api/auth/") || ["/sign-in", "/reset-password", "/device", "/authorize", "/v1/beta/activate"].includes(url.pathname) || url.pathname.startsWith("/v1/auth/"))) {
      const response = await handleSignIn(request, env, async (accountId) => {
        await env.ACCOUNT_HUB.get(env.ACCOUNT_HUB.idFromName(accountId)).subscriptionChanged(accountId);
      }); if (response) return response;
    }
    if (url.pathname.startsWith("/v1/backends") || url.pathname.startsWith("/v1/keys/") || url.pathname.startsWith("/v1/approvals"))
      return handleDevices(request, env, {
        rotated,
        async approval(account, entry) { await env.ACCOUNT_HUB.get(env.ACCOUNT_HUB.idFromName(account)).notifyApproval(entry); },
        async revoked(account, backend) { await env.ACCOUNT_HUB.get(env.ACCOUNT_HUB.idFromName(account)).revoke(backend); },
      });
    if (url.pathname.startsWith("/v1/blobs/")) return handleBlobs(request, env, {
      rotated,
      reserve: (identity, entries, expires) => env.ACCOUNT_HUB.get(env.ACCOUNT_HUB.idFromName(identity.accountId)).reserveBlobs(identity, entries, expires),
      put: (identity, key, expires, bytes) => env.ACCOUNT_HUB.get(env.ACCOUNT_HUB.idFromName(identity.accountId)).putBlob(identity, key, expires, bytes),
      read: (identity, blobs, expires) => env.ACCOUNT_HUB.get(env.ACCOUNT_HUB.idFromName(identity.accountId)).protectBlobReads(identity, blobs, expires),
    });
    if (url.pathname === "/v1/quota" && request.method === "GET") {
      const identity = await authenticate(request, env, rotated);
      if (!identity) return new Response("Unauthorized", { status: 401 });
      return Response.json(await env.ACCOUNT_HUB.get(env.ACCOUNT_HUB.idFromName(identity.accountId)).getQuota(identity), { headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname !== "/v1/log") return new Response("Not found", { status: 404 });
    // This development auth is deliberately unavailable without explicit local configuration.
    const identity = await authenticate(request, env, rotated);
    if (!identity) return new Response("Unauthorized", { status: 401 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket required", { status: 426 });
    const headers = new Headers(request.headers);
    headers.set("X-Bridge-Identity", JSON.stringify(identity));
    return env.ACCOUNT_HUB.get(env.ACCOUNT_HUB.idFromName(identity.accountId)).fetch(new Request(request, { headers }));
}

/** Available only through an authenticated Cloudflare service binding. The
 * public fetch handler has no operations route or data-restore endpoint. */
export class BridgeOperations extends WorkerEntrypoint<Env> {
  private async account(accountId: string) {
    if (typeof accountId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) throw new Error("Invalid backup account");
    if (!this.env.AUTH_DB || !await this.env.AUTH_DB.prepare("SELECT 1 FROM bridge_accounts WHERE account_id=?").bind(accountId).first()) throw new Error("Unknown backup account");
    return this.env.ACCOUNT_HUB.get(this.env.ACCOUNT_HUB.idFromName(accountId));
  }
  async snapshotBegin(accountId: string) { return (await this.account(accountId)).snapshotBegin(); }
  async snapshotPage(accountId: string, token: string, table: string, after: number) { return (await this.account(accountId)).snapshotPage(token, table, after); }
  async snapshotValid(accountId: string, token: string) { return (await this.account(accountId)).snapshotValid(token); }
  async accounts(after = "") {
    if (typeof after !== "string" || after.length > 128) throw new Error("Invalid backup cursor");
    if (!this.env.AUTH_DB) throw new Error("Authentication database is not configured");
    const result = await this.env.AUTH_DB.prepare("SELECT account_id FROM bridge_accounts WHERE account_id>? ORDER BY account_id LIMIT 100").bind(after).all<{ account_id: string }>();
    return result.results.map((row) => row.account_id);
  }
  async checkpoint(accountId: string) {
    if (typeof accountId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) throw new Error("Invalid backup account");
    if (!this.env.AUTH_DB || !await this.env.AUTH_DB.prepare("SELECT 1 FROM bridge_accounts WHERE account_id=?").bind(accountId).first()) throw new Error("Unknown backup account");
    const id = this.env.ACCOUNT_HUB.idFromName(accountId);
    const value = await this.env.ACCOUNT_HUB.get(id).recoveryCheckpoint();
    return { ...value, objectId: id.toString() };
  }
}

/** Cloudflare requires a class at this runtime boundary; storage/domain helpers remain functions. */
export class AccountHub extends DurableObject<Env> {
  private store: ReturnType<typeof createHubStore>;
  private quota: ReturnType<typeof createBlobQuota>;
  private subscriptions: ReturnType<typeof createBridgeSubscriptions>;
  private backup: ReturnType<typeof createHubBackup>;
  private socketAuth: ReturnType<typeof createBridgeSocketAuth>;
  private usage: ReturnType<typeof createSqlUsage>;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.usage = createSqlUsage(ctx.storage, env, ctx.id.toString());
    const domain = this.usage.run("initialize", () => {
      const store = createHubStore(this.usage.storage), subscriptions = createBridgeSubscriptions(env);
      const limits = createBridgeLimits(env, { onCache: (hit) => this.usage.limitsCache(hit) });
      return { store, subscriptions, quota: createBlobQuota(this.usage.storage, env, () => store.recordBytes(), subscriptions, limits),
        backup: createHubBackup(this.usage.storage) };
    });
    this.store = domain.store; this.subscriptions = domain.subscriptions; this.quota = domain.quota; this.backup = domain.backup;
    this.socketAuth = createBridgeSocketAuth(env);
  }
  snapshotBegin() { return this.usage.run("snapshot", () => this.backup.begin()); }
  snapshotPage(token: string, table: string, after: number) { return this.usage.run("snapshot", () => this.backup.page(token, table, after)); }
  snapshotValid(token: string) { return this.usage.run("snapshot", () => this.backup.valid(token)); }
  async getSubscription(accountId: string) { return this.subscriptions.status(accountId); }
  /** Internal RPC seam for a future billing event consumer; no HTTP mutation route. */
  async subscriptionChanged(accountId: string) { this.subscriptions.invalidate(accountId); this.quota.invalidateLimits(accountId); }
  async recoveryCheckpoint() {
    return this.usage.run("checkpoint", () => this.ctx.blockConcurrencyWhile(async () => ({ bookmark: await this.ctx.storage.getCurrentBookmark(), capturedAt: new Date().toISOString() })));
  }
  async getQuota(identity: BridgeIdentity) {
    return this.usage.run("quota", () => this.ctx.blockConcurrencyWhile(async () => {
      const quota = await this.quota.status(identity.accountId);
      // Also arms collection for inventories imported from pre-GC stores that
      // have no new writes (and therefore no existing maintenance alarm).
      const deadlines = [this.store.nextExpiry(), this.quota.nextExpiry()].filter((value): value is number => value !== null);
      if (deadlines.length) await this.schedule(Math.min(...deadlines));
      return quota;
    }));
  }
  async reserveBlobs(identity: BridgeIdentity, entries: BlobReservation[], expires: number) {
    return this.usage.run("reserve", () => this.ctx.blockConcurrencyWhile(async () => {
      try {
        if (!(await this.subscriptions.status(identity.accountId)).subscription.canUpload) return { status: 403, error: "Bridge subscription required; local changes remain queued" };
        const limit = (await this.quota.status(identity.accountId)).writesPerMinute;
        if (!this.store.takeWrite(identity.backendId, limit)) return { status: 429, error: "Bridge write rate limit reached" };
        await this.quota.reserve(identity, entries, expires);
        await this.schedule(this.quota.nextExpiry());
        return { status: 200, error: null };
      } catch (error) { if (error instanceof BridgeQuotaError) return { status: error.status, error: error.message }; throw error; }
    }));
  }
  async putBlob(identity: BridgeIdentity, key: string, expires: number, bytes: Uint8Array) {
    const task = this.usage.run("put", async () => {
      // Expected admission/authorization failures must not reset the object.
      const gate = async <T>(work: () => Promise<T>): Promise<T> => {
        const result = await this.ctx.blockConcurrencyWhile(async () => {
          try { return { value: await work() }; } catch (error) { return { error }; }
        });
        if ("error" in result) throw result.error;
        return result.value;
      };
      try { await this.quota.put(identity, key, expires, bytes, gate); return { status: 204, error: null }; }
      catch (error) { if (error instanceof BridgeQuotaError) return { status: error.status, error: error.message }; throw error; }
      finally { await gate(async () => this.schedule(this.quota.nextExpiry())); }
    });
    // A caller disconnect must not abandon a dispatched R2 write or its
    // receipt. A full object reset is handled by the durable upload intent.
    this.ctx.waitUntil(task.catch(() => {}));
    return task;
  }
  async protectBlobReads(identity: BridgeIdentity, blobs: BridgeBlobIdentity[], expires: number) {
    return this.usage.run("protectRead", () => this.ctx.blockConcurrencyWhile(async () => {
      try { await this.quota.protectReads(identity, blobs, expires); return { status: 200, error: null }; }
      catch (error) { if (error instanceof BridgeQuotaError) return { status: error.status, error: error.message }; throw error; }
    }));
  }
  async fetch(request: Request): Promise<Response> {
    return this.usage.run("connect", () => {
      const identity = JSON.parse(request.headers.get("X-Bridge-Identity")!) as BridgeIdentity;
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ ...identity, streams: [] } satisfies Session);
      this.store.seen(identity.backendId);
      for (const entry of this.store.presence()) this.send(server, { type: "presence", backendId: entry.backend_id,
        online: this.sockets().some((socket) => this.session(socket).backendId === entry.backend_id), lastSeen: new Date(entry.last_seen).toISOString(),
        ...(entry.label ? { label: entry.label } : {}), ...(entry.platform ? { platform: entry.platform } : {}) });
      this.broadcast({ type: "presence", backendId: identity.backendId, online: true, lastSeen: new Date().toISOString() });
      return new Response(null, { status: 101, webSocket: client });
    });
  }
  async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    try { await this.receiveMessage(socket, data); }
    catch { reportBridgeFailure(this.env, "websocket"); socket.close(1011, "Bridge is temporarily unavailable"); }
  }
  private async receiveMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const session = this.session(socket);
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!await this.socketAuth.active(session)) { socket.close(1008, "Backend access expired or was revoked"); return; }
    if (socket.readyState !== WebSocket.OPEN) return;
    if (typeof data !== "string" || data.length > BRIDGE_MAX_FRAME_BYTES) { socket.close(1009, "Invalid message size"); return; }
    let request: BridgeRpcRequest;
    try { request = parseBridgeRpcRequest(data); }
    catch { socket.close(1008, "Invalid Bridge request"); return; }
    const { message, requestId } = request;
    try {
      await this.usage.run(message.type, async () => {
        let response: BridgeServerMessage;
        switch (message.type) {
          case "hello":
            this.store.identify(session.backendId, message.label, message.platform);
            this.broadcast({ type: "presence", backendId: session.backendId, online: true, lastSeen: new Date().toISOString(), label: message.label.trim(), platform: message.platform });
            response = { type: "identified", backendId: session.backendId }; break;
          case "push": {
            const publication = await this.ctx.blockConcurrencyWhile(async () => {
              try {
                if (message.records.every((record) => record.header.op === "delete")) return this.store.push(session.backendId, message.stream, message.records);
                const quota = await this.quota.status(session.accountId);
                return this.store.push(session.backendId, message.stream, message.records, { ...quota, blobBytes: quota.blobBytes + quota.reservedBytes, canUpload: quota.subscription!.canUpload,
                  hasBlobs: (blobs) => this.quota.hasBlobs(blobs) });
              } catch { return null; } // A lookup failure denies publication without resetting every socket in the DO.
            });
            if (!publication) throw new Error("Bridge publication unavailable");
            const { results, changed } = publication;
            response = { type: "ack", stream: message.stream, results };
            if (changed.length) {
              this.broadcast({ type: "changed", stream: message.stream }, message.stream, socket);
              await this.schedule(Date.now() + 60_000);
            }
            break;
          }
          case "pull": response = { type: "records", stream: message.stream, ...this.store.pull(message.stream, message.after, message.limit) }; break;
          case "subscribe":
            session.streams = [...new Set(message.streams)]; socket.serializeAttachment(session);
            response = { type: "subscribed", streams: session.streams }; break;
          case "compact": await this.maintain(); response = { type: "compacted" }; break;
        }
        this.send(socket, { requestId, message: response });
      });
    } catch {
      reportBridgeFailure(this.env, "rpc");
      this.send(socket, { requestId, error: { code: "storageError", message: "Bridge hub could not commit this request" } });
    }
  }
  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    this.usage.run("disconnect", () => {
      const session = this.session(socket);
      try { socket.close(code, reason); } catch { /* Already closed. */ }
      this.store.seen(session.backendId);
      this.broadcast({ type: "presence", backendId: session.backendId,
        online: this.sockets().some((other) => other !== socket && this.session(other).backendId === session.backendId), lastSeen: new Date().toISOString() });
    });
  }
  webSocketError(socket: WebSocket): void { this.webSocketClose(socket, 1011, "Connection error"); }
  async alarm(): Promise<void> {
    return this.usage.run("compact", async () => {
      try { await this.maintain(); }
      catch { reportBridgeFailure(this.env, "maintenance"); throw new Error("Bridge maintenance failed"); }
    });
  }
  private async maintain() {
    await this.ctx.blockConcurrencyWhile(async () => {
      const { hasMore } = this.store.compact();
      await this.quota.collect();
      const deadlines = [this.store.nextExpiry(), this.quota.nextExpiry()].filter((value): value is number => value !== null);
      if (hasMore) deadlines.push(Date.now() + 1000);
      if (deadlines.length) await this.schedule(Math.max(Date.now() + 1000, Math.min(...deadlines)));
    });
  }
  private async schedule(at: number | null) {
    if (at === null) return;
    at = Math.max(Date.now() + 1000, at);
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > at) await this.ctx.storage.setAlarm(at);
  }
  async notifyApproval(request: BridgeApprovalRequest): Promise<void> { this.broadcast({ type: "approval", ...request }); }
  async revoke(backendId: string, credentialHash?: string): Promise<void> {
    this.socketAuth.invalidate(backendId, credentialHash);
    for (const socket of this.sockets()) {
      const session = this.session(socket);
      if (session.backendId === backendId && (!credentialHash || session.credentialHash === credentialHash)) socket.close(1008, "Backend access revoked");
    }
  }
  private session(socket: WebSocket): Session { return socket.deserializeAttachment() as Session; }
  private sockets() { return this.ctx.getWebSockets().filter((socket) => socket.readyState === WebSocket.OPEN); }
  private broadcast(message: BridgeServerMessage, stream?: BridgeStream, except?: WebSocket) {
    for (const socket of this.sockets()) if (socket !== except && (!stream || this.session(socket).streams.includes(stream))) this.send(socket, message);
  }
  private send(socket: WebSocket, value: BridgeServerMessage | BridgeRpcResponse) {
    try { socket.send(JSON.stringify(value)); } catch { /* A disconnected client will pull from its durable cursor. */ }
  }
}
