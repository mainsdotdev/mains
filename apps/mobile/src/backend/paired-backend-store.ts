import * as SecureStore from "expo-secure-store";

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
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPairedBackend(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function savePairedBackend(backend: PairedBackend): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(backend), {
    // Readable after the first unlock following a reboot, so a background
    // reconnect (push → sync) can open a socket without the phone being unlocked.
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

export async function forgetPairedBackend(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
