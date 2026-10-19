import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeBackendRuntime } from "../../runtime/node-backend-runtime";
import { createBridgeIdentityStorage, type BridgeSavedIdentity } from "./bridge.identity-storage";
import { generateBridgeDeviceKeyPair, generateBridgeSigningKeyPair } from "./bridge.keys";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bridgeBase64, bridgeBytes } from "@mains/contracts/bridge-auth";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "mains-bridge-vault-")); dirs.push(dir);
  const storage = createNodeBackendRuntime({ dataDir: dir, appVersion: "test" }).secretStorage;
  const vault = createBridgeIdentityStorage(dir, storage), pair = generateBridgeDeviceKeyPair(), signing = generateBridgeSigningKeyPair();
  const identity: BridgeSavedIdentity = { v: 3, backendId: "B", hubUrl: "https://bridge.example", label: "B", accountId: "account", email: "owner@example.com",
    signingPublicKey: bridgeBase64(signing.publicKey), signingPrivateKey: bridgeBase64(signing.secretKey),
    publicKey: bridgeBase64(pair.publicKey), privateKey: bridgeBase64(pair.secretKey), token: `b7_${"a".repeat(64)}`, expiresAt: Date.now() + 60_000,
    accountKey: bridgeBase64(new Uint8Array(32).fill(42)), includeExisting: true, activationPending: false,
    membership: { seq: 1, hash: bridgeBase64(new Uint8Array(32).fill(9)) } };
  return { dir, file: join(dir, "bridge", "identity.json"), vault, identity, storage };
}
describe("Bridge identity vault", () => {
  it("requires an independent matching signing key pair and rejects identities without writer keys", async () => {
    const f = await fixture();
    for (const change of [
      { signingPublicKey: undefined }, { signingPrivateKey: undefined },
      { signingPublicKey: bridgeBase64(generateBridgeSigningKeyPair().publicKey) },
      { publicKey: bridgeBase64(generateBridgeDeviceKeyPair().publicKey) },
      { signingPrivateKey: f.identity.privateKey, signingPublicKey: bridgeBase64(ed25519.getPublicKey(bridgeBytes(f.identity.privateKey, 32))) },
    ]) {
      await f.vault.write({ ...f.identity, ...change } as BridgeSavedIdentity);
      await expect(f.vault.read()).rejects.toThrow();
    }
    await f.vault.write(f.identity);
    const raw = await readFile(f.file, "utf8");
    expect(raw).not.toContain(f.identity.signingPrivateKey); expect(raw).not.toContain("signingPrivateKey");
    expect(await createBridgeIdentityStorage(f.dir, f.storage).read()).toEqual(f.identity);
    const envelope = JSON.parse(raw); envelope.v = 4;
    await writeFile(f.file, JSON.stringify(envelope));
    await expect(f.vault.read()).rejects.toThrow("unsupported storage format");
  });
  it.each([1, 2])("sets aside a vault %i identity from before the membership log, whose account the hub reset, instead of failing to start", async (version) => {
    const f = await fixture();
    const sealed = f.storage.encryptString(JSON.stringify({ ...f.identity, v: version, membership: undefined }));
    await mkdir(join(f.dir, "bridge"), { recursive: true });
    await writeFile(f.file, JSON.stringify({ v: version, format: f.storage.format, sealed: sealed.toString("base64") }));
    const vault = createBridgeIdentityStorage(f.dir, f.storage);
    expect(await vault.read()).toBeNull(); expect(vault.superseded).toBe(true);
    expect((await readdir(join(f.dir, "bridge"))).filter((name) => name.startsWith("identity.json.superseded-"))).toHaveLength(1);
    await vault.write(f.identity);
    expect(await createBridgeIdentityStorage(f.dir, f.storage).read()).toEqual(f.identity);
  });
  it("protects a pending successor across restart and rejects malformed or reused proposals", async () => {
    const f = await fixture(); f.identity.pendingToken = `b7_${"b".repeat(64)}`;
    await f.vault.write(f.identity);
    const raw = await readFile(f.file, "utf8");
    expect(raw).not.toContain(f.identity.pendingToken); expect(raw).not.toContain("pendingToken");
    expect(await createBridgeIdentityStorage(f.dir, f.storage).read()).toEqual(f.identity);
    for (const invalid of ["invalid", f.identity.token]) {
      await f.vault.write({ ...f.identity, pendingToken: invalid });
      await expect(f.vault.read()).rejects.toThrow("successor credential is invalid");
    }
  });
  it("encrypts an unverified candidate separately and rejects ambiguous active-plus-pending identities", async () => {
    const f = await fixture(), key = f.identity.accountKey!;
    f.identity.accountKey = null; f.identity.membership = null; f.identity.pendingAccountKey = key; f.identity.pendingMembership = { seq: 1, hash: bridgeBase64(new Uint8Array(32).fill(8)) };
    await f.vault.write(f.identity);
    const raw = await readFile(f.file, "utf8");
    expect(raw).not.toContain(key); expect(raw).not.toContain("pendingAccountKey");
    expect(await createBridgeIdentityStorage(f.dir, f.storage).read()).toMatchObject({ accountKey: null, pendingAccountKey: key });
    f.identity.accountKey = key; f.identity.membership = { seq: 1, hash: bridgeBase64(new Uint8Array(32).fill(9)) }; await f.vault.write(f.identity);
    await expect(f.vault.read()).rejects.toThrow("both active and unverified");
  });
  it("requires a pinned membership head with an active key and with a candidate, and rejects a malformed one", async () => {
    const f = await fixture();
    await f.vault.write({ ...f.identity, membership: null }); await expect(f.vault.read()).rejects.toThrow(/no pinned membership/);
    await f.vault.write({ ...f.identity, accountKey: null, membership: null, pendingAccountKey: f.identity.accountKey }); await expect(f.vault.read()).rejects.toThrow(/unpinned candidate/);
    for (const membership of [{ seq: -1, hash: f.identity.membership!.hash }, { seq: 1, hash: "short" }, { seq: 1, hash: f.identity.membership!.hash, extra: true }]) {
      await f.vault.write({ ...f.identity, membership: membership as never }); await expect(f.vault.read()).rejects.toThrow();
    }
  });
  it("persists only authenticated ciphertext in a protected file and restores with the same runtime storage", async () => {
    const f = await fixture(); expect(await f.vault.read()).toBeNull(); await f.vault.write(f.identity);
    const raw = await readFile(f.file, "utf8");
    for (const secret of [f.identity.token, f.identity.privateKey, f.identity.signingPrivateKey, f.identity.accountKey!]) expect(raw).not.toContain(secret);
    expect(await createBridgeIdentityStorage(f.dir, f.storage).read()).toEqual(f.identity);
    if (process.platform !== "win32") {
      expect((await stat(f.file)).mode & 0o777).toBe(0o600);
      expect((await stat(join(f.dir, "server-secret.key"))).mode & 0o777).toBe(0o600);
    }
    await f.vault.remove(); expect(await f.vault.read()).toBeNull();
  });
  it("fails closed for unavailable secure storage, wrong storage keys, corruption and format mismatches", async () => {
    const f = await fixture(), other = await fixture(); await f.vault.write(f.identity);
    await expect(createBridgeIdentityStorage(f.dir, other.storage).read()).rejects.toThrow();
    const unavailable = { ...f.storage, isEncryptionAvailable: () => false };
    await expect(createBridgeIdentityStorage(f.dir, unavailable).write(f.identity)).rejects.toThrow("Secure key storage");
    const raw = JSON.parse(await readFile(f.file, "utf8")); raw.format = "plaintext";
    await writeFile(f.file, JSON.stringify(raw)); await expect(f.vault.read()).rejects.toThrow("unsupported storage format");
    await writeFile(f.file, "corrupt"); await expect(f.vault.read()).rejects.toThrow();
  });
});
