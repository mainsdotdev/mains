import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const vault = vi.hoisted(() => ({ available: true, passthrough: false, dir: "" }));
vi.mock("electron", () => ({
  app: { getPath: () => vault.dir },
  safeStorage: {
    isEncryptionAvailable: () => vault.available,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: (s: string) => Buffer.concat([Buffer.from([255]), Buffer.from(s)]),
    decryptString: (bytes: Buffer) => {
      if (bytes[0] !== 255) {
        if (vault.passthrough) return bytes.toString("utf8");
        throw new Error("Invalid ciphertext");
      }
      return bytes.subarray(1).toString();
    },
  },
}));
const store = async () => (await import("./remoteBackends.service")).remoteBackendsService;
const file = () => join(vault.dir, "backend-tokens.json");
beforeEach(async () => { vi.resetModules(); vault.available = true; vault.passthrough = false; vault.dir = await mkdtemp(join(tmpdir(), "mains-owner-test-")); });
afterEach(() => rm(vault.dir, { recursive: true, force: true }));

it.each([false, true])("migrates legacy plaintext across a restart (native passthrough = %s)", async passthrough => {
  vault.passthrough = passthrough;
  const old = Buffer.from("legacy-owner").toString("base64");
  await writeFile(file(), JSON.stringify({ a: old, b: Buffer.from([255, 66]).toString("base64") }));
  const tokens = await store();
  await tokens.migrateLegacyTokens();
  expect(JSON.parse(await readFile(file(), "utf8")).a).not.toBe("safeStorage:" + old);
  if (process.platform !== "win32") expect((await stat(file())).mode & 0o777).toBe(0o600);
  vi.resetModules();
  const reopened = await store();
  expect(await reopened.getToken("a")).toBe("legacy-owner");
  expect(await reopened.getToken("b")).toBe("B");
});

it("clears legacy and replaced plaintext from disk while retaining session access", async () => {
  const old = Buffer.from("session-key").toString("base64");
  await writeFile(file(), JSON.stringify({ old }));
  const tokens = await store();
  vault.available = false;
  await tokens.migrateLegacyTokens();
  await tokens.setToken("another", "new-key");
  expect(JSON.parse(await readFile(file(), "utf8"))).toEqual({});
  expect(await tokens.getToken("old")).toBe("session-key");
  expect(await tokens.getToken("another")).toBe("new-key");
  vi.resetModules();
  expect(await (await store()).getToken("another")).toBeNull();
});

it("serializes concurrent changes and fails closed on unavailable or damaged ciphertext", async () => {
  const tokens = await store();
  await Promise.all([tokens.setToken("a", "first"), tokens.setToken("b", "second")]);
  vault.available = false;
  await expect(tokens.getToken("b")).rejects.toThrow("credential store");
  await tokens.setToken("a", "session replacement");
  vault.available = true;
  expect(await tokens.getToken("b")).toBe("second");
  await tokens.deleteToken("a");
  expect(await tokens.getToken("a")).toBeNull();
  await writeFile(file(), JSON.stringify({ b: "safeStorage:YmFk" }));
  await expect(tokens.getToken("b")).rejects.toThrow("Invalid ciphertext");
});
