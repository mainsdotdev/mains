/** Go relay routing contract. Device credentials and application frames only
 * travel inside the encrypted payload, never in relay routing headers. */
export const RELAY_PROTOCOL = "mains-relay.v1";
export const RELAY_MAX_FRAME_CHARS = 6 * 1024 * 1024;

export interface RelayAccess {
  /** ws(s) origin, without credentials, a query, or a fragment. */
  url: string;
  ticket: string;
  backendPublicKey: string;
  expiresAt: string;
}

export type RelayFrame =
  | { type: "open"; id: string; deviceId: string }
  | { type: "data"; id: string; payload: string }
  | { type: "close"; id: string };

export function validateRelayUrl(value: string): string {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "wss:" && !(url.protocol === "ws:" && loopback)) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Relay requires a WSS origin (WS is allowed on loopback only)");
  }
  return url.origin;
}

export function isRelayAccess(value: unknown): value is RelayAccess {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.url !== "string" || typeof v.ticket !== "string" || v.ticket.length > 2048 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(v.ticket) ||
      typeof v.backendPublicKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(v.backendPublicKey) ||
      typeof v.expiresAt !== "string" || !Number.isFinite(Date.parse(v.expiresAt))) return false;
  try { validateRelayUrl(v.url); return true; } catch { return false; }
}
