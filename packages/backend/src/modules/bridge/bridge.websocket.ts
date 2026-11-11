import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { BridgeClientMessage, BridgeEnvelope, BridgePushResult, BridgeRpcResponse, BridgeServerMessage, BridgeStream } from "@mains/contracts/bridge-protocol";
import { BRIDGE_MAX_BATCH, BRIDGE_MAX_FRAME_BYTES, parseBridgeServerFrame, validateEncryptedBridgeEnvelope } from "@mains/contracts/bridge-wire";
import type { BridgeTransport } from "./bridge.transport";
import { createBridgeConnectionLifecycle } from "./bridge.connection-lifecycle";

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
  onMembership?: (seq: number) => void;
  /** Policy closure is a hint to recheck HTTP identity, never proof of revocation. */
  onAccessChanged?: () => void;
}
/** Reconnects lazily. Disconnection/timeouts reject RPCs, leaving the engine's outbox/cursor intact. */
export function createBridgeWebSocketTransport(options: BridgeWebSocketOptions) {
  const url = new URL(options.url);
  if (url.protocol !== "wss:" && !(url.protocol === "ws:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw new Error("Bridge requires wss outside loopback");
  if (url.username || url.password || url.search || url.hash) throw new Error("Bridge credentials belong in the Authorization header");
  let stopHeartbeat: (() => void) | undefined;
  let subscriptions: BridgeStream[] = [];
  const timeout = options.requestTimeoutMs ?? 15000;
  const status = (value: "connecting" | "connected" | "offline") => {
    try { options.onStatusChange?.(value); } catch (error) { console.error("Bridge status listener failed", error); }
  };
  const connection = createBridgeConnectionLifecycle<WebSocket>({
    isOpen: (socket) => socket.readyState === WebSocket.OPEN,
    dispose(socket) { stopHeartbeat?.(); socket.terminate(); },
    status,
  });
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
        if (!connection.owns(candidate) || candidate.readyState !== WebSocket.OPEN) { stop(); return; }
        nonce = randomUUID();
        pongTimer = setTimeout(() => { stop(); connection.retire(candidate, new Error("Bridge heartbeat timed out")); }, options.heartbeatTimeoutMs ?? 10_000);
        pongTimer.unref();
        // Cloudflare handles protocol ping/pong without waking the account DO.
        candidate.ping(nonce, undefined, (error) => { if (error) { stop(); connection.retire(candidate, new Error("Bridge heartbeat timed out")); } });
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
  function receive(candidate: WebSocket, data: WebSocket.RawData) {
    let value: BridgeServerMessage | BridgeRpcResponse;
    try {
      const text = Array.isArray(data) ? Buffer.concat(data).toString() : Buffer.isBuffer(data) ? data.toString() : Buffer.from(data).toString();
      if (Buffer.byteLength(text) > BRIDGE_MAX_FRAME_BYTES) throw new Error("oversized");
      value = parseBridgeServerFrame(text);
    } catch { connection.retire(candidate, new Error("Invalid Bridge hub response")); return; }
    if ("requestId" in value && !("type" in value)) {
      connection.reply(candidate, value.requestId, "error" in value
        ? new Error(`Bridge hub rejected request: ${value.error.code}`) : value.message);
    } else {
      try {
        if (value.type === "presence") options.onPresence?.(value);
        else if (value.type === "changed") options.onChanged?.(value.stream);
        else if (value.type === "approval") options.onApproval?.(value);
        else if (value.type === "membership") options.onMembership?.(value.seq);
      } catch (error) { console.error("Bridge transport listener failed", error); }
    }
  }
  function connect(): Promise<WebSocket> {
    return connection.connect(async (scope) => {
      const token = typeof options.token === "function" ? await options.token() : options.token;
      if (!scope.current()) throw new Error(connection.closed ? "Bridge transport is closed" : "Bridge connection cancelled");
      return new Promise<WebSocket>((resolve, reject) => {
        const candidate = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, maxPayload: BRIDGE_MAX_FRAME_BYTES, handshakeTimeout: timeout });
        scope.bind(candidate);
        candidate.on("message", (data) => { if (connection.owns(candidate)) receive(candidate, data); });
        candidate.once("open", () => {
          if (!scope.open(candidate)) { candidate.terminate(); reject(new Error("Bridge connection cancelled")); return; }
          heartbeat(candidate); resolve(candidate); status("connected");
          if (!connection.owns(candidate)) return;
          if (options.metadata) candidate.send(JSON.stringify({ requestId: randomUUID(), message: { type: "hello", ...options.metadata } }));
          if (subscriptions.length) candidate.send(JSON.stringify({ requestId: randomUUID(), message: { type: "subscribe", streams: subscriptions } }));
        });
        candidate.on("error", () => { reject(new Error("Bridge connection failed")); });
        candidate.once("close", (code) => {
          if (connection.retire(candidate) && !connection.closed && code === 1008) {
            try { options.onAccessChanged?.(); } catch (error) { console.error("Bridge identity listener failed", error); }
          }
          reject(new Error("Bridge connection closed"));
        });
      });
    });
  }
  async function rpc(message: BridgeClientMessage): Promise<BridgeServerMessage> {
    const active = await connect(), requestId = randomUUID();
    return connection.request(active, requestId, timeout,
      (done) => active.send(JSON.stringify({ requestId, message }), done));
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
    disconnect: connection.disconnect,
    close: connection.close,
  };
  return api;
}
export type BridgeWebSocketTransport = ReturnType<typeof createBridgeWebSocketTransport>;
