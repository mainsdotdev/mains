import * as SecureStore from "expo-secure-store";
import { createCredentialPersistence } from "./credential-persistence";

/**
 * The one Mac this phone is paired with, kept in the platform keychain. The
 * device token is the phone's long-lived credential — it never leaves secure
 * storage except to open a socket.
 */
export interface PairedBackend {
  backendId: string;
  name: string;
  /** http(s) base URLs, the one that worked at pairing time first. */
  endpoints: string[];
  deviceId: string;
  deviceToken: string;
  /** ISO 8601. */
  pairedAt: string;
  appVersion: string;
  protocolVersion: number;
}

const KEY = "mains.pairedBackend";
const credentials = createCredentialPersistence({
  read: () => SecureStore.getItemAsync(KEY),
  write: (value) => SecureStore.setItemAsync(KEY, value, {
    // Background reconnects can read it after the first unlock following reboot.
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  }),
  remove: () => SecureStore.deleteItemAsync(KEY),
});

function isPairedBackend(value: unknown): value is PairedBackend {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.backendId === "string" &&
    typeof v.name === "string" &&
    Array.isArray(v.endpoints) &&
    v.endpoints.every((e) => typeof e === "string") &&
    typeof v.deviceId === "string" &&
    typeof v.deviceToken === "string"
  );
}

export async function loadPairedBackend(): Promise<PairedBackend | null> {
  const raw = await credentials.load();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPairedBackend(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function savePairedBackend(backend: PairedBackend, options: { signal?: AbortSignal } = {}): Promise<void> {
  await credentials.save(JSON.stringify(backend), options.signal);
}

export async function forgetPairedBackend(): Promise<void> {
  await credentials.forget();
}
