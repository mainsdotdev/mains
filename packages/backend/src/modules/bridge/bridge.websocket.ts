import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { BridgeClientMessage, BridgeEnvelope, BridgePushResult, BridgeRpcResponse, BridgeServerMessage, BridgeStream } from "@mains/contracts/bridge-protocol";
import { BRIDGE_MAX_BATCH, BRIDGE_MAX_FRAME_BYTES, parseBridgeServerFrame, validateEncryptedBridgeEnvelope } from "@mains/contracts/bridge-wire";
import type { BridgeTransport } from "./bridge.transport";

export interface BridgeWebSocketOptions {
  onApproval?: (request: import("@mains/contracts/bridge-auth").BridgeApprovalRequest) => void;
  url: string;
  token: string | (() => string | Promise<string>);
  requestTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  metadata?: { label: string; platform: string };
  onStatusChange?: (status: "connecting" | "connected" | "offline") => void;
  onPresence?: (presence: Extract<BridgeServerMessage, { type: "presence" }>) => void;
  onChanged?: (stream: BridgeStream) => void;
  /** Policy closure is a hint to recheck HTTP identity, never proof of revocation. */
  onAccessChanged?: () => void;
}
/** Reconnects lazily. Disconnection/timeouts reject RPCs, leaving the engine's outbox/cursor intact. */
export function createBridgeWebSocketTransport(options: BridgeWebSocketOptions) {
  const url = new URL(options.url);
  if (url.protocol !== "wss:" && !(url.protocol === "ws:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw new Error("Bridge requires wss outside loopback");
  if (url.username || url.password || url.search || url.hash) throw new Error("Bridge credentials belong in the Authorization header");
  let socket: WebSocket | undefined, connecting: Promise<WebSocket> | undefined, closed = false;
  let connectionGeneration = 0;
  let stopHeartbeat: (() => void) | undefined;
  let subscriptions: BridgeStream[] = [];
  const pending = new Map<string, { resolve: (message: BridgeServerMessage) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const timeout = options.requestTimeoutMs ?? 15000;
  const status = (value: "connecting" | "connected" | "offline") => {
    try { options.onStatusChange?.(value); } catch (error) { console.error("Bridge status listener failed", error); }
  };
  function rejectAll(error: Error) {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
  }
  function heartbeat(candidate: WebSocket) {
    let pingTimer: ReturnType<typeof setTimeout> | undefined, pongTimer: ReturnType<typeof setTimeout> | undefined, nonce: string | undefined;
    const stop = () => {
      if (pingTimer) clearTimeout(pingTimer); if (pongTimer) clearTimeout(pongTimer);
      pingTimer = pongTimer = undefined; nonce = undefined; candidate.off("pong", pong);
      if (stopHeartbeat === stop) stopHeartbeat = undefined;
    };
    function next() {
      pingTimer = setTimeout(() => {
        pingTimer = undefined;
        if (closed || socket !== candidate || candidate.readyState !== WebSocket.OPEN) { stop(); return; }
        nonce = randomUUID();
        pongTimer = setTimeout(() => { stop(); candidate.terminate(); }, options.heartbeatTimeoutMs ?? 10_000);
        pongTimer.unref();
        // Cloudflare handles protocol ping/pong without waking the account DO.
        candidate.ping(nonce, undefined, (error) => { if (error) { stop(); candidate.terminate(); } });
      }, options.heartbeatIntervalMs ?? 25_000);
      pingTimer.unref();
    }
    function pong(data: Buffer) {
      if (!nonce || data.toString() !== nonce) return;
      if (pongTimer) clearTimeout(pongTimer); pongTimer = undefined; nonce = undefined;
      next();
    }
    candidate.on("pong", pong); candidate.once("close", stop);
    stopHeartbeat = stop; next();
  }
  function receive(data: WebSocket.RawData) {
    let value: BridgeServerMessage | BridgeRpcResponse;
    try {
      const text = Array.isArray(data) ? Buffer.concat(data).toString() : Buffer.isBuffer(data) ? data.toString() : Buffer.from(data).toString();
      if (Buffer.byteLength(text) > BRIDGE_MAX_FRAME_BYTES) throw new Error("oversized");
      value = parseBridgeServerFrame(text);
    } catch { socket?.terminate(); rejectAll(new Error("Invalid Bridge hub response")); return; }
    if ("requestId" in value && !("type" in value)) {
      const entry = pending.get(value.requestId);
      if (!entry) return;
      pending.delete(value.requestId); clearTimeout(entry.timer);
      if ("error" in value) entry.reject(new Error(`Bridge hub rejected request: ${value.error.code}`));
      else entry.resolve(value.message);
    } else {
      try {
        if (value.type === "presence") options.onPresence?.(value);
        else if (value.type === "changed") options.onChanged?.(value.stream);
        else if (value.type === "approval") options.onApproval?.(value);
      } catch (error) { console.error("Bridge transport listener failed", error); }
    }
  }
  async function connect(): Promise<WebSocket> {
    if (closed) throw new Error("Bridge transport is closed");
    if (socket?.readyState === WebSocket.OPEN) return socket;
    if (connecting) return connecting;
    const generation = connectionGeneration;
    status("connecting");
    const attempt = (async () => {
      const token = typeof options.token === "function" ? await options.token() : options.token;
      if (closed) throw new Error("Bridge transport is closed");
      if (generation !== connectionGeneration) throw new Error("Bridge connection cancelled");
      return new Promise<WebSocket>((resolve, reject) => {
        const candidate = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, maxPayload: BRIDGE_MAX_FRAME_BYTES, handshakeTimeout: timeout });
        socket = candidate;
        candidate.on("message", (data) => { if (socket === candidate) receive(data); });
        candidate.once("open", () => {
          if (closed || generation !== connectionGeneration) { candidate.terminate(); reject(new Error("Bridge connection cancelled")); return; }
          resolve(candidate);
          heartbeat(candidate);
          status("connected");
          if (options.metadata) candidate.send(JSON.stringify({ requestId: randomUUID(), message: { type: "hello", ...options.metadata } }));
          // Socket attachments contain subscriptions, so restore them after any reconnect.
          if (subscriptions.length) candidate.send(JSON.stringify({ requestId: randomUUID(), message: { type: "subscribe", streams: subscriptions } }));
        });
        candidate.on("error", () => { reject(new Error("Bridge connection failed")); });
        candidate.once("close", (code) => {
          if (socket === candidate) {
            socket = undefined; rejectAll(new Error("Bridge connection closed")); status("offline");
            if (!closed && code === 1008) {
              try { options.onAccessChanged?.(); } catch (error) { console.error("Bridge identity listener failed", error); }
            }
          }
          reject(new Error("Bridge connection closed"));
        });
      });
    })();
    connecting = attempt;
    try { return await attempt; } finally { if (connecting === attempt) connecting = undefined; }
  }
  async function rpc(message: BridgeClientMessage): Promise<BridgeServerMessage> {
    const active = await connect(), requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId); reject(new Error("Bridge request timed out"));
        active.terminate(); // A retry uses a new connection and cannot consume an older ACK.
      }, timeout);
      pending.set(requestId, { resolve, reject, timer });
      active.send(JSON.stringify({ requestId, message }), (error) => {
        if (!error) return;
        const entry = pending.get(requestId);
        if (entry) { pending.delete(requestId); clearTimeout(entry.timer); entry.reject(new Error("Bridge request could not be sent")); }
      });
    });
  }
  const api: BridgeTransport & {
    subscribe(streams: BridgeStream[]): Promise<void>;
    compact(): Promise<void>;
    disconnect(): void;
    close(): void;
  } = {
    async push(stream, records) {
      records.forEach(validateEncryptedBridgeEnvelope);
      const results: BridgePushResult[] = [];
      let batch: BridgeEnvelope[] = [], bytes = 512;
      async function flush() {
        if (!batch.length) return;
        const response = await rpc({ type: "push", stream, records: batch });
        if (response.type !== "ack" || response.stream !== stream || response.results.length !== batch.length) throw new Error("Invalid Bridge ACK");
        results.push(...response.results); batch = []; bytes = 512;
      }
      for (const record of records) {
        const size = Buffer.byteLength(JSON.stringify(record)) + 1;
        if (batch.length && (batch.length === BRIDGE_MAX_BATCH || bytes + size > BRIDGE_MAX_FRAME_BYTES - 2048)) await flush();
        batch.push(record); bytes += size;
      }
      await flush(); return results;
    },
    async pull(stream, after, limit) {
      const response = await rpc({ type: "pull", stream, after, limit });
      if (response.type !== "records" || response.stream !== stream || !Array.isArray(response.records) || typeof response.hasMore !== "boolean") throw new Error("Invalid Bridge pull response");
      for (const record of response.records) validateEncryptedBridgeEnvelope(record.envelope);
      return { records: response.records, next: response.next, hasMore: response.hasMore };
    },
    async subscribe(streams) {
      subscriptions = [...new Set(streams)];
      const response = await rpc({ type: "subscribe", streams: subscriptions });
      if (response.type !== "subscribed") throw new Error("Invalid Bridge subscription response");
    },
    async compact() { if ((await rpc({ type: "compact" })).type !== "compacted") throw new Error("Invalid Bridge compaction response"); },
    disconnect() {
      connectionGeneration++; const previous = socket; socket = undefined; connecting = undefined;
      stopHeartbeat?.();
      rejectAll(new Error("Bridge connection closed")); previous?.terminate();
      status("offline");
    },
    close() { closed = true; api.disconnect(); },
  };
  return api;
}
export type BridgeWebSocketTransport = ReturnType<typeof createBridgeWebSocketTransport>;
