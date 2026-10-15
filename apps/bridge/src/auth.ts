import { jwtVerify } from "jose";
import type { AuthEnv } from "./identity";
import { backendIdentity, backendStillApproved } from "./devices";

export interface BridgeIdentity { accountId: string; backendId: string; expiresAt: number; credentialHash?: string }
export interface DevAuthEnv extends AuthEnv { BRIDGE_DEV_AUTH?: string; BRIDGE_DEV_SECRET?: string }
export async function authenticate(request: Request, env: DevAuthEnv): Promise<BridgeIdentity | null> {
  const backend = await backendIdentity(request, env);
  if (backend) return { accountId: backend.account_id, backendId: backend.backend_id, expiresAt: backend.token_expires_at, credentialHash: backend.token_hash };
  if (env.BRIDGE_DEV_AUTH !== "true" || !env.BRIDGE_DEV_SECRET || env.BRIDGE_DEV_SECRET.length < 32) return null;
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
  return identity.credentialHash ? backendStillApproved(env, identity.accountId, identity.backendId, identity.credentialHash) : env.BRIDGE_DEV_AUTH === "true";
}
