import type { BridgeServerMessage } from "@mains/contracts/bridge-protocol";

export interface BridgeConnectionScope<Socket> {
  current(): boolean;
  bind(socket: Socket): void;
  open(socket: Socket): boolean;
}

/** Socket acquisition, retirement and RPC admission share one generation.
 * Claim before callbacks; a retired token lookup can finish without a socket. */
export function createBridgeConnectionLifecycle<Socket>(effects: {
  isOpen(socket: Socket): boolean;
  dispose(socket: Socket): void;
  status(value: "connecting" | "connected" | "offline"): void;
}) {
  let phase: "disconnected" | "connecting" | "connected" | "closed" = "disconnected";
  let revision = 0, socket: Socket | undefined;
  let opening: Promise<Socket> | undefined, cancelOpening: (() => void) | undefined;
  const pending = new Map<string, { socket: Socket; timer: ReturnType<typeof setTimeout>;
    resolve(value: BridgeServerMessage): void; reject(error: Error): void }>();
  const closedError = () => new Error(phase === "closed" ? "Bridge transport is closed" : "Bridge connection cancelled");
  function disconnect(error = new Error("Bridge connection closed"), terminal = false) {
    if (phase === "closed") return;
    phase = terminal ? "closed" : "disconnected"; revision++;
    cancelOpening?.(); cancelOpening = undefined; opening = undefined;
    const previous = socket; socket = undefined;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
    if (previous !== undefined) effects.dispose(previous);
    effects.status("offline");
  }
  const owns = (peer: Socket) => socket === peer && phase !== "closed";
  function retire(peer: Socket, error?: Error) {
    if (!owns(peer)) return false;
    disconnect(error); return true;
  }
  return {
    get closed() { return phase === "closed"; },
    owns, retire,
    connect(acquire: (scope: BridgeConnectionScope<Socket>) => Promise<Socket>): Promise<Socket> {
      if (phase === "closed") return Promise.reject(closedError());
      if (phase === "connected" && socket !== undefined && effects.isOpen(socket)) return Promise.resolve(socket);
      if (opening) return opening;
      phase = "connecting";
      const captured = revision;
      const current = () => phase !== "closed" && captured === revision;
      let cancel!: () => void;
      const cancelled = new Promise<never>((_resolve, reject) => { cancel = () => reject(closedError()); });
      const acquisition = Promise.resolve().then(async () => {
        if (!current()) throw closedError();
        effects.status("connecting");
        if (!current()) throw closedError();
        const peer = await acquire({ current,
          bind(peer) { if (!current()) throw closedError(); socket = peer; },
          open(peer) { if (!current() || !owns(peer)) return false; phase = "connected"; return true; },
        });
        if (!current()) throw closedError();
        return peer;
      });
      const attempt = Promise.race([acquisition, cancelled]).catch((error) => {
        if (current()) disconnect(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }).finally(() => { if (opening === attempt) { opening = undefined; cancelOpening = undefined; } });
      opening = attempt; cancelOpening = cancel;
      return attempt;
    },
    request(peer: Socket, id: string, timeout: number, send: (done: (error?: Error | null) => void) => void): Promise<BridgeServerMessage> {
      if (!owns(peer) || !effects.isOpen(peer)) return Promise.reject(closedError());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { if (pending.get(id)?.socket === peer) retire(peer, new Error("Bridge request timed out")); }, timeout);
        pending.set(id, { socket: peer, resolve, reject, timer });
        const failed = (error?: Error | null) => { if (error && pending.get(id)?.socket === peer) retire(peer, new Error("Bridge request could not be sent")); };
        try { send(failed); } catch { failed(new Error("Bridge send failed")); }
      });
    },
    reply(peer: Socket, id: string, value: BridgeServerMessage | Error) {
      const entry = pending.get(id);
      if (!owns(peer) || entry?.socket !== peer) return;
      pending.delete(id); clearTimeout(entry.timer);
      if (value instanceof Error) entry.reject(value); else entry.resolve(value);
    },
    disconnect: () => disconnect(),
    close: () => disconnect(new Error("Bridge connection closed"), true),
  };
}
