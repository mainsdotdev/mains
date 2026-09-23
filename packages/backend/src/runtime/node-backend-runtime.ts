import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  BackendRuntime,
  PowerInhibitorAdapter,
  SecretStorageAdapter,
} from "./backend-runtime";

const SECRET_MAGIC = Buffer.from("MNS1");
const SECRET_NONCE_BYTES = 12;
const SECRET_TAG_BYTES = 16;

export interface NodeBackendRuntimeOptions {
  dataDir: string;
  appRoot?: string;
  resourcesPath?: string | null;
  appVersion: string;
}

function createFileSecretStorage(dataDir: string): SecretStorageAdapter {
  const keyPath = path.join(dataDir, "server-secret.key");
  let cachedKey: Buffer | null = null;

  function readOrCreateKey(): Buffer {
    if (cachedKey) return cachedKey;
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    try {
      const existing = fs.readFileSync(keyPath);
      if (existing.length !== 32) {
        throw new Error("Standalone server secret key has an invalid length");
      }
      cachedKey = existing;
      return existing;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const generated = crypto.randomBytes(32);
    try {
      fs.writeFileSync(keyPath, generated, { flag: "wx", mode: 0o600 });
      cachedKey = generated;
      return generated;
    } catch (error) {
      // Another process may have won the create race. Its key is authoritative.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = fs.readFileSync(keyPath);
      if (existing.length !== 32) {
        throw new Error("Standalone server secret key has an invalid length");
      }
      cachedKey = existing;
      return existing;
    }
  }

  return {
    format: "mns1-aes-gcm-v1",
    isEncryptionAvailable() {
      try {
        readOrCreateKey();
        return true;
      } catch {
        return false;
      }
    },
    encryptString(value) {
      const nonce = crypto.randomBytes(SECRET_NONCE_BYTES);
      const cipher = crypto.createCipheriv("aes-256-gcm", readOrCreateKey(), nonce);
      const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([
        SECRET_MAGIC,
        nonce,
        cipher.getAuthTag(),
        encrypted,
      ]);
    },
    decryptString(value) {
      if (
        value.length <
          SECRET_MAGIC.length + SECRET_NONCE_BYTES + SECRET_TAG_BYTES ||
        !value.subarray(0, SECRET_MAGIC.length).equals(SECRET_MAGIC)
      ) {
        throw new Error(
          "Credential was encrypted by a different Mains runtime and must be migrated",
        );
      }
      const nonceStart = SECRET_MAGIC.length;
      const tagStart = nonceStart + SECRET_NONCE_BYTES;
      const payloadStart = tagStart + SECRET_TAG_BYTES;
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        readOrCreateKey(),
        value.subarray(nonceStart, tagStart),
      );
      decipher.setAuthTag(value.subarray(tagStart, payloadStart));
      return Buffer.concat([
        decipher.update(value.subarray(payloadStart)),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

function createNoopPowerInhibitor(): PowerInhibitorAdapter {
  let nextId = 1;
  const active = new Set<number>();
  return {
    start() {
      const id = nextId++;
      active.add(id);
      return id;
    },
    isStarted: (id) => active.has(id),
    stop: (id) => {
      active.delete(id);
    },
  };
}

/** Node host adapter for the standalone server. */
export function createNodeBackendRuntime(
  options: NodeBackendRuntimeOptions,
): BackendRuntime {
  const dataDir = path.resolve(options.dataDir);
  const appRoot = path.resolve(options.appRoot ?? process.cwd());
  return {
    kind: "node",
    whenReady: async () => {},
    isPackaged: () => false,
    getAppVersion: () => options.appVersion,
    getAppPath: () => appRoot,
    getPath(name) {
      return name === "userData" ? dataDir : path.join(os.homedir(), "Desktop");
    },
    getResourcesPath: () => options.resourcesPath ?? null,
    async openExternal() {
      throw new Error(
        "The standalone server cannot open a browser on behalf of a remote client",
      );
    },
    secretStorage: createFileSecretStorage(dataDir),
    powerInhibitor: createNoopPowerInhibitor(),
    // Keep the standalone runtime dependency-light. PNG/JPEG and other common
    // formats are sent as bounded raw bytes; a future optional image adapter can
    // add thumbnailing without coupling the backend to Electron.
    imagePreview: null,
  };
}
