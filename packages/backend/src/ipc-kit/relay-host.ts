import { createHmac, randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { isPairDeviceResult } from "@mains/contracts/backend";
import { RELAY_MAX_FRAME_CHARS, RELAY_PROTOCOL, type RelayAccess, type RelayFrame } from "@mains/contracts/relay";
import { createRelaySession, encodeKey, relayPublicKey, relaySharedKey, RELAY_PROOF } from "@mains/relay/crypto";
import { serveConnection, type CommandReceiptStore } from "./ws-server";
import type { VerifiedDevice } from "./ws-server-host";
import type { WebSocketSink } from "./websocket-sink";
import type { RelayHostConfig } from "./relay-config";

interface RelayHostOptions {
  sink: WebSocketSink;
  verifyDeviceToken(token: string): Promise<VerifiedDevice | null>;
  commandReceipts?: CommandReceiptStore;
  onDeviceConnectionChange?: (deviceId: string) => void;
}
interface DeviceConnection {
  deviceId: string;
  authenticated: boolean;
  receive(payload: string): void;
  close(notify?: boolean): void;
}

export function relayTicket(config: RelayHostConfig, role: "backend" | "device", deviceId?: string): { ticket: string; expiresAt: string } {
  const exp = Math.floor(Date.now() / 1000) + (role === "backend" ? 3600 : 365 * 86400);
  const body = Buffer.from(JSON.stringify({ v: 1, role, backendId: config.backendId, ...(deviceId ? { deviceId } : {}), exp })).toString("base64url");
  const signature = createHmac("sha256", config.routingSecret).update(`mains.relay.ticket.v1.${body}`).digest("base64url");
  return { ticket: `${body}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Outbound multiplexed connection; Go never receives the pairing credential or
 * the application protocol. Every device still enters the existing WS router. */
export function startRelayHost(config: RelayHostConfig, options: RelayHostOptions) {
  let socket: WebSocket | null = null;
  let stopped = false, retryMs = 1000;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let pongDeadline: ReturnType<typeof setTimeout> | undefined;
  const devices = new Map<string, DeviceConnection>();
  const send = (message: RelayFrame) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    const text = JSON.stringify(message);
    if (text.length > RELAY_MAX_FRAME_CHARS || socket.bufferedAmount + Buffer.byteLength(text) > 8 * 1024 * 1024) {
      socket.terminate(); return false;
    }
    socket.send(text); return true;
  };

  function open(id: string, deviceId: string) {
    if (!/^[a-f0-9]{32}$/.test(id) || !/^[A-Za-z0-9_-]{1,128}$/.test(deviceId) || devices.has(id) || devices.size >= 128) {
      send({ type: "close", id }); return;
    }
    let phase: "hello" | "auth" | "checking" | "open" | "closed" = "hello";
    let session: ReturnType<typeof createRelaySession> | undefined;
    const messages = new Set<(data: string) => void>(), closes = new Set<() => void>();
    const timer = setTimeout(() => device.close(), 10_000);
    timer.unref();
    const encrypted = (text: string) => {
      if (!session) return;
      if (!send({ type: "data", id, payload: JSON.stringify(session.toDevice.seal(text)) })) device.close(false);
    };
    const device: DeviceConnection = {
      deviceId, authenticated: false,
      close(notify = true) {
        if (phase === "closed") return;
        phase = "closed"; clearTimeout(timer); devices.delete(id);
        for (const listener of closes) listener();
        messages.clear(); closes.clear();
        if (device.authenticated) options.onDeviceConnectionChange?.(deviceId);
        if (notify) send({ type: "close", id });
      },
      receive(payload) {
        if (phase === "closed") return;
        try {
          if (payload.length > RELAY_MAX_FRAME_CHARS) throw new Error("Oversized frame");
          const message = JSON.parse(payload);
          if (phase === "hello") {
            if (message.type !== "hello") throw new Error("Invalid hello");
            const serverNonce = encodeKey(randomBytes(32));
            const shared = relaySharedKey(config.privateKey, message.key);
            session = createRelaySession(shared, config.backendId, deviceId, message.nonce, serverNonce);
            shared.fill(0);
            phase = "auth";
            send({ type: "data", id, payload: JSON.stringify({ type: "challenge", nonce: serverNonce, proof: session.toDevice.seal(RELAY_PROOF) }) });
          } else if (phase === "auth" && session) {
            const auth = JSON.parse(session.toBackend.open(message));
            if (auth.type !== "auth" || typeof auth.token !== "string" || auth.token.length > 1024) throw new Error("Invalid authentication");
            phase = "checking";
            void options.verifyDeviceToken(auth.token).then((verified) => {
              if (phase !== "checking") return;
              if (!verified || verified.deviceId !== deviceId) {
                encrypted(JSON.stringify({ type: "rejected" })); device.close(); return;
              }
              phase = "open"; device.authenticated = true; clearTimeout(timer);
              serveConnection({
                id: `relay-${id}`, deviceId,
                allowedChannels: verified.channels, commandChannels: verified.commandChannels, eventChannels: verified.eventChannels,
                send: encrypted,
                onMessage: (listener) => { messages.add(listener); },
                onClose: (listener) => { closes.add(listener); },
              }, options.sink, { commandReceipts: options.commandReceipts });
              encrypted(JSON.stringify({ type: "ready" }));
              options.onDeviceConnectionChange?.(deviceId);
            }).catch(() => device.close());
          } else if (phase === "open" && session) {
            const text = session.toBackend.open(message);
            for (const listener of messages) listener(text);
          } else throw new Error("Unexpected relay message");
        } catch { device.close(); }
      },
    };
    devices.set(id, device);
  }

  function connect() {
    if (stopped) return;
    const raw = new WebSocket(`${config.url}/v1/backend`, [RELAY_PROTOCOL, `ticket.${relayTicket(config, "backend").ticket}`], { handshakeTimeout: 10_000, maxPayload: RELAY_MAX_FRAME_CHARS, perMessageDeflate: false });
    socket = raw;
    raw.on("open", () => {
      retryMs = 1000;
      heartbeat = setInterval(() => {
        if (pongDeadline || raw.readyState !== WebSocket.OPEN) return;
        raw.ping();
        pongDeadline = setTimeout(() => raw.terminate(), 10_000); pongDeadline.unref();
      }, 25_000); heartbeat.unref();
    });
    raw.on("pong", () => { clearTimeout(pongDeadline); pongDeadline = undefined; });
    raw.on("message", (data, binary) => {
      if (socket !== raw || stopped || binary) return;
      try {
        const message = JSON.parse(data.toString()) as RelayFrame;
        if (typeof message.id !== "string") throw new Error("Invalid routing frame");
        if (message.type === "open") open(message.id, message.deviceId);
        else if (message.type === "data" && typeof message.payload === "string") devices.get(message.id)?.receive(message.payload);
        else if (message.type === "close") devices.get(message.id)?.close(false);
        else throw new Error("Invalid routing frame");
      } catch { raw.terminate(); }
    });
    raw.on("error", () => { /* close schedules a bounded retry; no credential logging */ });
    raw.on("close", () => {
      if (socket !== raw) return;
      socket = null; clearInterval(heartbeat); clearTimeout(pongDeadline); pongDeadline = undefined;
      for (const device of [...devices.values()]) device.close(false);
      if (!stopped) {
        retry = setTimeout(connect, retryMs); retry.unref(); retryMs = Math.min(30_000, retryMs * 2);
      }
    });
  }
  connect();
  return {
    addPairingAccess(result: unknown): unknown {
      if (!isPairDeviceResult(result) || result.backend.backendId !== config.backendId) return result;
      const relay: RelayAccess = { url: config.url, backendPublicKey: relayPublicKey(config.privateKey), ...relayTicket(config, "device", result.deviceId) };
      return { ...result, relay };
    },
    connectedDeviceIds(): Set<string> { return new Set([...devices.values()].filter((d) => d.authenticated).map((d) => d.deviceId)); },
    disconnectDevice(deviceId: string): number {
      let count = 0;
      for (const device of [...devices.values()]) if (device.deviceId === deviceId) { device.close(); count++; }
      return count;
    },
    close() {
      stopped = true; clearTimeout(retry); clearInterval(heartbeat); clearTimeout(pongDeadline);
      for (const device of [...devices.values()]) device.close(false);
      socket?.terminate(); socket = null;
      config.privateKey.fill(0);
    },
  };
}
