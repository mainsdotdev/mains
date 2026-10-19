import { promises as fs, constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SecretStorageAdapter } from "../../runtime/backend-runtime";
import { bridgeBytes, validateBridgeDeviceWrap, validateBridgeRecoveryWrap, type BridgeRecoveryWrap, type BridgeSealedAccountKey } from "@mains/contracts/bridge-auth";
import { validateBridgeMembershipEntry, type BridgeMembershipEntry, type BridgeMembershipHead } from "@mains/contracts/bridge-membership";
import { verifyBridgeDeviceKeyPairs } from "./bridge.keys";

/** A new account's key, recovery code and the exact request that initializes it. */
export interface BridgeBootstrapProposal {
  accountKey: string; recoveryCode: string; wrap: BridgeSealedAccountKey; recovery: BridgeRecoveryWrap; entry: BridgeMembershipEntry;
}

export interface BridgeSavedIdentity {
  v: 3; backendId: string; hubUrl: string; label: string; accountId: string; email: string;
  publicKey: string; privateKey: string; token: string; expiresAt: number; accountKey: string | null;
  signingPublicKey: string; signingPrivateKey: string;
  /** Random successor saved before its hash is sent; never exposed to replicas. */
  pendingToken?: string | null;
  /** A received key cannot enter the active identity before local comparison. */
  pendingAccountKey?: string | null;
  /** The entry that admitted this backend, pinned with `pendingAccountKey` until the join code matches. */
  pendingMembership?: BridgeMembershipHead | null;
  /** The membership head this backend pinned in an authenticated ceremony (genesis, join code or
   * recovery); every log it accepts afterwards must contain it. Required with `accountKey`. */
  membership?: BridgeMembershipHead | null;
  /** Saved before the first bootstrap request, so a lost reply is resent unchanged or found accepted; the
   * hub may already hold this account's only key and recovery authority. */
  pendingBootstrap?: BridgeBootstrapProposal | null;
  /** Once an existing account has been observed, the hub cannot trigger re-bootstrap. */
  accountInitialized?: boolean;
  includeExisting: boolean;
  activationPending: boolean;
}
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
      } catch (error) { throw new Error(error instanceof Error ? error.message : "Invalid protected Bridge key storage"); }
    },
    /** The envelope's format version, read without decrypting; null when there is no readable envelope. */
    async envelopeVersion(): Promise<number | null> {
      try { const envelope = JSON.parse(await fs.readFile(file, "utf8")); return Number.isSafeInteger(envelope?.v) ? envelope.v : null; }
      catch { return null; }
    },
    /** Kept beside the original name, never deleted, so its contents can still be inspected. */
    async setAside(reason: string) { await fs.rename(file, `${file}.${reason}-${Date.now()}-${randomUUID()}`); },
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

/** Vaults before 3 predate the membership log. Their accounts were reset on the hub with that release, so
 * such an identity can never sync again: it is set aside and the backend signs in afresh. A vault of the
 * current version in another host's storage format still fails closed. */
const VAULT_VERSION = 3;
export function createBridgeIdentityStorage(dir: string, storage: SecretStorageAdapter) {
  const vault = protectedStorage<BridgeSavedIdentity>(path.join(dir, "bridge", "identity.json"), storage, VAULT_VERSION);
  let superseded = false;
  return {
    ...vault,
    /** Whether the last read set aside an identity from before the membership log. */
    get superseded() { return superseded; },
    async read(): Promise<BridgeSavedIdentity | null> {
      const version = await vault.envelopeVersion();
      if (version !== null && version < VAULT_VERSION) { await vault.setAside("superseded"); superseded = true; return null; }
      const identity = await vault.read();
      if (!identity) return null;
      if (identity.v !== 3 || !identity.backendId || !identity.accountId || !identity.token?.startsWith("b7_") || !Number.isSafeInteger(identity.expiresAt)) throw new Error("Saved Bridge identity is invalid");
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
      for (const head of [identity.membership, identity.pendingMembership]) if (head != null) validateMembershipHead(head);
      if (identity.accountKey && !identity.membership) throw new Error("Saved Bridge identity has no pinned membership; sign out and sign in again");
      if (identity.pendingAccountKey && !identity.pendingMembership) throw new Error("Saved Bridge identity has an unpinned candidate key");
      if (identity.pendingBootstrap != null) {
        const proposal = identity.pendingBootstrap;
        if (identity.accountKey || identity.pendingAccountKey || typeof proposal.recoveryCode !== "string") throw new Error("Saved Bridge account proposal is invalid");
        bridgeBytes(proposal.accountKey, 32); validateBridgeDeviceWrap(proposal.wrap); validateBridgeRecoveryWrap(proposal.recovery); validateBridgeMembershipEntry(proposal.entry);
      }
      return identity;
    },
  };
}
function validateMembershipHead(head: BridgeMembershipHead) {
  if (!head || typeof head !== "object" || Object.keys(head).length !== 2 || !Number.isSafeInteger(head.seq) || head.seq < 0) throw new Error("Invalid pinned Bridge membership");
  bridgeBytes(head.hash, 32);
}

/** Public, already-verified log entries, so a restart needs no network to rebuild membership. Its
 * integrity comes from the pinned head in the encrypted identity; an unusable copy is refetched. */
export function createBridgeMembershipStorage(dir: string) {
  const file = path.join(dir, "bridge", "membership.json");
  return {
    async read(accountId: string): Promise<unknown[] | null> {
      let content: string;
      try { content = await fs.readFile(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
      try {
        const value = JSON.parse(content);
        return value?.v === 1 && value.accountId === accountId && Array.isArray(value.entries) ? value.entries : null;
      } catch { return null; }
    },
    async write(accountId: string, entries: readonly unknown[]): Promise<void> {
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(JSON.stringify({ v: 1, accountId, entries })); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temp, file);
      } finally { await fs.rm(temp, { force: true }); }
    },
    async remove() { await fs.rm(file, { force: true }); },
  };
}
