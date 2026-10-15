import { jwtVerify } from "jose";

export interface BridgeIdentity { accountId: string; backendId: string; expiresAt: number }
export interface DevAuthEnv { BRIDGE_DEV_AUTH?: string; BRIDGE_DEV_SECRET?: string }
export async function authenticate(request: Request, env: DevAuthEnv): Promise<BridgeIdentity | null> {
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
