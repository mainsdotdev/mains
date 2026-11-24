import type { BackendDescriptor } from "@mains/contracts/backend";
import { CHANNELS } from "@mains/contracts/channels";
import { WS_PROTOCOL_VERSION } from "@mains/contracts/ws-protocol";
import { IpcTransport } from "./ipc-transport";
import { getTransport, onTransportChange, setTransport } from "./registry";
import { WsTransport, type WsTransportOptions } from "./ws-transport";
import { createBackendSwitchLifecycle, type BackendSwitchAttempt } from "./backend-switch-lifecycle";

let activeRemote: WsTransport | null = null;
const switches = createBackendSwitchLifecycle();
let publishing: WsTransport | null = null;
onTransportChange((transport) => {
  if (transport === publishing) return;
  activeRemote = null;
  void switches.disconnect();
});
export const beginRemoteBackendSwitch = (target?: string) => switches.begin(target);
export function cancelRemoteBackendSwitch(target: string, onDisconnected?: () => void): void {
  if (switches.cancelTarget(target)) void disconnectRemoteBackend(onDisconnected);
}
const REMOTE_BACKEND_HANDSHAKE_TIMEOUT_MS = 10_000;

function withHandshakeTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `Backend handshake timed out after ${REMOTE_BACKEND_HANDSHAKE_TIMEOUT_MS}ms`,
        ),
      );
    }, REMOTE_BACKEND_HANDSHAKE_TIMEOUT_MS);
  });

  return Promise.race([operation, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

function parseBackendDescriptor(value: unknown): BackendDescriptor {
  if (!value || typeof value !== "object") {
    throw new Error("The server did not return a valid Mains descriptor.");
  }

  const descriptor = value as Record<string, unknown>;
  if (
    typeof descriptor.backendId !== "string" ||
    !descriptor.backendId ||
    typeof descriptor.name !== "string" ||
    !descriptor.name ||
    typeof descriptor.appVersion !== "string" ||
    typeof descriptor.protocolVersion !== "number" ||
    !Array.isArray(descriptor.capabilities) ||
    !descriptor.capabilities.every((item) => typeof item === "string") ||
    typeof descriptor.serverTime !== "string"
  ) {
    throw new Error("The server did not return a valid Mains descriptor.");
  }

  return value as BackendDescriptor;
}

function assertCompatible(descriptor: BackendDescriptor): void {
  if (descriptor.protocolVersion !== WS_PROTOCOL_VERSION) {
    throw new Error(
      `Incompatible Mains protocol: server uses v${descriptor.protocolVersion}, ` +
        `this app uses v${WS_PROTOCOL_VERSION}. Update Mains on both machines.`,
    );
  }
}

export interface RemoteBackendConnection {
  transport: WsTransport;
  descriptor: BackendDescriptor;
}

/**
 * Verify a remote backend, then atomically point the UI at it. The existing
 * backend remains active while the candidate answers `backend:describe`; a bad
 * address, credential, descriptor, or protocol version therefore cannot knock
 * the current UI offline.
 *
 * Switching the active transport invalidates RTK Query's cache (wired in the
 * store), so the UI refetches from the new backend.
 */
export async function connectRemoteBackend(
  url: string,
  options?: WsTransportOptions,
  activation?: { attempt: BackendSwitchAttempt; onActivated(connection: RemoteBackendConnection): void },
): Promise<RemoteBackendConnection> {
  const attempt = activation?.attempt ?? beginRemoteBackendSwitch();
  attempt.assertCurrent();
  const reconnect = options?.reconnect ?? true;
  const transport = new WsTransport(url, {
    ...options,
    reconnect: false,
  });
  attempt.retain(() => transport.dispose());
  try {
    attempt.verifying();
    transport.connect();
    if (transport.status() === "offline") {
      throw new Error("The WebSocket connection could not be opened.");
    }

    const response = await withHandshakeTimeout(
      transport.invoke(CHANNELS.backend.describe),
    );
    if (!response.success) {
      throw new Error(response.error || "The backend rejected the connection.");
    }

    const descriptor = parseBackendDescriptor(response.data);
    assertCompatible(descriptor);
    attempt.assertCurrent();
    if (transport.status() !== "connected") throw new Error("The verified backend disconnected before activation.");
    if (reconnect) transport.enableReconnect();

    const connection = { transport, descriptor };
    attempt.promote(() => {
      activeRemote = transport;
      publishing = transport;
      try {
        setTransport(transport, () => {
          if (attempt.isActive()) activation?.onActivated(connection);
        });
      } finally { publishing = null; }
    });
    if (!attempt.isActive() || getTransport() !== transport) throw new Error("This backend connection was replaced during activation.");

    return connection;
  } catch (error) {
    attempt.cancel();
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not verify this Mains server. ${reason}`);
  }
}

/** Return to the local (in-process) backend, disposing any remote connection. */
export function disconnectRemoteBackend(onDisconnected?: () => void): Promise<void> {
  const cleanup = switches.disconnect();
  activeRemote = null;
  if (getTransport().kind !== "ipc") {
    setTransport(new IpcTransport(), onDisconnected);
  } else onDisconnected?.();
  return cleanup;
}

/** The active remote transport, or null when running locally. */
export function getActiveRemote(): WsTransport | null {
  return activeRemote;
}
