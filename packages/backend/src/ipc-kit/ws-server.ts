import { fail, type ServiceResponse } from "@mains/contracts/service-response";
import { CHANNELS } from "@mains/contracts/channels";
import {
  decodeWsMessage,
  encodeWsMessage,
  MAX_DEVICE_MESSAGE_BYTES,
} from "@mains/contracts/ws-protocol";
import { runStoredCommand, type CommandReceiptStore } from "./command-delivery";
import { invokeHandler, type IpcInvokeContext } from "./handler-registry";
import type { WebSocketSink, WsClientConnection } from "./websocket-sink";

export type { CommandReceiptStore } from "./command-delivery";

/**
 * A single accepted WebSocket connection, abstracted away from any particular
 * server library. A thin adapter maps the chosen `ws`-style socket onto this.
 */
export interface WsConnection extends WsClientConnection {
  /** Paired device this connection authenticated as, if it used a device token. */
  readonly deviceId?: string;
  /**
   * Channels a paired device may invoke; undefined means unrestricted (the
   * owner token, which grants full control by design).
   */
  readonly allowedChannels?: ReadonlySet<string>;
  /** Mutations a paired device may issue — only with a `commandId`. */
  readonly commandChannels?: ReadonlySet<string>;
  onMessage(listener: (data: string) => void): void;
  onClose(listener: () => void): void;
}

export interface ServeConnectionOptions {
  commandReceipts?: CommandReceiptStore;
  accepting?: () => boolean;
  track?: (work: Promise<void>) => void;
}

/**
 * Wire one accepted connection to the backend:
 *  - register it with the sink so bus events reach it (and unregister on close),
 *  - route incoming `invoke` frames to the handler-registry, replying with
 *    `response` frames carrying the unchanged {@link ServiceResponse} envelope.
 *
 * The connection id is passed to handlers as `ctx.clientId`, so client-scoped
 * features (e.g. terminal streaming) can target the right client.
 *
 * See docs/design/remote-backend.md (Pillar B — WS router).
 */
export function serveConnection(
  conn: WsConnection,
  sink: WebSocketSink,
  options: ServeConnectionOptions = {},
): void {
  let open = true;
  sink.addClient(conn);
  conn.onClose(() => { open = false; sink.removeClient(conn.id); });
  conn.onMessage((data) => {
    if (open && (options.accepting?.() ?? true)) {
      const work = routeMessage(conn, data, options, () => open);
      options.track?.(work);
    }
  });
}

// Recovery material must never be persisted or replayed through command receipts.
const secretResponses = new Set<string>([CHANNELS.bridge.takeRecoveryCode, CHANNELS.bridge.regenerateRecoveryCode]);

async function routeMessage(
  conn: WsConnection,
  data: string,
  options: ServeConnectionOptions,
  isOpen: () => boolean,
): Promise<void> {
  let message;
  try {
    message = decodeWsMessage(data);
  } catch {
    return; // ignore malformed frames
  }
  // The server only accepts client→server invokes; response/event are outbound.
  if (message.kind !== "invoke") return;
  const { channel, commandId } = message;
  const reply = (result: ServiceResponse<unknown>) => {
    if (!isOpen()) return;
    let frame = encodeWsMessage({ kind: "response", id: message.id, result });
    if (conn.deviceId && Buffer.byteLength(frame) > MAX_DEVICE_MESSAGE_BYTES) {
      frame = encodeWsMessage({ kind: "response", id: message.id,
        result: fail("This response exceeds the mobile data limit. Open the content on your computer.") });
    }
    try { conn.send(frame); }
    catch { /* The command receipt survives a lost response. */ }
  };

  // A paired device's allowlist is checked here, before any handler runs, so
  // no module has to know about devices to be safe from one. Mutations are
  // reachable only as commands — with an id the router can make idempotent.
  if (conn.allowedChannels) {
    const isCommand = conn.commandChannels?.has(channel) ?? false;
    if (!isCommand && !conn.allowedChannels.has(channel)) {
      reply(fail(`Channel "${channel}" is not available to paired devices`));
      return;
    }
    if (isCommand && !commandId) {
      reply(fail(`Channel "${channel}" requires a commandId from paired devices`));
      return;
    }
  }

  // Only set `deviceId` when there is one: a bare `undefined` would be tagged
  // by the wire codec and show up as a key in every handler's ctx.
  const ctx: IpcInvokeContext = conn.deviceId
    ? { clientId: conn.id, deviceId: conn.deviceId }
    : { clientId: conn.id };

  const receipts = options.commandReceipts;
  if (conn.deviceId && commandId && !receipts && !secretResponses.has(channel)) {
    reply(fail("Command delivery is unavailable. The command was not run."));
    return;
  }
  const result =
    conn.deviceId && commandId && receipts && !secretResponses.has(channel)
      ? await runStoredCommand(receipts, conn.deviceId, commandId, channel, () => invokeHandler(channel, message.args, ctx))
      : await invokeHandler(channel, message.args, ctx);
  reply(result);
}
