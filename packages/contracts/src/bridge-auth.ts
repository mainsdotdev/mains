/** Public identity/key ceremony. Account and device private keys stay on backends. */
export interface BridgeSealedAccountKey { v: 1; ephemeralPublicKey: string; nonce: string; payload: string }
export interface BridgeRecoveryWrap {
  v: 1;
  kdf: { name: "argon2id"; memoryKiB: 65536; iterations: 3; parallelism: 1; salt: string };
  nonce: string;
  payload: string;
}
export interface BridgeDevicePublicKeys {
  /** X25519 recipient key. Independent of the Ed25519 writer key. */
  publicKey: string;
  signingPublicKey: string;
}
export interface BridgeDeviceIdentity extends BridgeDevicePublicKeys { accountId: string; backendId: string }
export interface BridgeRegisteredBackend extends BridgeDevicePublicKeys {
  backendId: string; label: string; platform: string;
  status: "pending" | "approved" | "revoked";
  createdAt: string; lastSeen: string | null;
}
export interface BridgeApprovalRequest extends BridgeDevicePublicKeys {
  requestId: string; backendId: string; label: string; platform: string;
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
  /** Shown only by an active member: the code each device it can see admitted by approval enters to
   * pin that history. A device waiting for verification never exposes its own expected answer. */
  joinCodes: BridgeJoinCode[];
  login: { url: string; code: string | null; expiresAt: string } | null;
  approvals: BridgeApprovalRequest[];
  backends: BridgeRegisteredBackend[];
  recoveryCodeAvailable: boolean;
  existing: { runs: number; pages: number };
  localHistory?: number;
  logoutPending?: boolean;
  error: string | null;
}
export interface BridgeJoinCode { backendId: string; label: string; code: string }
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
function deviceIdentity(identity: BridgeDeviceIdentity): [string, string, string, string] {
  if (!identity || ![identity.accountId, identity.backendId].every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)))
    throw new Error("Invalid Bridge device identity");
  bridgeBytes(identity.publicKey, 32); bridgeBytes(identity.signingPublicKey, 32);
  return [identity.accountId, identity.backendId, identity.publicKey, identity.signingPublicKey];
}
export async function bridgeApprovalCode(identity: BridgeDeviceIdentity): Promise<string> {
  const message = new TextEncoder().encode(JSON.stringify([3, "mains.bridge.v3/device-approval", ...deviceIdentity(identity)]));
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
