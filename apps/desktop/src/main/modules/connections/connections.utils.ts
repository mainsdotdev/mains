import crypto from "crypto";
import os from "os";
import { safeStorage } from "electron";
import { fail } from "../../../shared/ipc-kit/service-response";
import type { ParsedCredentials } from "./connections.dto";

// ─────────────────────────────────────────────────────────────
// Source Name Formatting
// ─────────────────────────────────────────────────────────────
export function formatSourceName(source: string): string {
  const names: Record<string, string> = {
    playlists: "Library Playlists",
    "recently-played": "Recently Played",
    "heavy-rotation": "Heavy Rotation",
    "top-tracks": "Top Tracks",
    "top-artists": "Top Artists",
    "saved-albums": "Saved Albums",
  };
  return names[source] || source;
}

// ─────────────────────────────────────────────────────────────
// Metadata Parsing
// ─────────────────────────────────────────────────────────────
export function parseConnectionMetadata(
  metadata: string | object | null
): Record<string, unknown> {
  if (!metadata) return {};
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return metadata as Record<string, unknown>;
}

export function parseResourceMetadata(
  metadata: string | null
): Record<string, unknown> {
  if (!metadata) return {};
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────
// AES-256-GCM Fallback — LEGACY, DECRYPT-ONLY
// Retained solely to read credentials written by older versions. New writes
// always go through safeStorage (see `encryptToken`, which now fails closed).
// The key was derived from public machine identifiers, so it must never be
// used to encrypt new secrets.
// ─────────────────────────────────────────────────────────────
const FALLBACK_SALT = Buffer.from("mains-credential-encryption-salt");
const FALLBACK_IV_LENGTH = 16;
const FALLBACK_AUTH_TAG_LENGTH = 16;

let _fallbackKey: Buffer | null = null;

function getFallbackKey(): Buffer {
  if (_fallbackKey) return _fallbackKey;
  const machineId = [os.hostname(), os.homedir(), os.userInfo().username].join(":");
  _fallbackKey = crypto.pbkdf2Sync(machineId, FALLBACK_SALT, 100_000, 32, "sha512");
  return _fallbackKey;
}

function fallbackDecrypt(buffer: Buffer): string {
  const iv = buffer.subarray(0, FALLBACK_IV_LENGTH);
  const authTag = buffer.subarray(FALLBACK_IV_LENGTH, FALLBACK_IV_LENGTH + FALLBACK_AUTH_TAG_LENGTH);
  const encrypted = buffer.subarray(FALLBACK_IV_LENGTH + FALLBACK_AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getFallbackKey(), iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final("utf-8");
}

// ─────────────────────────────────────────────────────────────
// Encryption Helpers
// ─────────────────────────────────────────────────────────────
function encryptToken(token: string): Buffer {
  // Fail closed: only ever persist secrets under the OS keychain (safeStorage,
  // Keychain-backed on macOS). The legacy AES fallback derived its key from
  // public machine identifiers (hostname/homedir/username) — decryptable by
  // anyone who can read the DB file — so we refuse to write under it rather
  // than provide a false sense of at-rest encryption. On a healthy macOS
  // install safeStorage is always available, so this never trips in practice;
  // callers (e.g. saveCredentials) surface the thrown error as a failed save.
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "Secure credential storage is unavailable (OS keychain/safeStorage not ready); refusing to store credentials.",
    );
  }
  return safeStorage.encryptString(token);
}

function decryptToken(buffer: Buffer): string {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(buffer);
    } catch (err) {
      console.error("[Credentials] safeStorage decryption failed, attempting fallback:", err);
    }
  }
  try {
    return fallbackDecrypt(buffer);
  } catch (err) {
    console.error("[Credentials] Fallback decryption also failed:", err);
    throw new Error("Failed to decrypt credentials — data may be corrupted");
  }
}

export function encryptSecrets(secrets: Record<string, string>): Buffer {
  return encryptToken(JSON.stringify(secrets));
}

export function decryptSecrets(buffer: Buffer): Record<string, string> {
  const raw = decryptToken(buffer);
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("[Credentials] Failed to parse decrypted secrets as JSON:", err);
    throw new Error("Decrypted credential data is not valid JSON — token may be corrupted");
  }
}

export function createTokenHash(tokens: string[]): Buffer {
  return Buffer.from(
    crypto.createHash("sha256").update(tokens.join(":")).digest()
  );
}

// ─────────────────────────────────────────────────────────────
// Provider Secret Fields Configuration
// ─────────────────────────────────────────────────────────────
const PROVIDER_SECRET_FIELDS: Record<string, { required: string[]; optional?: string[] }> = {
  github: { required: ["token"] },
  linear: { required: ["apiKey"] },
  jira: { required: ["apiToken"] },
  gitlab: { required: ["token"] },
  asana: { required: ["accessToken"] },
  trello: { required: ["token", "apiKey"] },
  sentry: { required: ["token"] },
  socketdev: { required: ["apiToken"] },
};

export function parseProviderCredentials(
  provider: string,
  credentials: Record<string, unknown>
):
  | { success: true; data: ParsedCredentials }
  | { success: false; error: string } {
  const config = PROVIDER_SECRET_FIELDS[provider];
  if (!config) {
    return fail(`Unsupported provider: ${provider}`);
  }

  const secrets: Record<string, string> = {};
  const allValues: string[] = [];

  for (const field of config.required) {
    const value = credentials[field];
    if (!value || typeof value !== "string") {
      return fail(`${field} is required`);
    }
    secrets[field] = value;
    allValues.push(value);
  }

  if (config.optional) {
    for (const field of config.optional) {
      const value = credentials[field];
      if (value && typeof value === "string") {
        secrets[field] = value;
        allValues.push(value);
      }
    }
  }

  return {
    success: true,
    data: {
      secrets,
      tokensForHash: allValues,
    },
  };
}
