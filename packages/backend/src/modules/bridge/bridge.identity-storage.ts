import { promises as fs, constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SecretStorageAdapter } from "../../runtime/backend-runtime";
import { bridgeBytes } from "@mains/contracts/bridge-auth";
import { verifyBridgeDeviceKeyPairs } from "./bridge.keys";
import { bridgeHubUrl } from "./bridge.login";

export interface BridgeSavedIdentity {
  v: 2; backendId: string; hubUrl: string; label: string; accountId: string; email: string;
  publicKey: string; privateKey: string; token: string; expiresAt: number; accountKey: string | null;
  signingPublicKey: string; signingPrivateKey: string;
  /** Random successor saved before its hash is sent; never exposed to replicas. */
  pendingToken?: string | null;
  /** A received key cannot enter the active identity before local comparison. */
  pendingAccountKey?: string | null;
  /** Once an existing account has been observed, the hub cannot trigger re-bootstrap. */
  accountInitialized?: boolean;
  includeExisting: boolean;
  activationPending: boolean;
}
/** The file was read, but this host's key and format cannot open it. File system and
 * unavailable-encryption failures are not this: retrying them may succeed. */
class UnreadableKeyStorage extends Error {}
function protectedStorage<T>(file: string, storage: SecretStorageAdapter, version: number) {
  function available() { if (!storage.isEncryptionAvailable()) throw new Error("Secure key storage is unavailable; Bridge cannot save its keys"); }
  return {
    async read(): Promise<T | null> {
      let content: string;
      try { content = await fs.readFile(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
      available();
      try {
        const envelope = JSON.parse(content);
        if (envelope.v !== version || envelope.format !== storage.format || typeof envelope.sealed !== "string") throw new Error("Bridge keys use an unsupported storage format");
        const value = JSON.parse(storage.decryptString(Buffer.from(envelope.sealed, "base64")));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid protected Bridge key storage");
        return value;
      } catch (error) { throw new UnreadableKeyStorage(error instanceof Error ? error.message : "Invalid protected Bridge key storage"); }
    },
    /** Kept beside the original name, never deleted, so its contents can still be inspected. */
    async setAside() { await fs.rename(file, `${file}.unreadable-${Date.now()}-${randomUUID()}`); },
    async write(value: T): Promise<void> {
      available();
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${randomUUID()}.tmp`;
      const sealed = storage.encryptString(JSON.stringify(value));
      try {
        const handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(JSON.stringify({ v: version, format: storage.format, sealed: sealed.toString("base64") })); await handle.sync(); }
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

export function createBridgeIdentityStorage(dir: string, storage: SecretStorageAdapter) {
  const vault = protectedStorage<BridgeSavedIdentity>(path.join(dir, "bridge", "identity.json"), storage, 2);
  return {
    ...vault,
    async read(): Promise<BridgeSavedIdentity | null> {
      const identity = await vault.read();
      if (!identity) return null;
      if (identity.v !== 2 || !identity.backendId || !identity.accountId || !identity.token?.startsWith("b7_") || !Number.isSafeInteger(identity.expiresAt)) throw new Error("Saved Bridge identity is invalid");
      if (identity.pendingToken != null && (typeof identity.pendingToken !== "string" || !/^b7_[a-f0-9]{64}$/.test(identity.pendingToken) || identity.pendingToken === identity.token))
        throw new Error("Saved Bridge successor credential is invalid");
      bridgeBytes(identity.privateKey, 32); bridgeBytes(identity.publicKey, 32);
      bridgeBytes(identity.signingPrivateKey, 32); bridgeBytes(identity.signingPublicKey, 32);
      verifyBridgeDeviceKeyPairs(identity);
      if (identity.accountKey) bridgeBytes(identity.accountKey, 32);
      if (identity.pendingAccountKey != null) {
        bridgeBytes(identity.pendingAccountKey, 32);
        if (identity.accountKey) throw new Error("Bridge identity contains both active and unverified keys");
      }
      if (identity.accountInitialized !== undefined && typeof identity.accountInitialized !== "boolean") throw new Error("Invalid Bridge account initialization state");
      return identity;
    },
  };
}

interface LocalWriterKey { hubUrl: string; accountId: string; backendId: string; signingPublicKey: string }
function validateLocalWriterKey(entry: LocalWriterKey) {
  if (!entry || bridgeHubUrl(entry.hubUrl) !== entry.hubUrl ||
      ![entry.accountId, entry.backendId].every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)))
    throw new Error("Invalid local Bridge writer key history");
  bridgeBytes(entry.signingPublicKey, 32);
}
/** Only identities backed by locally held private keys can extend this trust store.
 * Sign-out removes credentials, but must retain these public verification keys. */
export function createBridgeLocalWriterKeysStorage(dir: string, storage: SecretStorageAdapter) {
  const vault = protectedStorage<{ v: 1; entries: LocalWriterKey[] }>(path.join(dir, "bridge", "local-writer-keys.json"), storage, 1);
  return {
    async remember(identity: BridgeSavedIdentity): Promise<string[]> {
      verifyBridgeDeviceKeyPairs(identity);
      const current: LocalWriterKey = { hubUrl: bridgeHubUrl(identity.hubUrl), accountId: identity.accountId,
        backendId: identity.backendId, signingPublicKey: identity.signingPublicKey };
      validateLocalWriterKey(current);
      let history: { v: 1; entries: LocalWriterKey[] } | null;
      try {
        history = await vault.read();
        try {
          if (history && (history.v !== 1 || !Array.isArray(history.entries))) throw new Error("Invalid local Bridge writer key history");
          for (const entry of history?.entries ?? []) validateLocalWriterKey(entry);
        } catch (error) { throw new UnreadableKeyStorage(error instanceof Error ? error.message : "Invalid local Bridge writer key history"); }
      } catch (error) {
        if (!(error instanceof UnreadableKeyStorage)) throw error;
        // This history outlives sign-out, so it must never block an enrollment (a reset
        // keychain or a moved profile). Content this host cannot open grants no trust;
        // only older own records signed with the forgotten keys are set aside on pull.
        await vault.setAside();
        console.warn(`[bridge] Set aside unreadable local signing key history: ${error.message}`);
        history = null;
      }
      history ??= { v: 1, entries: [] };
      const own = history.entries.filter((entry) => entry.hubUrl === current.hubUrl && entry.accountId === current.accountId && entry.backendId === current.backendId);
      if (!own.some((entry) => entry.signingPublicKey === current.signingPublicKey)) {
        history.entries.push(current); own.push(current); await vault.write(history);
      }
      return [...new Set(own.map((entry) => entry.signingPublicKey))];
    },
  };
}
