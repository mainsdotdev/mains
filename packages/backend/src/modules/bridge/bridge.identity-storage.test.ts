import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeBackendRuntime } from "../../runtime/node-backend-runtime";
import { createBridgeIdentityStorage, type BridgeSavedIdentity } from "./bridge.identity-storage";
import { generateBridgeDeviceKeyPair } from "./bridge.keys";
import { bridgeBase64 } from "@mains/contracts/bridge-auth";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "mains-bridge-vault-")); dirs.push(dir);
  const storage = createNodeBackendRuntime({ dataDir: dir, appVersion: "test" }).secretStorage;
  const vault = createBridgeIdentityStorage(dir, storage), pair = generateBridgeDeviceKeyPair();
  const identity: BridgeSavedIdentity = { v: 1, backendId: "B", hubUrl: "https://bridge.example", label: "B", accountId: "account", email: "owner@example.com",
    publicKey: bridgeBase64(pair.publicKey), privateKey: bridgeBase64(pair.secretKey), token: `b7_${"a".repeat(64)}`, expiresAt: Date.now() + 60_000,
    accountKey: bridgeBase64(new Uint8Array(32).fill(42)), includeExisting: true, activationPending: false };
  return { dir, file: join(dir, "bridge", "identity.json"), vault, identity, storage };
}
describe("Bridge identity vault", () => {
  it("persists only authenticated ciphertext in a protected file and restores with the same runtime storage", async () => {
    const f = await fixture(); expect(await f.vault.read()).toBeNull(); await f.vault.write(f.identity);
    const raw = await readFile(f.file, "utf8");
    for (const secret of [f.identity.token, f.identity.privateKey, f.identity.accountKey!]) expect(raw).not.toContain(secret);
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
