import * as crypto from "crypto";

// Secret lives in main-process memory only. Regenerated on each launch — that
// means any URLs persisted across app restarts will fail signature verification
// and force a re-sign. That's intentional: signed URLs are meant to be
// short-lived references, not durable identifiers.
const SECRET = crypto.randomBytes(32);

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const SCHEME = "mains-localimg";
const DOC_SCHEME = "mains-localdoc";

function hmac(payload: string): string {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function signLocalImagePath(absPath: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const payload = `${absPath}|${exp}`;
  const sig = hmac(payload);
  const params = new URLSearchParams({
    path: absPath,
    exp: String(exp),
    sig,
  });
  return `${SCHEME}://img/?${params.toString()}`;
}

/**
 * Same HMAC scheme as {@link signLocalImagePath}, but for the `mains-localdoc://`
 * protocol that serves Office documents (.docx/.xlsx/.pptx) to the renderer.
 * The signature payload is identical (`path|exp`) so {@link verifySignedPath}
 * validates URLs from both schemes without modification.
 */
export function signLocalDocumentPath(
  absPath: string,
  ttlMs: number = DEFAULT_TTL_MS,
): string {
  const exp = Date.now() + ttlMs;
  const payload = `${absPath}|${exp}`;
  const sig = hmac(payload);
  const params = new URLSearchParams({
    path: absPath,
    exp: String(exp),
    sig,
  });
  return `${DOC_SCHEME}://doc/?${params.toString()}`;
}

export interface VerifiedSignedPath {
  ok: true;
  path: string;
}
export interface InvalidSignedPath {
  ok: false;
  reason: "missing" | "expired" | "bad-signature";
}

export function verifySignedPath(
  rawPath: string | null,
  rawExp: string | null,
  rawSig: string | null,
): VerifiedSignedPath | InvalidSignedPath {
  if (!rawPath || !rawExp || !rawSig) {
    return { ok: false, reason: "missing" };
  }
  const exp = Number(rawExp);
  if (!Number.isFinite(exp) || exp < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  const expected = hmac(`${rawPath}|${exp}`);
  const a = Buffer.from(rawSig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-signature" };
  }
  return { ok: true, path: rawPath };
}
