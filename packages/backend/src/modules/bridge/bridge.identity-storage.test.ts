import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeBackendRuntime } from "../../runtime/node-backend-runtime";
import { createBridgeIdentityStorage, createBridgeLocalWriterKeysStorage, type BridgeSavedIdentity } from "./bridge.identity-storage";
import { generateBridgeDeviceKeyPair, generateBridgeSigningKeyPair } from "./bridge.keys";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bridgeBase64, bridgeBytes } from "@mains/contracts/bridge-auth";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "mains-bridge-vault-")); dirs.push(dir);
  const storage = createNodeBackendRuntime({ dataDir: dir, appVersion: "test" }).secretStorage;
  const vault = createBridgeIdentityStorage(dir, storage), pair = generateBridgeDeviceKeyPair(), signing = generateBridgeSigningKeyPair();
  const identity: BridgeSavedIdentity = { v: 2, backendId: "B", hubUrl: "https://bridge.example", label: "B", accountId: "account", email: "owner@example.com",
    signingPublicKey: bridgeBase64(signing.publicKey), signingPrivateKey: bridgeBase64(signing.secretKey),
    publicKey: bridgeBase64(pair.publicKey), privateKey: bridgeBase64(pair.secretKey), token: `b7_${"a".repeat(64)}`, expiresAt: Date.now() + 60_000,
    accountKey: bridgeBase64(new Uint8Array(32).fill(42)), includeExisting: true, activationPending: false };
  return { dir, file: join(dir, "bridge", "identity.json"), vault, identity, storage };
}
describe("Bridge identity vault", () => {
  it("retains only local public signing keys through identity removal and a random-key re-enrollment", async () => {
    const f = await fixture(), history = createBridgeLocalWriterKeysStorage(f.dir, f.storage);
    await f.vault.write(f.identity);
    expect(await history.remember(f.identity)).toEqual([f.identity.signingPublicKey]);
    const file = join(f.dir, "bridge", "local-writer-keys.json"), before = await readFile(file);
    await f.vault.remove(); expect(await f.vault.read()).toBeNull(); expect(await readFile(file)).toEqual(before);
    const signing = generateBridgeSigningKeyPair();
    const next = { ...f.identity, signingPrivateKey: bridgeBase64(signing.secretKey), signingPublicKey: bridgeBase64(signing.publicKey) };
    const restarted = createBridgeLocalWriterKeysStorage(f.dir, f.storage);
    expect(await restarted.remember(next)).toEqual([f.identity.signingPublicKey, next.signingPublicKey]);
    const content = await readFile(file, "utf8"), envelope = JSON.parse(content);
    expect(content).not.toContain(f.identity.signingPublicKey);
    const clear = f.storage.decryptString(Buffer.from(envelope.sealed, "base64"));
    expect(JSON.parse(clear)).toEqual({ v: 1, entries: [f.identity, next].map(({ hubUrl, accountId, backendId, signingPublicKey }) => ({ hubUrl, accountId, backendId, signingPublicKey })) });
    for (const secret of [f.identity.privateKey, f.identity.signingPrivateKey, next.signingPrivateKey, f.identity.token, f.identity.accountKey!]) expect(clear).not.toContain(secret);
    const stable = await readFile(file); await restarted.remember(next); expect(await readFile(file)).toEqual(stable);
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
  it.each([{ hubUrl: "https://other.example" }, { accountId: "other-account" }, { backendId: "other-backend" }])("isolates local key history by hub, account and backend (%j)", async (scope) => {
    const f = await fixture(), history = createBridgeLocalWriterKeysStorage(f.dir, f.storage);
    await history.remember(f.identity);
    const signing = generateBridgeSigningKeyPair(), next = { ...f.identity, ...scope,
      signingPrivateKey: bridgeBase64(signing.secretKey), signingPublicKey: bridgeBase64(signing.publicKey) };
    expect(await history.remember(next)).toEqual([next.signingPublicKey]);
    expect(await history.remember(f.identity)).toEqual([f.identity.signingPublicKey]);
  });
  it("rejects substituted local public keys and unavailable storage without touching the history", async () => {
    const f = await fixture(), other = await fixture(), history = createBridgeLocalWriterKeysStorage(f.dir, f.storage);
    await expect(history.remember({ ...f.identity, signingPublicKey: other.identity.signingPublicKey })).rejects.toThrow(/key pairs/);
    await history.remember(f.identity);
    const file = join(f.dir, "bridge", "local-writer-keys.json"), raw = await readFile(file);
    await expect(createBridgeLocalWriterKeysStorage(f.dir, { ...f.storage, isEncryptionAvailable: () => false }).remember(f.identity)).rejects.toThrow(/Secure key storage/);
    expect(await readFile(file)).toEqual(raw); expect((await readdir(join(f.dir, "bridge"))).some((name) => name.includes("unreadable"))).toBe(false);
  });
  it("sets aside history this host cannot open, so a reset keychain never blocks re-enrollment", async () => {
    const f = await fixture(), other = await fixture(), history = createBridgeLocalWriterKeysStorage(f.dir, f.storage);
    const dir = join(f.dir, "bridge"), file = join(dir, "local-writer-keys.json");
    const signing = generateBridgeSigningKeyPair(), older = { ...f.identity, signingPrivateKey: bridgeBase64(signing.secretKey), signingPublicKey: bridgeBase64(signing.publicKey) };
    await history.remember(older);
    const sealed = (value: unknown) => JSON.stringify({ v: 1, format: f.storage.format, sealed: f.storage.encryptString(JSON.stringify(value)).toString("base64") });
    const unreadable = [await readFile(file, "utf8"), "corrupt", ...[null, [], true, { v: 2, entries: [] },
      { v: 1, entries: [{ hubUrl: f.identity.hubUrl, accountId: "account", backendId: "B", signingPublicKey: "invalid" }] }].map(sealed)];
    for (const [index, content] of unreadable.entries()) {
      await writeFile(file, content);
      // The first case is the original history under another host key, as after a keychain reset.
      const host = index === 0 ? createBridgeLocalWriterKeysStorage(f.dir, other.storage) : history;
      expect(await host.remember(f.identity)).toEqual([f.identity.signingPublicKey]);
      const aside = (await readdir(dir)).filter((name) => name.startsWith("local-writer-keys.json.unreadable-"));
      expect(aside).toHaveLength(index + 1);
      expect(await Promise.all(aside.map((name) => readFile(join(dir, name), "utf8")))).toContain(content);
    }
    // The fresh history is readable again and keeps accumulating this backend's keys.
    expect(await history.remember(older)).toEqual([f.identity.signingPublicKey, older.signingPublicKey]);
  });
  it("leaves the history in place when the file system, not its content, fails", async () => {
    const f = await fixture(), history = createBridgeLocalWriterKeysStorage(f.dir, f.storage), file = join(f.dir, "bridge", "local-writer-keys.json");
    await mkdir(file, { recursive: true });
    await expect(history.remember(f.identity)).rejects.toThrow();
    expect((await stat(file)).isDirectory()).toBe(true); expect(await readdir(join(f.dir, "bridge"))).toEqual(["local-writer-keys.json"]);
  });
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
    const envelope = JSON.parse(raw); envelope.v = 1;
    await writeFile(f.file, JSON.stringify(envelope));
    await expect(f.vault.read()).rejects.toThrow("unsupported storage format");
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
    f.identity.accountKey = null; f.identity.pendingAccountKey = key; await f.vault.write(f.identity);
    const raw = await readFile(f.file, "utf8");
    expect(raw).not.toContain(key); expect(raw).not.toContain("pendingAccountKey");
    expect(await createBridgeIdentityStorage(f.dir, f.storage).read()).toMatchObject({ accountKey: null, pendingAccountKey: key });
    f.identity.accountKey = key; await f.vault.write(f.identity);
    await expect(f.vault.read()).rejects.toThrow("both active and unverified");
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
