import type { BackendDescriptor } from "@mains/contracts/backend";
import type { WsTransport } from "./ws-transport";

/**
 * Owns the one socket to the paired backend and the policy around it — the
 * thing the design doc says must live outside React (§5.4):
 *
 *  - offline → drop the socket, wait for the network signal; no retry timers
 *  - app comes to the foreground → make sure a socket exists
 *  - an endpoint that never opens → rotate to the next one; a full cycle of
 *    failures → `unreachable`, retried on a slow timer and on any signal
 *  - the backend refused the token → `authBlocked`; nothing to retry until
 *    the user re-pairs
 *  - socket open ≠ connected: `onConnected` (describe + snapshot sync) must
 *    finish first, and runs again after every reconnect
 *
 * Transport-level backoff for a dropped socket stays in `WsTransport`.
 */

export type ConnectionState =
  | { kind: "idle" }
  | { kind: "offline" }
  | { kind: "connecting"; endpoint: string }
  | { kind: "reconnecting"; endpoint: string }
  | { kind: "syncing"; endpoint: string }
  | { kind: "connected"; endpoint: string; descriptor: BackendDescriptor }
  | { kind: "unreachable"; reason: string }
  | { kind: "authBlocked"; reason: string }
  | { kind: "incompatible"; reason: string };

export interface SupervisorSignals {
  network: {
    isOnline(): Promise<boolean>;
    subscribe(listener: (online: boolean) => void): () => void;
  };
  lifecycle: {
    isActive(): boolean;
    subscribe(listener: (active: boolean) => void): () => void;
  };
}

