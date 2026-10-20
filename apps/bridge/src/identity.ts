import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { waitUntil } from "cloudflare:workers";
import { bearer, deviceAuthorization, magicLink } from "better-auth/plugins";
import { BRIDGE_AUTH_CLIENT_ID } from "@mains/contracts/bridge-auth";
import { reportBridgeFailure, type BridgeDiagnosticsEnv } from "./observability";
import { bridgeMailConfigured, BridgeMailLimitError, deliverBridgeMail, type BridgeMail, type BridgeMailEnv } from "./auth-mail";

export interface AuthEnv extends BridgeDiagnosticsEnv, BridgeMailEnv {
  BRIDGE_ENV?: "local" | "staging" | "production";
  AUTH_DB?: D1Database;
  BETTER_AUTH_SECRET?: string;
  BRIDGE_AUTH_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}
const cache = new WeakMap<object, Map<string, ReturnType<typeof createAuth>>>();
function createAuth(env: AuthEnv, baseURL: string) {
  if (!env.AUTH_DB || !env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) throw new Error("Bridge sign-in is not configured");
  // The sign-in link is sent while its request waits, so the daily limit reaches the form as a readable 429.
  const mail = async (message: BridgeMail) => {
    try { await deliverBridgeMail(env, message); }
    catch (error) { throw error instanceof BridgeMailLimitError ? new APIError("TOO_MANY_REQUESTS", { message: error.message }) : error; }
  };
  return betterAuth({
    database: env.AUTH_DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    basePath: "/api/auth",
    trustedOrigins: [baseURL],
    logger: { level: "error", log(level) { if (level === "error") reportBridgeFailure(env, "auth"); } },
    socialProviders: env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } } : {},
    emailAndPassword: {
      enabled: bridgeMailConfigured(env), requireEmailVerification: true, autoSignIn: false,
      minPasswordLength: 12, maxPasswordLength: 128, resetPasswordTokenExpiresIn: 900, revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) => mail({ to: user.email, url, kind: "reset-password" }),
    },
    // Verification mail goes out once, at sign-up. A missed link is replaced by an email sign-in link,
    // which verifies the address too, rather than by another mail on every password attempt.
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: false, autoSignInAfterVerification: false, expiresIn: 3600,
      sendVerificationEmail: ({ user, url }) => mail({ to: user.email, url, kind: "verify-email" }),
    },
    session: { expiresIn: 60 * 60 * 24, cookieCache: { enabled: false } },
    account: { accountLinking: { enabled: true, trustedProviders: ["github"], requireLocalEmailVerified: true }, encryptOAuthTokens: true },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    advanced: { database: { generateId: () => crypto.randomUUID() }, useSecureCookies: baseURL.startsWith("https:"), ipAddress: { ipAddressHeaders: ["CF-Connecting-IP"] }, backgroundTasks: { handler: waitUntil } },
    plugins: [bearer(), deviceAuthorization({ verificationUri: `${baseURL}/device`, expiresIn: "10m", interval: "5s", validateClient: (id) => id === BRIDGE_AUTH_CLIENT_ID }),
      magicLink({ expiresIn: 300, storeToken: "hashed", sendMagicLink: ({ email, url }) => mail({ to: email, url, kind: "sign-in" }) })],
  });
}
export function bridgeAuth(env: AuthEnv, request: Request) {
  const url = new URL(env.BRIDGE_AUTH_URL ?? new URL(request.url).origin);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw new Error("Bridge sign-in requires HTTPS");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Configure the Bridge origin without a path or credentials");
  const origin = url.origin;
  let entries = cache.get(env.AUTH_DB!);
  if (!entries) { entries = new Map(); if (env.AUTH_DB) cache.set(env.AUTH_DB, entries); }
  let auth = entries.get(origin);
  if (!auth) { auth = createAuth(env, origin); entries.set(origin, auth); }
  return auth;
}
export async function signedInUser(env: AuthEnv, request: Request) {
  const result = await bridgeAuth(env, request).api.getSession({ headers: request.headers });
  if (!result?.user.emailVerified) return null;
  return result.user;
}
export const digestToken = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, "0")).join("");
export const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
