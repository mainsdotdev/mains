import type { commandReceipts, pairedDevices } from "../../db/schema";

// ─────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────

/**
 * What a client learns about this backend before trusting it: who it is, which
 * protocol it speaks, and which channel namespaces it serves. Returned by
 * `backend:describe` — the first call a remote client makes after its socket
 * opens, and the answer that decides whether it treats the connection as usable.
 */
export interface BackendDescriptor {
  /** Stable identity of this install (`app_settings.backend_id`). */
  backendId: string;
  /** Human-readable label — the machine's hostname. */
  name: string;
  /** Mains version serving this backend. */
  appVersion: string;
  /** WS framing/payload version — see `WS_PROTOCOL_VERSION`. */
  protocolVersion: number;
  /** Channel namespaces reachable over the wire (`runs`, `workspace`, …), sorted. */
  capabilities: string[];
  /** Server clock (ISO 8601) so a client can spot skew before comparing timestamps. */
  serverTime: string;
}

// ─────────────────────────────────────────────────────────────
// Pairing — Database Record
// ─────────────────────────────────────────────────────────────
export type PairedDeviceRecord = typeof pairedDevices.$inferSelect;
export type PairedDevicePlatform = PairedDeviceRecord["platform"];

/** Renderer-facing projection of a paired device — never carries the token hash. */
export interface PairedDevice {
  id: string;
  name: string;
  platform: PairedDevicePlatform;
  appVersion: string | null;
  createdAt: Date;
  lastSeenAt: Date | null;
}

/** A freshly minted one-time pairing code plus the link the QR encodes. */
export interface PairingCode {
  code: string;
  /** `mains://pair#…` carrying the code, the backend's name, and candidate endpoints. */
  link: string;
  expiresAt: Date;
}

/** What a device posts to `POST /pair`. */
export interface PairDeviceInput {
  code: string;
  deviceName: string;
  platform: PairedDevicePlatform;
  appVersion?: string;
}

/** What `POST /pair` returns: the long-lived credential and who issued it. */
export interface PairDeviceResult {
  deviceId: string;
  deviceToken: string;
  backend: BackendDescriptor;
}

/** A device token resolved at the WS handshake: who it is and what it may invoke. */
export interface PairedDeviceAccess {
  deviceId: string;
  /** Read-only channels, invokable as-is. */
  channels: ReadonlySet<string>;
  /** Mutations — invokable only with a `commandId` (see `command_receipts`). */
  commandChannels: ReadonlySet<string>;
  /** Events pushed to the device; everything else on the bus stays local. */
  eventChannels: ReadonlySet<string>;
}

export type CommandReceiptRecord = typeof commandReceipts.$inferSelect;
