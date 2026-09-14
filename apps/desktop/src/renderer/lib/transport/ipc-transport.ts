import type { ServiceResponse } from "../../../shared/ipc-kit/service-response";
import type {
  MainTransportBridge,
  Transport,
  TransportStatus,
} from "./types";

/**
 * Local transport: routes calls to the main process over Electron IPC, via the
 * generic bridge the preload exposes on `window.mainTransport`.
 *
 * This is the default transport and preserves today's behavior exactly — it is
 * the in-process path. The bridge is resolved lazily per call so the class can
 * be constructed in environments where `window` is not present (e.g. unit
 * tests), and a bridge can be injected for testing.
 */
export class IpcTransport implements Transport {
  readonly kind = "ipc";

  constructor(private readonly bridgeOverride?: MainTransportBridge) {}

  private bridge(): MainTransportBridge {
    const bridge =
      this.bridgeOverride ??
      (globalThis as { window?: { mainTransport?: MainTransportBridge } }).window
        ?.mainTransport;
    if (!bridge) {
      throw new Error(
        "window.mainTransport is unavailable — the preload IPC transport bridge was not exposed",
      );
    }
    return bridge;
  }

  invoke(
    channel: string,
    args: unknown[] = [],
  ): Promise<ServiceResponse<unknown>> {
    return this.bridge().invoke(channel, args);
  }

  subscribe(channel: string, listener: (payload: unknown) => void): () => void {
    return this.bridge().subscribe(channel, listener);
  }

  status(): TransportStatus {
    // The local main process shares this process tree; it is always reachable.
    return "connected";
  }

  onStatusChange(_listener: (status: TransportStatus) => void): () => void {
    // Local status never changes, so there is nothing to emit.
    return () => {};
  }
}
