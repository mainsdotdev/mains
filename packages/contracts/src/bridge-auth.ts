/** Public identity/key ceremony. Account and device private keys stay on backends. */
export interface BridgeSealedAccountKey { v: 1; ephemeralPublicKey: string; nonce: string; payload: string }
export interface BridgeRecoveryWrap {
  v: 1;
  kdf: { name: "argon2id"; memoryKiB: 65536; iterations: 3; parallelism: 1; salt: string };
  nonce: string;
  payload: string;
}
export interface BridgeRegisteredBackend {
  backendId: string; publicKey: string; label: string; platform: string;
  status: "pending" | "approved" | "revoked";
  createdAt: string; lastSeen: string | null;
}
export interface BridgeApprovalRequest {
  requestId: string; backendId: string; publicKey: string; label: string; platform: string;
  code: string; expiresAt: string;
}
export interface BridgeSignInInput {
  hubUrl: string; label?: string; includeExisting: boolean;
  flow?: "loopback" | "device";
}
export interface BridgeAuthStatus {
  state: "signed-out" | "signing-in" | "needs-approval" | "needs-verification" | "ready" | "revoked" | "error";
  hubUrl: string | null; accountId: string | null; email: string | null;
  backendId: string; label: string; verificationCode: string | null;
  /** Locally derived from a trusted active key; never expose the pending key's expected answer. */
  accountFingerprint: string | null;
  login: { url: string; code: string | null; expiresAt: string } | null;
  approvals: BridgeApprovalRequest[];
  backends: BridgeRegisteredBackend[];
  recoveryCodeAvailable: boolean;
  existing: { runs: number; pages: number };
  localHistory?: number;
  logoutPending?: boolean;
  error: string | null;
}
export interface BridgeAccountKeys {
  recoveryPublicKey: string;
  recovery: BridgeRecoveryWrap;
}
export const BRIDGE_AUTH_CLIENT_ID = "mains-backend";
export const BRIDGE_RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function bridgeBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function bridgeBytes(value: unknown, size: number): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid Bridge key encoding");
  const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)), (c) => c.charCodeAt(0));
  if (bytes.length !== size || bridgeBase64(bytes) !== value) throw new Error("Invalid Bridge key encoding");
  return bytes;
}
export function validateBridgeDeviceWrap(value: unknown): asserts value is BridgeSealedAccountKey {
  const wrap = value as BridgeSealedAccountKey;
  if (!wrap || wrap.v !== 1 || Object.keys(wrap).length !== 4) throw new Error("Invalid Bridge device wrap");
  bridgeBytes(wrap.ephemeralPublicKey, 32); bridgeBytes(wrap.nonce, 24); bridgeBytes(wrap.payload, 48);
}
export function validateBridgeRecoveryWrap(value: unknown): asserts value is BridgeRecoveryWrap {
  const wrap = value as BridgeRecoveryWrap, kdf = wrap?.kdf;
  if (!wrap || wrap.v !== 1 || Object.keys(wrap).length !== 4 || !kdf || Object.keys(kdf).length !== 5 ||
    kdf.name !== "argon2id" || kdf.memoryKiB !== 65536 || kdf.iterations !== 3 || kdf.parallelism !== 1)
    throw new Error("Unsupported Bridge recovery parameters");
  bridgeBytes(kdf.salt, 16); bridgeBytes(wrap.nonce, 24); bridgeBytes(wrap.payload, 48);
}
export async function bridgeApprovalCode(publicKey: string): Promise<string> {
  bridgeBytes(publicKey, 32);
  const message = new TextEncoder().encode(JSON.stringify([2, "mains.bridge.v2/device-approval", publicKey]));
  return formatBridgeVerificationCode(new Uint8Array(await crypto.subtle.digest("SHA-256", message)));
}
/** Twelve base32 characters retain 60 bits. No six-character compatibility path. */
export function formatBridgeVerificationCode(bytes: Uint8Array): string {
  if (bytes.length < 8) throw new Error("Verification requires at least 60 bits");
  const code = Array.from({ length: 12 }, (_, i) => {
    const bit = i * 5, byte = bit >>> 3;
    return BRIDGE_RECOVERY_ALPHABET[((bytes[byte] << 8 | bytes[byte + 1]) >>> (11 - (bit & 7))) & 31];
  }).join("");
  return code.match(/.{4}/g)!.join("-");
}
export function isBridgeVerificationCode(value: unknown): value is string {
  return typeof value === "string" && /^(?:[A-HJ-NP-Z2-9]{4}-){2}[A-HJ-NP-Z2-9]{4}$/.test(value);
}
export function normalizeBridgeVerificationCode(value: string): string {
  if (typeof value !== "string") throw new Error("Enter the 12-character verification code");
  const code = value.toUpperCase().replace(/[\s-]/g, "");
  const formatted = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
  if (!isBridgeVerificationCode(formatted)) throw new Error("Enter the 12-character verification code");
  return formatted;
}
export function bridgeRecoveryMessage(accountId: string, backendId: string, publicKey: string, challenge: string, wrap: BridgeSealedAccountKey): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([1, "mains.bridge.v1/recovery-approval", accountId, backendId, publicKey, challenge,
    [wrap.v, wrap.ephemeralPublicKey, wrap.nonce, wrap.payload]]));
}
