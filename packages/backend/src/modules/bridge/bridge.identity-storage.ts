import { promises as fs, constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SecretStorageAdapter } from "../../runtime/backend-runtime";
import { bridgeBytes } from "@mains/contracts/bridge-auth";

export interface BridgeSavedIdentity {
  v: 1; backendId: string; hubUrl: string; label: string; accountId: string; email: string;
  publicKey: string; privateKey: string; token: string; expiresAt: number; accountKey: string | null;
  /** Random successor saved before its hash is sent; never exposed to replicas. */
  pendingToken?: string | null;
  /** A received key cannot enter the active identity before local comparison. */
  pendingAccountKey?: string | null;
  /** Once an existing account has been observed, the hub cannot trigger re-bootstrap. */
  accountInitialized?: boolean;
  includeExisting: boolean;
  activationPending: boolean;
}
export function createBridgeIdentityStorage(dir: string, storage: SecretStorageAdapter) {
  const file = path.join(dir, "bridge", "identity.json");
  function available() { if (!storage.isEncryptionAvailable()) throw new Error("Secure key storage is unavailable; Bridge cannot save its keys"); }
  return {
    async read(): Promise<BridgeSavedIdentity | null> {
      let content: string;
      try { content = await fs.readFile(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
      available(); const envelope = JSON.parse(content);
      if (envelope.v !== 1 || envelope.format !== storage.format || typeof envelope.sealed !== "string") throw new Error("Bridge keys use an unsupported storage format");
      const identity: BridgeSavedIdentity = JSON.parse(storage.decryptString(Buffer.from(envelope.sealed, "base64")));
      if (identity.v !== 1 || !identity.backendId || !identity.accountId || !identity.token?.startsWith("b7_") || !Number.isSafeInteger(identity.expiresAt)) throw new Error("Saved Bridge identity is invalid");
      if (identity.pendingToken != null && (typeof identity.pendingToken !== "string" || !/^b7_[a-f0-9]{64}$/.test(identity.pendingToken) || identity.pendingToken === identity.token))
        throw new Error("Saved Bridge successor credential is invalid");
      bridgeBytes(identity.privateKey, 32); bridgeBytes(identity.publicKey, 32); if (identity.accountKey) bridgeBytes(identity.accountKey, 32);
      if (identity.pendingAccountKey != null) {
        bridgeBytes(identity.pendingAccountKey, 32);
        if (identity.accountKey) throw new Error("Bridge identity contains both active and unverified keys");
      }
      if (identity.accountInitialized !== undefined && typeof identity.accountInitialized !== "boolean") throw new Error("Invalid Bridge account initialization state");
      return identity;
    },
    async write(identity: BridgeSavedIdentity): Promise<void> {
      available();
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${randomUUID()}.tmp`;
      const sealed = storage.encryptString(JSON.stringify(identity));
      try {
        const handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(JSON.stringify({ v: 1, format: storage.format, sealed: sealed.toString("base64") })); await handle.sync(); }
        finally { await handle.close(); }
        await fs.rename(temp, file); await fs.chmod(file, 0o600);
        if (process.platform !== "win32") {
          const directory = await fs.open(path.dirname(file), constants.O_RDONLY);
          try { await directory.sync(); } finally { await directory.close(); }
        }
      } finally { sealed.fill(0); await fs.rm(temp, { force: true }); }
    },
    async remove() { await fs.rm(file, { force: true }); },
  };
}
