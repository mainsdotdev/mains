import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateRelayUrl } from "@mains/contracts/relay";
import { decodeKey, encodeKey, relayPublicKey } from "@mains/relay/crypto";
import { getBackendRuntime } from "../runtime/backend-runtime";

export interface RelayHostConfig {
  url: string;
  backendId: string;
  routingSecret: string;
  privateKey: Uint8Array;
}

/** Private, operator-configured relay. No global routing secret is distributed
 * to clients or stored in the application database. Disabled unless configured. */
export async function loadRelayHostConfig(backendId: () => Promise<string>): Promise<RelayHostConfig | undefined> {
  const url = process.env.MAINS_RELAY_URL;
  const secretFile = process.env.MAINS_RELAY_SECRET_FILE;
  if (!url && !secretFile) return undefined;
  if (!url || !secretFile) throw new Error("MAINS_RELAY_URL and MAINS_RELAY_SECRET_FILE must both be configured");
  const normalizedUrl = validateRelayUrl(url);
  const routingSecret = (await readFile(secretFile, "utf8")).trim();
  if (Buffer.byteLength(routingSecret) < 32 || Buffer.byteLength(routingSecret) > 4096) throw new Error("Invalid relay routing secret");
  const runtime = getBackendRuntime();
  if (!runtime.secretStorage.isEncryptionAvailable()) throw new Error("Secure storage is required for relay identity");
  const directory = path.join(runtime.getPath("userData"), "relay");
  const filename = path.join(directory, "identity.enc");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const sealed = runtime.secretStorage.encryptString(encodeKey(randomBytes(32)));
    await writeFile(filename, JSON.stringify({ v: 1, format: runtime.secretStorage.format, sealed: sealed.toString("base64") }), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const saved = JSON.parse(await readFile(filename, "utf8"));
  if (saved?.v !== 1 || saved.format !== runtime.secretStorage.format || typeof saved.sealed !== "string") {
    throw new Error("Relay identity uses a different or invalid storage format; use a separate data directory for a different runtime");
  }
  const privateKey = decodeKey(runtime.secretStorage.decryptString(Buffer.from(saved.sealed, "base64")), 32);
  relayPublicKey(privateKey);
  return { url: normalizedUrl, routingSecret, privateKey, backendId: await backendId() };
}
