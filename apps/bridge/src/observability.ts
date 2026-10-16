/** Diagnostics deliberately accept no request, exception, identity or payload. */
export interface BridgeDiagnosticsEnv {
  BRIDGE_ENV?: "local" | "staging" | "production";
  CF_VERSION_METADATA?: { id: string };
}
export type BridgeOperation = "auth" | "identity" | "blobs" | "subscription" | "quota" | "http" | "rpc" | "websocket" | "maintenance";
let windowStart = 0, emitted = 0;

export function reportBridgeFailure(env: BridgeDiagnosticsEnv, operation: BridgeOperation, status = 500): void {
  // Bound a failing dependency's log volume without another database or request.
  const now = Date.now();
  if (now - windowStart >= 60_000) { windowStart = now; emitted = 0; }
  if (emitted++ >= 20) return;
  const version = env.CF_VERSION_METADATA?.id;
  const entry = { event: "bridge.failure", operation, status,
    environment: ["production", "staging"].includes(env.BRIDGE_ENV ?? "") ? env.BRIDGE_ENV : "local",
    ...(version && /^[a-f0-9-]{36}$/i.test(version) ? { version } : {}) };
  if (status >= 500) console.error(JSON.stringify(entry));
  else console.warn(JSON.stringify(entry));
}

/** The handler retains its ordinary response, including streaming bodies/101s. */
export async function observeBridgeRequest(env: BridgeDiagnosticsEnv, handle: () => Promise<Response>): Promise<Response> {
  try {
    const response = await handle();
    if (response.status >= 500) reportBridgeFailure(env, "http", response.status);
    return response;
  } catch {
    reportBridgeFailure(env, "http");
    return new Response("Bridge is temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