export interface SupervisorDeps {
  endpoints: string[];
  createTransport(endpoint: string): WsTransport;
  /** Runs after every socket open, before the state becomes `connected`. */
  onConnected(transport: WsTransport, endpoint: string): Promise<BackendDescriptor>;
  signals: SupervisorSignals;
  /** Injectable timer for tests. Returns a cancel function. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

/** Thrown by `onConnected` when the backend speaks a protocol this app can't. */
export class ProtocolMismatchError extends Error {}

/** Reconnect attempts on one endpoint before moving to the next. */
const ATTEMPTS_PER_ENDPOINT = 3;
/** How long to wait after every endpoint failed before trying the cycle again. */
const UNREACHABLE_RETRY_MS = 30_000;

const defaultSchedule = (fn: () => void, ms: number) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export class ConnectionSupervisor {
  private state: ConnectionState = { kind: "idle" };
  private readonly listeners = new Set<() => void>();
  private readonly schedule: (fn: () => void, ms: number) => () => void;

  private transport: WsTransport | null = null;
  private unsubscribeTransport: (() => void)[] = [];
  private unsubscribeSignals: (() => void)[] = [];
  private cancelRetry: (() => void) | null = null;

  private online = true;
  private active = true;
  private endpointIndex = 0;
  private failedEndpointsThisCycle = 0;
  private disposed = false;
  /** Bumped on every teardown so stale async callbacks can bail. */
  private generation = 0;

  constructor(private readonly deps: SupervisorDeps) {
    this.schedule = deps.schedule ?? defaultSchedule;
  }

  getState = (): ConnectionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async start(): Promise<void> {
    if (this.disposed) return;
    const { network, lifecycle } = this.deps.signals;
    this.unsubscribeSignals.push(
      network.subscribe((online) => {
        this.online = online;
        this.evaluate();
      }),
      lifecycle.subscribe((active) => {
        this.active = active;
        if (active) this.evaluate();
      }),
    );
    this.active = lifecycle.isActive();
    this.online = await network.isOnline().catch(() => true);
    this.evaluate();
  }

  /** Forget the current failure and try again now (a user tapping "retry"). */
  retry(): void {
    if (this.disposed) return;
    if (this.state.kind === "authBlocked" || this.state.kind === "incompatible") {
      return; // needs re-pairing / an update, not another attempt
    }
    this.teardown();
    this.failedEndpointsThisCycle = 0;
    this.evaluate();
  }

  dispose(): void {
    this.disposed = true;
    this.teardown();
    for (const unsubscribe of this.unsubscribeSignals) unsubscribe();
    this.unsubscribeSignals = [];
    this.setState({ kind: "idle" });
  }

  private evaluate(): void {
    if (this.disposed) return;
    if (!this.online) {
      this.teardown();
      this.setState({ kind: "offline" });
      return;
    }
    // Terminal states wait for the outside world (re-pair, app update).
    if (this.state.kind === "authBlocked" || this.state.kind === "incompatible") {
      return;
    }
    if (!this.transport) this.connect();
  }

  private connect(): void {
    const endpoints = this.deps.endpoints;
    if (endpoints.length === 0) {
      this.setState({ kind: "unreachable", reason: "No address to connect to" });
      return;
    }
    const endpoint = endpoints[this.endpointIndex % endpoints.length];
    const generation = ++this.generation;
    const transport = this.deps.createTransport(endpoint);
    this.transport = transport;
    this.setState({ kind: "connecting", endpoint });

    let everOpened = false;
    let failedOpens = 0;
    this.unsubscribeTransport = [
      transport.onStatusChange((status) => {
        if (generation !== this.generation) return;
        switch (status) {
          case "connected":
            everOpened = true;
            this.failedEndpointsThisCycle = 0;
            void this.runOnConnected(transport, endpoint, generation);
            return;
          case "reconnecting":
            this.setState({ kind: "reconnecting", endpoint });
            return;
          case "offline":
            if (transport.isFatal) {
              this.teardown();
              this.setState({
                kind: "authBlocked",
                reason: "Your Mac refused this phone's token — pair it again",
              });
            }
            return;
          case "connecting":
            return;
        }
      }),
      // An address that never opens is abandoned after a few tries; a socket
      // that opened once and dropped keeps the transport's own backoff.
      transport.onClose((_info, fatal) => {
        if (generation !== this.generation || fatal || everOpened) return;
        failedOpens += 1;
        if (failedOpens >= ATTEMPTS_PER_ENDPOINT) this.rotateEndpoint();
      }),
    ];
    transport.connect();
  }

  private async runOnConnected(
    transport: WsTransport,
    endpoint: string,
    generation: number,
  ): Promise<void> {
    this.setState({ kind: "syncing", endpoint });
    try {
      const descriptor = await this.deps.onConnected(transport, endpoint);
      if (generation !== this.generation) return;
      this.setState({ kind: "connected", endpoint, descriptor });
    } catch (error) {
      if (generation !== this.generation) return;
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof ProtocolMismatchError) {
        this.teardown();
        this.setState({ kind: "incompatible", reason });
        return;
      }
      // The socket is fine but the first sync failed: keep the socket, show
      // the problem, and try the sync again shortly.
      this.setState({ kind: "unreachable", reason: `Sync failed: ${reason}` });
      this.cancelRetry?.();
      this.cancelRetry = this.schedule(() => {
        if (generation === this.generation && transport.status() === "connected") {
          void this.runOnConnected(transport, endpoint, generation);
        }
      }, 5_000);
    }
  }

  private rotateEndpoint(): void {
    this.teardown();
    this.failedEndpointsThisCycle += 1;
    this.endpointIndex = (this.endpointIndex + 1) % this.deps.endpoints.length;
    if (this.failedEndpointsThisCycle >= this.deps.endpoints.length) {
      this.failedEndpointsThisCycle = 0;
      this.setState({
        kind: "unreachable",
        reason: "Could not reach your Mac on any of its addresses",
      });
      this.cancelRetry = this.schedule(() => this.evaluate(), UNREACHABLE_RETRY_MS);
      return;
    }
    this.connect();
  }

  private teardown(): void {
    this.generation += 1;
    this.cancelRetry?.();
    this.cancelRetry = null;
    for (const unsubscribe of this.unsubscribeTransport) unsubscribe();
    this.unsubscribeTransport = [];
    this.transport?.dispose();
    this.transport = null;
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
