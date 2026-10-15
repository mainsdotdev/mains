import { betterAuth } from "better-auth";
import { bearer, deviceAuthorization, magicLink } from "better-auth/plugins";
import { BRIDGE_AUTH_CLIENT_ID } from "@mains/contracts/bridge-auth";

export interface AuthEnv {
  AUTH_DB?: D1Database;
  BETTER_AUTH_SECRET?: string;
  BRIDGE_AUTH_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  AUTH_MAILER?: Fetcher;
}
const cache = new WeakMap<object, Map<string, ReturnType<typeof createAuth>>>();
function createAuth(env: AuthEnv, baseURL: string) {
  if (!env.AUTH_DB || !env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) throw new Error("Bridge sign-in is not configured");
  return betterAuth({
    database: env.AUTH_DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    basePath: "/api/auth",
    trustedOrigins: [baseURL],
    socialProviders: env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } } : {},
    session: { expiresIn: 60 * 60 * 24, cookieCache: { enabled: false } },
    account: { accountLinking: { enabled: true, trustedProviders: ["github"] }, encryptOAuthTokens: true },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    advanced: { database: { generateId: () => crypto.randomUUID() }, useSecureCookies: baseURL.startsWith("https:"), ipAddress: { ipAddressHeaders: ["CF-Connecting-IP"] } },
    plugins: [bearer(), deviceAuthorization({ verificationUri: `${baseURL}/device`, expiresIn: "10m", interval: "5s", validateClient: (id) => id === BRIDGE_AUTH_CLIENT_ID }),
      magicLink({ expiresIn: 300, storeToken: "hashed", async sendMagicLink({ email, url }) {
        let response: Response;
        if (env.AUTH_MAILER) response = await env.AUTH_MAILER.fetch("https://bridge-mail.internal/send", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: email, url }),
        });
        else if (env.RESEND_API_KEY && env.MAIL_FROM) response = await fetch("https://api.resend.com/emails", {
          method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject: "Sign in to Mains Bridge", text: `Sign in to Mains Bridge: ${url}\nThis link expires in five minutes.` }),
        });
        else throw new Error("Email sign-in is not configured");
        if (!response.ok) throw new Error("Could not send the sign-in email");
      } })],
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
