import type { BackendDescriptor } from "@mains/contracts/backend";
import type { WsTransport } from "./ws-transport";

/**
 * Owns the one socket to the paired backend and the policy around it — the
 * thing the design doc says must live outside React (§5.4):
 *
 *  - offline → drop the socket, wait for the network signal; no retry timers
 *  - app comes to the foreground → make sure a socket exists
 *  - at most 30s of visible recovery, including initial snapshot sync
 *  - failed endpoints rotate even if they previously worked; after recovery
 *    fails, `unreachable` stays visible during slow, silent probes
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
const RECOVERY_WINDOW_MS = 30_000;
const UNREACHABLE_REASON = "Could not reach Mains on your computer. Retrying automatically.";

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
  private cancelRecovery: (() => void) | null = null;
  /** Silent probes retain the unavailable state until the full sync succeeds. */
  private quiet = false;
  private syncAttempt = 0;

  private online = true;
  private active = true;
  private endpointIndex = 0;
  private failedEndpointsThisCycle = 0;
  private disposed = false;
  /** Bumped on every teardown so stale async callbacks can bail. */
  private generation = 0;
  private readonly deps: SupervisorDeps;

  constructor(deps: SupervisorDeps) {
    this.deps = deps;
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
    this.active = lifecycle.isActive();
    let networkChanged = false;
    this.unsubscribeSignals.push(
      network.subscribe((online) => {
        networkChanged = true;
        this.online = online;
        if (online && this.state.kind !== "connected") this.retry();
        else this.evaluate();
      }),
      lifecycle.subscribe((active) => {
        this.active = active;
        if (active) this.retry();
        else this.evaluate();
      }),
    );
    const online = await network.isOnline().catch(() => true);
    if (!networkChanged) this.online = online;
    this.evaluate();
  }

  /** Forget the current failure and try again now (a user tapping "retry"). */
  retry(): void {
    if (this.disposed) return;
    if (this.state.kind === "authBlocked" || this.state.kind === "incompatible") {
      return; // needs re-pairing / an update, not another attempt
    }
    this.teardown();
    this.quiet = false;
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
    // Losing network or backgrounding must not clear an authorization failure.
    if (this.state.kind === "authBlocked" || this.state.kind === "incompatible") return;
    if (!this.online) {
      this.teardown();
      this.setState({ kind: "offline" });
      return;
    }
    if (!this.active) {
      this.teardown();
      // Keep command recovery waiting for foreground; idle means the session stopped.
      this.setState({ kind: "offline" });
      return;
    }
    if (this.cancelRetry && !this.transport) return;
    if (!this.transport) this.connect();
  }

  private connect(): void {
    const endpoints = this.deps.endpoints;
    if (endpoints.length === 0) {
      this.setState({ kind: "unreachable", reason: "No address to connect to" });
      return;
    }
    const endpoint = endpoints[this.endpointIndex % endpoints.length];
    this.ensureRecoveryDeadline();
    const generation = ++this.generation;
    const transport = this.deps.createTransport(endpoint);
    this.transport = transport;
    if (!this.quiet) this.setState({ kind: "connecting", endpoint });

    let failedOpens = 0;
    this.unsubscribeTransport = [
      transport.onStatusChange((status) => {
        if (generation !== this.generation) return;
        switch (status) {
          case "connected":
            failedOpens = 0;
            void this.runOnConnected(transport, endpoint, generation);
            return;
          case "reconnecting":
            if (!this.quiet) this.setState({ kind: "reconnecting", endpoint });
            return;
          case "offline":
            if (transport.isFatal) {
              this.teardown();
              this.setState({
                kind: "authBlocked",
                reason: "Mains on your computer refused this phone's token — pair it again",
              });
            }
            return;
          case "connecting":
            return;
        }
      }),
      // A previously reachable address can disappear when Wi-Fi/IP changes too.
      transport.onClose((_info, fatal) => {
        if (generation !== this.generation || fatal) return;
        this.syncAttempt++;
        this.ensureRecoveryDeadline();
        failedOpens += 1;
        if (this.quiet || failedOpens >= ATTEMPTS_PER_ENDPOINT) this.rotateEndpoint();
      }),
    ];
    transport.connect();
  }

  private async runOnConnected(
    transport: WsTransport,
    endpoint: string,
    generation: number,
  ): Promise<void> {
    const attempt = ++this.syncAttempt;
    if (!this.quiet) this.setState({ kind: "syncing", endpoint });
    try {
      const descriptor = await this.deps.onConnected(transport, endpoint);
      if (generation !== this.generation || attempt !== this.syncAttempt) return;
      this.cancelRecovery?.();
      this.cancelRecovery = null;
      this.cancelRetry?.();
      this.cancelRetry = null;
      this.quiet = false;
      this.failedEndpointsThisCycle = 0;
      this.setState({ kind: "connected", endpoint, descriptor });
    } catch (error) {
      if (generation !== this.generation || attempt !== this.syncAttempt) return;
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof ProtocolMismatchError) {
        this.teardown();
        this.setState({ kind: "incompatible", reason });
        return;
      }
      if (this.quiet) { this.parkUnreachable(true); return; }
      // The socket is fine but the first sync failed: keep the socket, show
      // the problem, and try the sync again shortly.
      this.setState({ kind: "unreachable", reason: `Sync failed: ${reason}` });
      this.cancelRetry?.();
      this.cancelRetry = this.schedule(() => {
        this.cancelRetry = null;
        if (generation === this.generation && attempt === this.syncAttempt && transport.status() === "connected") {
          void this.runOnConnected(transport, endpoint, generation);
        }
      }, 5_000);
    }
  }

  private rotateEndpoint(): void {
    this.teardown(false);
    this.failedEndpointsThisCycle += 1;
    this.endpointIndex = (this.endpointIndex + 1) % this.deps.endpoints.length;
    if (this.quiet || this.failedEndpointsThisCycle >= this.deps.endpoints.length) {
      this.parkUnreachable(false);
      return;
    }
    this.connect();
  }

  private ensureRecoveryDeadline(): void {
    if (this.cancelRecovery) return;
    this.cancelRecovery = this.schedule(() => {
      this.cancelRecovery = null;
      this.parkUnreachable(true);
    }, RECOVERY_WINDOW_MS);
  }

  private parkUnreachable(advance: boolean): void {
    this.teardown();
    if (advance && this.deps.endpoints.length) this.endpointIndex = (this.endpointIndex + 1) % this.deps.endpoints.length;
    this.quiet = true;
    this.failedEndpointsThisCycle = 0;
    this.setState({ kind: "unreachable", reason: UNREACHABLE_REASON });
    this.cancelRetry = this.schedule(() => {
      this.cancelRetry = null;
      this.evaluate();
    }, UNREACHABLE_RETRY_MS);
  }

  private teardown(clearRecovery = true): void {
    this.generation += 1;
    this.syncAttempt++;
    if (clearRecovery) { this.cancelRecovery?.(); this.cancelRecovery = null; }
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
