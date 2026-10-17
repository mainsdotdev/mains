import { jwtVerify } from "jose";
import type { AuthEnv } from "./identity";
import { backendIdentity, backendStillApproved, type CredentialRotated } from "./devices";

export interface BridgeIdentity { accountId: string; backendId: string; expiresAt: number; credentialHash?: string }
export interface DevAuthEnv extends AuthEnv { BRIDGE_DEV_AUTH?: string; BRIDGE_DEV_SECRET?: string }
export const bridgeDevelopmentEnabled = (env: DevAuthEnv) => env.BRIDGE_DEV_AUTH === "true" && (!env.BRIDGE_ENV || env.BRIDGE_ENV === "local");
export async function authenticate(request: Request, env: DevAuthEnv, rotated?: CredentialRotated): Promise<BridgeIdentity | null> {
  const backend = await backendIdentity(request, env, false, rotated);
  if (backend) return { accountId: backend.account_id, backendId: backend.backend_id, expiresAt: backend.token_expires_at, credentialHash: backend.token_hash };
  if (!bridgeDevelopmentEnabled(env) || !env.BRIDGE_DEV_SECRET || env.BRIDGE_DEV_SECRET.length < 32) return null;
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(authorization.slice(7), new TextEncoder().encode(env.BRIDGE_DEV_SECRET), {
      algorithms: ["HS256"], issuer: "mains-bridge-dev", audience: "mains-bridge",
      requiredClaims: ["sub", "accountId", "exp", "iat"], maxTokenAge: "24h",
    });
    const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
    if (!identifier(payload.sub) || !identifier(payload.accountId) || typeof payload.exp !== "number") return null;
    return { accountId: payload.accountId, backendId: payload.sub, expiresAt: payload.exp * 1000 };
  } catch { return null; }
}
export async function identityIsActive(identity: BridgeIdentity, env: DevAuthEnv): Promise<boolean> {
  if (identity.expiresAt <= Date.now()) return false;
  return identity.credentialHash ? backendStillApproved(env, identity.accountId, identity.backendId, identity.credentialHash) : bridgeDevelopmentEnabled(env);
}

export const BRIDGE_SOCKET_AUTH_CACHE_MS = 30_000;
/** Per-DO, credential-bound and single-flight. No timers or persisted trust:
 * hibernation drops the cache and the next message must consult D1 again. */
export function createBridgeSocketAuth(env: DevAuthEnv, now = Date.now) {
  const cache = new Map<string, { backendId: string; credentialHash: string; until: number; active: Promise<boolean> }>();
  return {
    invalidate(backendId: string, credentialHash?: string) {
      for (const [key, entry] of cache) if (entry.backendId === backendId && (!credentialHash || entry.credentialHash === credentialHash)) cache.delete(key);
    },
    async active(identity: BridgeIdentity): Promise<boolean> {
      if (!Number.isSafeInteger(identity.expiresAt) || identity.expiresAt <= now()) return false;
      if (!identity.credentialHash) return identityIsActive(identity, env);
      const key = JSON.stringify([identity.accountId, identity.backendId, identity.credentialHash, identity.expiresAt]);
      let entry = cache.get(key);
      if (!entry || entry.until <= now()) {
        if (cache.size >= 512) cache.delete(cache.keys().next().value!);
        entry = { backendId: identity.backendId, credentialHash: identity.credentialHash, until: Math.min(now() + BRIDGE_SOCKET_AUTH_CACHE_MS, identity.expiresAt), active: identityIsActive(identity, env) };
        cache.set(key, entry);
      }
      try {
        const active = await entry.active;
        // A revocation during the D1 read must not resurrect a stale approval.
        return active && cache.get(key) === entry && entry.until > now() && identity.expiresAt > now();
      } catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
    },
  };
}
