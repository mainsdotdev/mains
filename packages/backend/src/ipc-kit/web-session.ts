import { generateToken, hashToken } from "./ws-auth";

const DEFAULT_LOGIN_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_PENDING_LOGINS = 32;
const MAX_SESSIONS = 128;

interface PendingLogin {
  expiresAt: number;
  origin: string;
  secure: boolean;
}

interface ActiveSession {
  expiresAt: number;
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

export interface WebSessionManager {
  readonly sessionCookieName: string;
  readonly imageCookieName: string;
  createLogin(baseUrl: string): WebLoginLink;
  exchange(code: string | null, origin: string | null): WebSessionCredentials | null;
  verifySession(token: string | null, origin: string | null): WebSessionAccess | null;
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

function deleteOldest(map: Map<string, unknown>, maximum: number): void {
  while (map.size >= maximum) {
    const oldest = map.keys().next().value as string | undefined;
    if (!oldest) return;
    map.delete(oldest);
  }
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
  const pending = new Map<string, PendingLogin>();
  const sessions = new Map<string, ActiveSession>();
  const imageSessions = new Map<string, ActiveSession>();

  // Cookie names are per-host-instance. Cookies ignore ports, so random names
  // prevent two Mains hosts on the same hostname from overwriting one another.
  const sessionCookieName = `mains_web_${generateToken().slice(0, 12)}`;
  const imageCookieName = `mains_img_${generateToken().slice(0, 12)}`;

  const prune = (at: number) => {
    for (const [key, entry] of pending) {
      if (entry.expiresAt <= at) pending.delete(key);
    }
    for (const [key, entry] of sessions) {
      if (entry.expiresAt <= at) sessions.delete(key);
    }
    for (const [key, entry] of imageSessions) {
      if (entry.expiresAt <= at) imageSessions.delete(key);
    }
  };

  return {
    sessionCookieName,
    imageCookieName,

    createLogin(baseUrl) {
      const url = normalizeBaseUrl(baseUrl);
      const at = now();
      prune(at);
      deleteOldest(pending, MAX_PENDING_LOGINS);
      const code = generateToken();
      const expiresAt = at + loginTtlMs;
      pending.set(hashToken(code), {
        expiresAt,
        origin: url.origin,
        secure: url.protocol === "https:",
      });
      url.hash = new URLSearchParams({ login: code }).toString();
      return { link: url.toString(), expiresAt: new Date(expiresAt) };
    },

    exchange(code, origin) {
      if (!code || !origin) return null;
      const at = now();
      prune(at);
      const key = hashToken(code);
      const login = pending.get(key);
      if (!login || login.origin !== origin) return null;

      // Spend before minting: concurrent/retried exchanges cannot receive two
      // sessions from one magic link.
      pending.delete(key);
      deleteOldest(sessions, MAX_SESSIONS);
      deleteOldest(imageSessions, MAX_SESSIONS);

      const sessionToken = generateToken();
      const imageToken = generateToken();
      const expiresAt = at + sessionTtlMs;
      sessions.set(hashToken(sessionToken), { expiresAt, origin });
      imageSessions.set(hashToken(imageToken), { expiresAt, origin });
      return {
        sessionToken,
        imageToken,
        expiresAt,
        secure: login.secure,
      };
    },

    verifySession(token, origin) {
      if (!token || !origin) return null;
      const at = now();
      prune(at);
      const session = sessions.get(hashToken(token));
      if (!session || session.origin !== origin) return null;
      return { expiresAt: session.expiresAt };
    },

    verifyImageSession(token, origin) {
      if (!token || !origin) return false;
      const at = now();
      prune(at);
      return imageSessions.get(hashToken(token))?.origin === origin;
    },

    clear() {
      pending.clear();
      sessions.clear();
      imageSessions.clear();
    },
  };
}
