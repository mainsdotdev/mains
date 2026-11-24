import { generateToken, hashToken } from "./ws-auth";
import { createAuthGrants } from "@mains/contracts/auth-lifecycle";

const DEFAULT_LOGIN_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_PENDING_LOGINS = 32;
const MAX_SESSIONS = 128;

interface PendingLogin {
  origin: string;
  secure: boolean;
}

interface ActiveSession {
  origin: string;
}

export interface WebLoginLink {
  link: string;
  expiresAt: Date;
}

export interface WebSessionCredentials {
  sessionToken: string;
  imageToken: string;
  expiresAt: number;
  secure: boolean;
}

export interface WebSessionAccess {
  expiresAt: number;
}
export interface WebSessionLease extends WebSessionAccess {
  signal: AbortSignal;
  current(): boolean;
}

export interface WebSessionManager {
  readonly sessionCookieName: string;
  readonly imageCookieName: string;
  createLogin(baseUrl: string): WebLoginLink;
  exchange(code: string | null, origin: string | null): WebSessionCredentials | null;
  verifySession(token: string | null, origin: string | null): WebSessionAccess | null;
  authorizeSession(token: string | null, origin: string | null): WebSessionLease | null;
  verifyImageSession(token: string | null, origin: string | null): boolean;
  clear(): void;
}

interface WebSessionManagerOptions {
  now?: () => number;
  loginTtlMs?: number;
  sessionTtlMs?: number;
}

function normalizeBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Browser login URL must be a valid HTTP(S) base URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Browser login URL must use HTTP or HTTPS");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("Browser login URL must be an origin without a path or credentials");
  }
  return new URL(`${url.origin}/`);
}

/**
 * Browser-only authentication state for one running WS host. The owner token
 * never enters the browser: a short-lived, origin-bound login code is exchanged
 * once for independent random session and image-proxy credentials. Everything
 * is memory-only, so a host restart or owner-token rotation revokes it all.
 */
export function createWebSessionManager(
  options: WebSessionManagerOptions = {},
): WebSessionManager {
  const now = options.now ?? Date.now;
  const loginTtlMs = options.loginTtlMs ?? DEFAULT_LOGIN_TTL_MS;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const pending = createAuthGrants<PendingLogin>(MAX_PENDING_LOGINS, now);
  const sessions = createAuthGrants<ActiveSession>(MAX_SESSIONS, now);
  const imageSessions = new Map<string, string>();

  // Cookie names are per-host-instance. Cookies ignore ports, so random names
  // prevent two Mains hosts on the same hostname from overwriting one another.
  const sessionCookieName = `mains_web_${generateToken().slice(0, 12)}`;
  const imageCookieName = `mains_img_${generateToken().slice(0, 12)}`;

  return {
    sessionCookieName,
    imageCookieName,

    createLogin(baseUrl) {
      const url = normalizeBaseUrl(baseUrl);
      const at = now();
      const code = generateToken();
      const expiresAt = at + loginTtlMs;
      pending.issue(hashToken(code), {
        origin: url.origin,
        secure: url.protocol === "https:",
      }, expiresAt);
      url.hash = new URLSearchParams({ login: code }).toString();
      return { link: url.toString(), expiresAt: new Date(expiresAt) };
    },

    exchange(code, origin) {
      if (!code || !origin) return null;
      const at = now();
      const key = hashToken(code);
      const login = pending.take(key, (entry) => entry.origin === origin);
      if (!login) return null;

      // Spend before minting: concurrent/retried exchanges cannot receive two
      // sessions from one magic link.
      const sessionToken = generateToken();
      const imageToken = generateToken();
      const expiresAt = at + sessionTtlMs;
      const sessionKey = hashToken(sessionToken), imageKey = hashToken(imageToken);
      const grant = sessions.issue(sessionKey, { origin }, expiresAt);
      imageSessions.set(imageKey, sessionKey);
      grant.signal.addEventListener("abort", () => imageSessions.delete(imageKey), { once: true });
      return {
        sessionToken,
        imageToken,
        expiresAt,
        secure: login.secure,
      };
    },

    verifySession(token, origin) {
      const session = this.authorizeSession(token, origin);
      return session ? { expiresAt: session.expiresAt } : null;
    },

    authorizeSession(token, origin) {
      if (!token || !origin) return null;
      const session = sessions.get(hashToken(token));
      if (!session || session.value.origin !== origin) return null;
      return { expiresAt: session.expiresAt, signal: session.signal, current: session.current };
    },

    verifyImageSession(token, origin) {
      if (!token || !origin) return false;
      const key = imageSessions.get(hashToken(token));
      return !!key && sessions.get(key)?.value.origin === origin;
    },

    clear() {
      pending.clear();
      sessions.clear();
      imageSessions.clear();
    },
  };
}
