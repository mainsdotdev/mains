import { createServer } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { BRIDGE_AUTH_CLIENT_ID } from "@mains/contracts/bridge-auth";

export function bridgeHubUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw new Error("Bridge requires HTTPS outside local development");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Enter the Bridge hub's base URL");
  return url.origin;
}
export class BridgeHttpError extends Error { constructor(readonly status: number, message: string, readonly code?: string) { super(message); } }
export async function bridgeHttp<T>(hub: string, route: string, token?: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(new URL(route, hub), { method: method ?? (body === undefined ? "GET" : "POST"), redirect: "error",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Origin: new URL(hub).origin, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
  const result = await response.json().catch(() => null) as T & { error?: string; message?: string; error_description?: string };
  if (!response.ok) throw new BridgeHttpError(response.status, result?.error_description ?? result?.message ?? result?.error ?? `Bridge request failed (${response.status})`, result?.error);
  return result;
}
export async function startBridgeLoopback(hub: string, received: (token: string) => Promise<void>, failed: (error: unknown) => void) {
  const state = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  let redirect = "", acceptedCode: string | undefined;
  let completion: Promise<{ status: number; message: string }> | undefined;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const code = url.searchParams.get("code");
    const supplied = Buffer.from(url.searchParams.get("state") ?? ""), expected = Buffer.from(state);
    if (request.method !== "GET" || url.pathname !== "/callback" || supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || !code || completion && code !== acceptedCode) {
      response.writeHead(400, { "Content-Type": "text/plain" }); response.end("Invalid sign-in callback"); return;
    }
    if (!completion) {
      acceptedCode = code;
      // Repeated browser redirects share the result, never the code exchange.
      completion = bridgeHttp<{ token: string }>(hub, "/v1/auth/exchange", undefined, { code, verifier, redirectUri: redirect })
        .then(async ({ token }) => { await received(token); return { status: 200, message: "Signed in. Return to Mains to finish key approval." }; })
        .catch((error: unknown) => { failed(error); return { status: 400, message: "Sign-in failed. Return to Mains and try again." }; })
        .finally(() => { clearTimeout(timer); server.close(); });
    }
    void completion.then(({ status, message }) => {
      response.writeHead(status, { "Content-Type": "text/plain", "Cache-Control": "no-store" }); response.end(message);
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  redirect = `http://127.0.0.1:${port}/callback`;
  const url = new URL("/authorize", hub); url.searchParams.set("redirect_uri", redirect); url.searchParams.set("code_challenge", challenge); url.searchParams.set("state", state);
  const timer = setTimeout(() => { server.close(); failed(new Error("Sign-in expired; try again")); }, 600_000); timer.unref();
  return { url: url.toString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), close() { clearTimeout(timer); server.close(); server.closeAllConnections(); } };
}
export async function startBridgeDeviceLogin(hub: string) {
  return bridgeHttp<{ device_code: string; user_code: string; verification_uri_complete: string; expires_in: number; interval: number }>(hub,
    "/api/auth/device/code", undefined, { client_id: BRIDGE_AUTH_CLIENT_ID });
}
export async function pollBridgeDeviceLogin(hub: string, code: string) {
  return bridgeHttp<{ access_token: string }>(hub, "/api/auth/device/token", undefined,
    { client_id: BRIDGE_AUTH_CLIENT_ID, device_code: code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
}
