import { app, safeStorage } from "electron";
import { isUtf8 } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const sealed = "safeStorage:";
const sessionTokens = new Map<string, string>();
let pending = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.then(() => {}, () => {});
  return result;
}

function canPersist(): boolean {
  return safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
}

function encrypt(token: string): string {
  return sealed + safeStorage.encryptString(token).toString("base64");
}

function tokenFile(): string {
  return path.join(app.getPath("userData"), "backend-tokens.json");
}

async function writeMap(tokens: Map<string, string>): Promise<void> {
  const file = tokenFile();
  const temp = file + "." + randomUUID() + ".tmp";
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(temp, JSON.stringify(Object.fromEntries(tokens)), { flag: "wx", mode: 0o600 });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

async function readMap(): Promise<Map<string, string>> {
  let text: string;
  try { text = await readFile(tokenFile(), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid backend token store");
  const tokens = new Map<string, string>();
  const volatile = new Map<string, string>();
  let migrated = false;
  for (const [id, stored] of Object.entries(raw)) {
    if (typeof stored !== "string") throw new Error("Invalid backend token entry");
    if (stored.startsWith(sealed)) { tokens.set(id, stored); continue; }

    // Older versions used the same base64 representation for ciphertext and UTF-8 tokens.
    migrated = true;
    const bytes = Buffer.from(stored, "base64");
    if (!isUtf8(bytes)) { tokens.set(id, sealed + stored); continue; }
    let token = bytes.toString("utf8");
    if (canPersist()) {
      try { token = safeStorage.decryptString(bytes); }
      catch { /* The historical fallback stored the UTF-8 token directly. */ }
      // A platform may accept unencrypted input when decrypting legacy data.
      // Always seal the recovered token, including after a successful decrypt.
      tokens.set(id, encrypt(token));
    } else {
      volatile.set(id, token);
    }
  }
  if (migrated) {
    await writeMap(tokens);
    for (const [id, token] of volatile) sessionTokens.set(id, token);
  }
  return tokens;
}

export const remoteBackendsService = {
  async migrateLegacyTokens(): Promise<void> {
    await serialized(readMap);
  },
  setToken(id: string, token: string): Promise<void> {
    return serialized(async () => {
      const tokens = await readMap();
      if (canPersist()) {
        tokens.set(id, encrypt(token));
        await writeMap(tokens);
        sessionTokens.delete(id);
      } else {
        if (tokens.delete(id)) await writeMap(tokens);
        sessionTokens.set(id, token);
      }
    });
  },
  getToken(id: string): Promise<string | null> {
    return serialized(async () => {
      const tokens = await readMap();
      const session = sessionTokens.get(id);
      if (session !== undefined) return session;
      const stored = tokens.get(id);
      if (stored === undefined) return null;
      if (!canPersist()) throw new Error("Unlock the OS credential store to access the saved owner token.");
      return safeStorage.decryptString(Buffer.from(stored.slice(sealed.length), "base64"));
    });
  },
  deleteToken(id: string): Promise<void> {
    return serialized(async () => {
      const tokens = await readMap();
      if (tokens.delete(id)) await writeMap(tokens);
      sessionTokens.delete(id);
    });
  },
};
