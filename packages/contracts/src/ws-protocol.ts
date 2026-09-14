import type { ServiceResponse } from "./service-response";

export type { ServiceResponse } from "./service-response";

/**
 * Wire protocol for the renderer↔backend WebSocket transport. It mirrors the
 * Electron IPC seam exactly:
 *
 *  - `invoke` / `response` — request/response, like `ipcRenderer.invoke` ↔
 *    `ipcMain.handle`. The `ServiceResponse` envelope crosses the wire unchanged,
 *    so the renderer's `ipcBaseQuery` behaves identically.
 *  - `event` — a one-way push, like `webContents.send` ↔ `ipcRenderer.on`. The
 *    server broadcasts events to connected clients; each client dispatches them
 *    to its local listeners by channel (no explicit subscribe handshake, matching
 *    the "broadcast to all windows" model).
 *
 * JSON over a text WebSocket frame is sufficient. See docs/design/remote-backend.md.
 */

/** Client → server: invoke a `"domain:action"` channel with positional args. */
export interface WsInvokeMessage {
  kind: "invoke";
  /** Correlation id, unique per connection, echoed back in the response. */
  id: number;
  channel: string;
  args: unknown[];
  /**
   * Idempotency key for a mutation from a paired device: the router replays
   * the stored response for a repeated `commandId` instead of running the
   * handler again, so a command re-sent after a dropped connection can't apply
   * twice. Required on command channels for devices; ignored otherwise.
   */
  commandId?: string;
}

/** Server → client: the result of a prior {@link WsInvokeMessage}. */
export interface WsResponseMessage {
  kind: "response";
  id: number;
  result: ServiceResponse<unknown>;
}

/** Server → client: a pushed event on a channel. */
export interface WsEventMessage {
  kind: "event";
  channel: string;
  payload: unknown;
}

export type WsClientMessage = WsInvokeMessage;
export type WsServerMessage = WsResponseMessage | WsEventMessage;
export type WsMessage = WsClientMessage | WsServerMessage;

// ── Pairing-token transport ──
// Browsers can't set custom WS handshake headers, so the optional pairing token
// travels as a WebSocket subprotocol: the client offers [WS_SUBPROTOCOL, token
// subprotocol], the server validates it at the handshake. See ws-auth.ts.

/** Base subprotocol both sides advertise (also the one the server echoes back). */
export const WS_SUBPROTOCOL = "mains.v1";
/**
 * Version of the invoke/response/event framing plus the channel payload shapes a
 * client may rely on. Reported by `backend:describe`; bump on a breaking change
 * so an older phone build can refuse to sync rather than misread frames.
 */
export const WS_PROTOCOL_VERSION = 1;
const TOKEN_SUBPROTOCOL_PREFIX = "mains.token.";

/** Build the subprotocol list a client sends (token optional). */
export function buildSubprotocols(token?: string | null): string[] {
  return token
    ? [WS_SUBPROTOCOL, TOKEN_SUBPROTOCOL_PREFIX + token]
    : [WS_SUBPROTOCOL];
}

/** Extract the presented token from offered subprotocols, or null if none. */
export function extractToken(protocols: Iterable<string>): string | null {
  for (const protocol of protocols) {
    if (protocol.startsWith(TOKEN_SUBPROTOCOL_PREFIX)) {
      return protocol.slice(TOKEN_SUBPROTOCOL_PREFIX.length);
    }
  }
  return null;
}

/** Parse a raw `Sec-WebSocket-Protocol` header value into trimmed entries. */
export function parseProtocolHeader(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Electron IPC uses structured clone, which preserves `Date`; plain JSON does
// not. To keep the WS transport behaviorally identical to local IPC, Date values
// are tagged on the way out and reconstructed on the way in, wherever they appear
// in args / result / payload. (Binary file reads cross the boundary as strings,
// so Buffer/Uint8Array handling is intentionally omitted.)
const DATE_TAG = "$date";
// JSON.stringify turns `undefined` array elements into `null`, so an optional
// trailing IPC arg passed as `undefined` would arrive as `null` on the backend
// and skip its parameter default (which only fires for `undefined`). Electron's
// structured clone preserves `undefined`; tag it so WS behaves the same.
const UNDEFINED_TAG = "$undefined";

function dateReplacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
  // `this[key]` is the original value before Date.prototype.toJSON ran on `value`.
  const raw = this[key];
  if (raw === undefined) return { [UNDEFINED_TAG]: true };
  if (raw instanceof Date) return { [DATE_TAG]: raw.toISOString() };
  return value;
}

function dateReviver(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === DATE_TAG && typeof obj[DATE_TAG] === "string") {
      return new Date(obj[DATE_TAG] as string);
    }
    if (keys.length === 1 && keys[0] === UNDEFINED_TAG && obj[UNDEFINED_TAG] === true) {
      return undefined;
    }
  }
  return value;
}

export function encodeWsMessage(message: WsMessage): string {
  return JSON.stringify(message, dateReplacer);
}

/** Encode a value (e.g. a stored ServiceResponse) with the wire's Date/undefined tags. */
export function encodeWireValue(value: unknown): string {
  return JSON.stringify(value, dateReplacer);
}

/** Inverse of {@link encodeWireValue}. */
export function decodeWireValue(text: string): unknown {
  return JSON.parse(text, dateReviver);
}

/**
 * Parse and minimally validate an incoming frame. Throws on malformed input so
 * callers can ignore/log it rather than acting on garbage.
 */
export function decodeWsMessage(data: string): WsMessage {
  const parsed = JSON.parse(data, dateReviver) as unknown;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { kind?: unknown }).kind !== "string"
  ) {
    throw new Error("Invalid WS message: missing kind");
  }
  const kind = (parsed as { kind: string }).kind;
  if (kind !== "invoke" && kind !== "response" && kind !== "event") {
    throw new Error(`Invalid WS message: unknown kind "${kind}"`);
  }
  return parsed as WsMessage;
}
