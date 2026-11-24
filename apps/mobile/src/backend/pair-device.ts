import {
  isPairDeviceResult,
  type PairDeviceInput,
  type PairDeviceResult,
  type PairingLink,
} from "@mains/contracts/backend";
import type { PairedBackend } from "./paired-backend-store";
import { assertAuthActive } from "@mains/contracts/auth-lifecycle";

const PAIR_TIMEOUT_MS = 8000;

/** The backend answered and said no — the code is spent or invalid. */
export class PairingRejectedError extends Error {}

async function postPair(
  endpoint: string,
  input: PairDeviceInput,
  signal?: AbortSignal,
): Promise<PairDeviceResult> {
  assertAuthActive(signal, "Pairing canceled");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), PAIR_TIMEOUT_MS);
  try {
    const res = await fetch(`${endpoint}/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const payload: unknown = await res.json().catch(() => null);
    assertAuthActive(signal, "Pairing canceled");
    assertAuthActive(controller.signal, "Pairing request timed out");
    if (!res.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error: unknown }).error)
          : `Pairing failed (${res.status})`;
      throw new PairingRejectedError(message);
    }
    if (!isPairDeviceResult(payload)) {
      throw new PairingRejectedError("Unexpected reply from Mains on your computer");
    }
    return payload;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

/**
 * Redeem a scanned pairing link. Endpoints are tried in the order the desktop
 * listed them (most private first); the first one that answers wins and is
 * remembered first for later connections. A rejection is final — the same
 * backend would reject the same code on every other address too.
 */
export async function pairWithBackend(
  link: PairingLink,
  device: Omit<PairDeviceInput, "code">,
  options: { signal?: AbortSignal } = {},
): Promise<PairedBackend> {
  let lastError: Error | null = null;
  for (const endpoint of link.endpoints) {
    assertAuthActive(options.signal, "Pairing canceled");
    try {
      const result = await postPair(endpoint, { code: link.code, ...device }, options.signal);
      return {
        backendId: result.backend.backendId,
        name: result.backend.name,
        endpoints: [endpoint, ...link.endpoints.filter((e) => e !== endpoint)],
        deviceId: result.deviceId,
        deviceToken: result.deviceToken,
        pairedAt: new Date().toISOString(),
        appVersion: result.backend.appVersion,
        protocolVersion: result.backend.protocolVersion,
      };
    } catch (error) {
      assertAuthActive(options.signal, "Pairing canceled");
      if (error instanceof PairingRejectedError) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new Error(
    lastError
      ? `Could not reach Mains on your computer (${lastError.message})`
      : "Could not reach Mains on your computer",
  );
}
