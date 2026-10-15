import { DurableObject } from "cloudflare:workers";
import type { BridgeRpcRequest, BridgeRpcResponse, BridgeServerMessage, BridgeStream } from "@mains/contracts/bridge-protocol";
import { BRIDGE_MAX_FRAME_BYTES, parseBridgeRpcRequest } from "@mains/contracts/bridge-wire";
import { authenticate, type BridgeIdentity, type DevAuthEnv } from "./auth";
import { createHubStore } from "./store";
import { handleBlobs, type BlobEnv } from "./blobs";

interface Env extends DevAuthEnv, BlobEnv { ACCOUNT_HUB: DurableObjectNamespace<AccountHub> }
interface Session extends BridgeIdentity { streams: BridgeStream[] }
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return Response.json({ ok: true, protocol: 1 });
    if (url.pathname.startsWith("/v1/blobs/")) return handleBlobs(request, env);
    if (url.pathname !== "/v1/log") return new Response("Not found", { status: 404 });
    // This development auth is deliberately unavailable without explicit local configuration.
    const identity = await authenticate(request, env);
    if (!identity) return new Response("Unauthorized", { status: 401 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket required", { status: 426 });
    const headers = new Headers(request.headers);
    headers.set("X-Bridge-Identity", JSON.stringify(identity));
    return env.ACCOUNT_HUB.get(env.ACCOUNT_HUB.idFromName(identity.accountId)).fetch(new Request(request, { headers }));
  },
};

/** Cloudflare requires a class at this runtime boundary; storage/domain helpers remain functions. */
export class AccountHub extends DurableObject<Env> {
  private store: ReturnType<typeof createHubStore>;
  constructor(ctx: DurableObjectState, env: Env) { super(ctx, env); this.store = createHubStore(ctx.storage); }
  async fetch(request: Request): Promise<Response> {
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
  }
  async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const session = this.session(socket);
    if (session.expiresAt <= Date.now()) { socket.close(1008, "Token expired"); return; }
    if (typeof data !== "string" || data.length > BRIDGE_MAX_FRAME_BYTES) { socket.close(1009, "Invalid message size"); return; }
    let request: BridgeRpcRequest;
    try { request = parseBridgeRpcRequest(data); }
    catch { socket.close(1008, "Invalid Bridge request"); return; }
    const { message, requestId } = request;
    try {
      this.store.seen(session.backendId);
      let response: BridgeServerMessage;
      switch (message.type) {
        case "hello":
          this.store.identify(session.backendId, message.label, message.platform);
          this.broadcast({ type: "presence", backendId: session.backendId, online: true, lastSeen: new Date().toISOString(), label: message.label.trim(), platform: message.platform });
          response = { type: "identified", backendId: session.backendId }; break;
        case "push": {
          const { results, changed } = this.store.push(session.backendId, message.stream, message.records);
          response = { type: "ack", stream: message.stream, results };
          if (changed.length) {
            this.broadcast({ type: "changed", stream: message.stream }, message.stream);
            if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 60_000);
          }
          break;
        }
        case "pull": response = { type: "records", stream: message.stream, ...this.store.pull(message.stream, message.after, message.limit) }; break;
        case "subscribe":
          session.streams = [...new Set(message.streams)]; socket.serializeAttachment(session);
          response = { type: "subscribed", streams: session.streams }; break;
        case "compact": this.store.compact(); response = { type: "compacted" }; break;
      }
      this.send(socket, { requestId, message: response });
    } catch {
      this.send(socket, { requestId, error: { code: "storageError", message: "Bridge hub could not commit this request" } });
    }
  }
  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    const session = this.session(socket);
    try { socket.close(code, reason); } catch { /* Already closed. */ }
    this.store.seen(session.backendId);
    this.broadcast({ type: "presence", backendId: session.backendId,
      online: this.sockets().some((other) => other !== socket && this.session(other).backendId === session.backendId), lastSeen: new Date().toISOString() });
  }
  webSocketError(socket: WebSocket): void { this.webSocketClose(socket, 1011, "Connection error"); }
  alarm(): void { this.store.compact(); }
  private session(socket: WebSocket): Session { return socket.deserializeAttachment() as Session; }
  private sockets() { return this.ctx.getWebSockets().filter((socket) => socket.readyState === WebSocket.OPEN); }
  private broadcast(message: BridgeServerMessage, stream?: BridgeStream) {
    for (const socket of this.sockets()) if (!stream || this.session(socket).streams.includes(stream)) this.send(socket, message);
  }
  private send(socket: WebSocket, value: BridgeServerMessage | BridgeRpcResponse) {
    try { socket.send(JSON.stringify(value)); } catch { /* A disconnected client will pull from its durable cursor. */ }
  }
}
