import { RELAY_MAX_FRAME_CHARS, RELAY_PROTOCOL, validateRelayUrl, type RelayAccess } from "@mains/contracts/relay";
import { createRelaySession, encodeKey, relayPublicKey, relaySharedKey, RELAY_PROOF } from "./crypto";

// Native React Native, browser and Node WebSockets use different event types.
// Event properties are intentionally bivariant, as in DOM event handlers.
type SocketHandler<T> = { handle(event: T): void }["handle"];
export interface RelaySocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: SocketHandler<unknown> | null;
  onclose: SocketHandler<{ code?: number; reason?: string } | undefined> | null;
  onerror: SocketHandler<unknown> | null;
  onmessage: SocketHandler<{ data: unknown }> | null;
}
export type RelaySocketFactory = (url: string, protocols: string[]) => RelaySocket;

/** Presents a normal application WebSocket AFTER host proof and paired-device
 * authentication. Existing invoke/subscribe/recovery logic stays above it. */
export function createRelaySocket(access: RelayAccess, device: { backendId: string; deviceId: string; deviceToken: string }, factory: RelaySocketFactory, randomBytes: (length: number) => Uint8Array): RelaySocket {
  const url = validateRelayUrl(access.url);
  const secret = randomBytes(32), clientNonce = encodeKey(randomBytes(32));
  const helloKey = relayPublicKey(secret);
  const shared = relaySharedKey(secret, access.backendPublicKey);
  secret.fill(0);
  const raw = factory(`${url}/v1/device`, [RELAY_PROTOCOL, `ticket.${access.ticket}`]);
  let session: ReturnType<typeof createRelaySession> | null = null;
  let phase: "challenge" | "auth" | "open" | "closed" = "challenge";
  const finish = (code: number, reason: string) => {
    if (phase === "closed") return;
    phase = "closed"; socket.readyState = 3; clearTimeout(timer);
    shared.fill(0);
    raw.close();
    socket.onclose?.({ code, reason });
  };
  const socket: RelaySocket = {
    readyState: 0, onopen: null, onclose: null, onerror: null, onmessage: null,
    send(data) {
      if (phase !== "open" || !session) throw new Error("Relay connection is not open");
      raw.send(JSON.stringify(session.toBackend.seal(data)));
    },
    close() { finish(1000, "Closed"); },
  };
  const timer = setTimeout(() => finish(1006, "Relay handshake timed out"), 10_000);
  raw.onopen = () => {
    if (phase !== "closed") raw.send(JSON.stringify({ type: "hello", key: helloKey, nonce: clientNonce }));
  };
  raw.onerror = (event) => socket.onerror?.(event);
  // A relay's close code/reason is untrusted routing state. Only an encrypted
  // refusal from the pinned backend may mark the paired device unauthorized.
  raw.onclose = () => finish(1006, "Relay connection closed");
  raw.onmessage = (event) => {
    if (phase === "closed") return;
    try {
      if (typeof event.data !== "string" || event.data.length > RELAY_MAX_FRAME_CHARS) throw new Error("Invalid relay frame");
      const message = JSON.parse(event.data);
      if (phase === "challenge") {
        if (message.type !== "challenge") throw new Error("Invalid relay handshake");
        session = createRelaySession(shared, device.backendId, device.deviceId, clientNonce, message.nonce);
        shared.fill(0);
        if (session.toDevice.open(message.proof) !== RELAY_PROOF) throw new Error("Invalid backend proof");
        phase = "auth";
        raw.send(JSON.stringify(session.toBackend.seal(JSON.stringify({ type: "auth", token: device.deviceToken }))));
      } else if (session) {
        const text = session.toDevice.open(message);
        if (phase === "auth") {
          const reply = JSON.parse(text);
          if (reply.type === "rejected") { finish(1008, "Device authorization refused"); return; }
          if (reply.type !== "ready") throw new Error("Invalid relay authentication");
          phase = "open"; socket.readyState = 1; clearTimeout(timer); socket.onopen?.(undefined);
        } else socket.onmessage?.({ data: text });
      }
    } catch { finish(1002, "Invalid encrypted relay traffic"); }
  };
  return socket;
}
