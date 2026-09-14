/**
 * Backend identity and pairing contract — mirrors `mains/src/main/modules/
 * backend/backend.dto.ts` and `modules/pairing/pairing.dto.ts`. React Native
 * free by design (see ws-protocol.ts).
 */

/** What `backend:describe` returns — who the backend is and what it serves. */
export interface BackendDescriptor {
  /** Stable identity of the install; a paired backend is keyed on it. */
  backendId: string;
  /** Human-readable label — the machine's hostname. */
  name: string;
  appVersion: string;
  /** WS framing/payload version; compare with `WS_PROTOCOL_VERSION`. */
  protocolVersion: number;
  /** Channel namespaces reachable over the wire (`runs`, `workspace`, …). */
  capabilities: string[];
  /** Server clock, ISO 8601. */
  serverTime: string;
}

export type PairedDevicePlatform = "ios" | "android" | "web" | "unknown";

/** Body of `POST /pair`. */
export interface PairDeviceInput {
  code: string;
  deviceName: string;
  platform: PairedDevicePlatform;
  appVersion?: string;
}

/** Reply of `POST /pair`. */
export interface PairDeviceResult {
  deviceId: string;
  deviceToken: string;
  backend: BackendDescriptor;
}

export function isPairDeviceResult(value: unknown): value is PairDeviceResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const backend = v.backend as Record<string, unknown> | undefined;
  return (
    typeof v.deviceId === "string" &&
    typeof v.deviceToken === "string" &&
    !!backend &&
    typeof backend.backendId === "string" &&
    typeof backend.name === "string" &&
    typeof backend.protocolVersion === "number"
  );
}

/** What the desktop's pairing QR encodes: `mains://pair#code=…&name=…&endpoint=…`. */
export interface PairingLink {
  code: string;
  /** Backend name, for the "pair with X?" prompt before anything is exchanged. */
  name: string;
  /** http(s) base URLs the backend may be reachable on, most private first. */
  endpoints: string[];
}

// Every app variant's scheme is accepted by the in-app scanner, so a QR from
// a desktop always pairs regardless of which build scanned it.
const PAIRING_LINK = /^(?:mains|mains-dev|mains-preview):\/\/pair(?:[/?][^#]*)?#(.+)$/;
const HTTP_URL = /^https?:\/\/[^/\s]+/i;

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

/**
 * Parse a scanned pairing link. Hand-rolled rather than `new URL()` because the
 * fragment carries the secret and React Native's URL implementation is partial.
 */
export function parsePairingLink(value: string): PairingLink | null {
  const match = PAIRING_LINK.exec(value.trim());
  if (!match) return null;

  let code = "";
  let name = "";
  const endpoints: string[] = [];
  for (const pair of match[1].split("&")) {
    const separator = pair.indexOf("=");
    const key = decodeComponent(separator === -1 ? pair : pair.slice(0, separator));
    const raw = separator === -1 ? "" : decodeComponent(pair.slice(separator + 1));
    if (key === "code") code = raw;
    else if (key === "name") name = raw;
    else if (key === "endpoint" && HTTP_URL.test(raw)) endpoints.push(raw);
  }

  if (!code || endpoints.length === 0) return null;
  return { code, name: name || "Mains", endpoints };
}

/** `http://…` → `ws://…`, `https://…` → `wss://…`. */
export function toWebSocketUrl(endpoint: string): string {
  return endpoint.replace(/^http/i, "ws");
}

/** Host shown in the UI for an endpoint (`mac.tailnet.ts.net`, `192.168.1.5:8787`). */
export function endpointHost(endpoint: string): string {
  return endpoint.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}
