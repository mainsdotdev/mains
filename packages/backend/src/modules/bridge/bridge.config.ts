import { readFile } from "node:fs/promises";
import path from "node:path";
import { fromBase64Url } from "./bridge.encoding";

/** B4 development setup; production sign-in and protected key storage are B7. */
export interface BridgeDevConfig {
  url: string;
  token: string;
  accountKey: Uint8Array;
  backendId: string;
  label: string;
  accountId: string;
  signingPrivateKey: Uint8Array;
  /** Protected local history, supplied by identity storage rather than dev.json or the hub. */
  localSigningPublicKeys?: readonly string[];
}
export function parseBridgeDevConfig(value: unknown): BridgeDevConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Bridge development configuration");
  const v = value as Record<string, unknown>;
  if (v.enabled === false) return null;
  if (v.version !== 1 || typeof v.url !== "string" || typeof v.token !== "string" || !v.token || v.token.length > 16384 ||
      typeof v.backendId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v.backendId) ||
      typeof v.label !== "string" || !v.label.trim() || v.label.length > 128 || typeof v.accountKey !== "string" ||
      typeof v.accountId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v.accountId) || typeof v.signingPrivateKey !== "string")
    throw new Error("Invalid Bridge development configuration");
  let url: URL;
  try { url = new URL(v.url); } catch { throw new Error("Invalid Bridge hub URL"); }
  if (url.protocol !== "wss:" && !(url.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    throw new Error("Bridge requires wss outside loopback");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/v1/log") throw new Error("Invalid Bridge hub URL");
  let accountKey: Uint8Array;
  try { accountKey = fromBase64Url(v.accountKey, 32); } catch { throw new Error("Invalid Bridge account key"); }
  let signingPrivateKey: Uint8Array;
  try { signingPrivateKey = fromBase64Url(v.signingPrivateKey, 32); } catch { accountKey.fill(0); throw new Error("Invalid Bridge signing key"); }
  return { url: url.toString(), token: v.token, backendId: v.backendId, label: v.label.trim(), accountKey, accountId: v.accountId, signingPrivateKey };
}
export async function readBridgeDevConfig(file: string): Promise<BridgeDevConfig | null> {
  let text: string;
  try { text = await readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("Cannot read Bridge development configuration"); }
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Invalid Bridge development configuration JSON"); }
  return parseBridgeDevConfig(value);
}
export function bridgeDevConfigPath(dataDir: string): string {
  return path.resolve(process.env.MAINS_BRIDGE_CONFIG ?? path.join(dataDir, "bridge", "dev.json"));
}
