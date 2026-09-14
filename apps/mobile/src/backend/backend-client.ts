import { toWebSocketUrl, type BackendDescriptor } from "@mains/contracts/backend";
import {
  buildSubprotocols,
  decodeWsMessage,
  encodeWsMessage,
} from "@mains/contracts/ws-protocol";
import type { PairedBackend } from "./paired-backend-store";

const PROBE_TIMEOUT_MS = 8000;
const DESCRIBE_ID = 1;

export interface BackendProbe {
  descriptor: BackendDescriptor;
  /** The endpoint that answered. */
  endpoint: string;
  latencyMs: number;
}

/** The backend was reached and rejected our device token (revoked or unknown). */
export class BackendRefusedError extends Error {}

/**
 * React Native reports a failed handshake as a message-less `error` followed
 * by a `close` whose `reason` carries the native text (e.g. "Expected HTTP 101
 * response but was '401 Unauthorized'"), so the close event is where the cause
 * lives.
 */
function errorFromClose(event: CloseEvent): Error {
  const reason = event.reason ?? "";
  if (/\b401\b|unauthorized/i.test(reason)) {
    return new BackendRefusedError(
      "Your Mac refused the connection — was this phone revoked?",
    );
  }
  if (reason) return new Error(`Connection failed (${reason})`);
  return new Error(`Connection closed (code ${event.code})`);
}

/**
 * Open a socket with this phone's device token, ask `backend:describe`, close.
 * A one-shot probe — the connection supervisor that keeps a socket alive comes
 * later and will reuse the same handshake.
 */
function probeEndpoint(endpoint: string, deviceToken: string): Promise<BackendProbe> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = new WebSocket(
      toWebSocketUrl(endpoint),
      buildSubprotocols(deviceToken),
    );
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // already closed
      }
      outcome();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error("Timed out"))),
      PROBE_TIMEOUT_MS,
    );

    socket.onopen = () => {
      socket.send(
        encodeWsMessage({
          kind: "invoke",
          id: DESCRIBE_ID,
          channel: "backend:describe",
          args: [],
        }),
      );
    };
    socket.onmessage = (event) => {
      let message;
      try {
        message = decodeWsMessage(String(event.data));
      } catch {
        return;
      }
      if (message.kind !== "response" || message.id !== DESCRIBE_ID) return;
      const { result } = message;
      if (!result.success) {
        finish(() => reject(new Error(result.error)));
        return;
      }
      finish(() =>
        resolve({
          descriptor: result.data as BackendDescriptor,
          endpoint,
          latencyMs: Date.now() - started,
        }),
      );
    };
    socket.onerror = () => {
      // Deliberately not settling here: the `close` that always follows is the
      // one carrying the reason (see errorFromClose).
    };
    socket.onclose = (event) => {
      finish(() => reject(errorFromClose(event)));
    };
  });
}

/**
 * Try each remembered endpoint in order; first answer wins. A refusal is
 * final — the same backend would refuse the same token on every address.
 */
export async function probeBackend(backend: PairedBackend): Promise<BackendProbe> {
  let lastError: Error | null = null;
  for (const endpoint of backend.endpoints) {
    try {
      return await probeEndpoint(endpoint, backend.deviceToken);
    } catch (error) {
      if (error instanceof BackendRefusedError) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("No endpoint to try");
}
