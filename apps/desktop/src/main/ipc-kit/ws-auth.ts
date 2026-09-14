import { createHash, randomBytes, timingSafeEqual } from "crypto";

/**
 * Pairing-token helpers for the WebSocket backend. The token guards the backend
 * against unauthorized clients on every bind — loopback included, since any web
 * page the user opens can reach 127.0.0.1 — and for a directly-exposed backend
 * it's the only thing standing between the network and full control. See
 * docs/design/remote-backend.md (Phase: pairing token).
 */

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Constant-time token comparison. Both inputs are hashed first so the compare is
 * over fixed-length buffers (no length leak, no timing leak).
 */
export function tokensMatch(expected: string, presented: string | null): boolean {
  if (!presented) return false;
  return timingSafeEqual(digest(expected), digest(presented));
}

/** Generate a fresh URL-safe pairing token. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * One-way fingerprint of a token for at-rest storage and lookup (paired-device
 * tokens are stored only as this hash). Hex so it can live in a text column.
 */
export function hashToken(token: string): string {
  return digest(token).toString("hex");
}
