import { fail, type ServiceResponse } from "../../shared/ipc-kit/service-response";
import {
  decodeWireValue,
  decodeWsMessage,
  encodeWireValue,
  encodeWsMessage,
} from "../../shared/ipc-kit/ws-protocol";
import { invokeHandler, type IpcInvokeContext } from "./handler-registry";
import type { WebSocketSink, WsClientConnection } from "./websocket-sink";

/**
 * A single accepted WebSocket connection, abstracted away from any particular
 * server library. A thin adapter maps the chosen `ws`-style socket onto this.
 */
export interface WsConnection extends WsClientConnection {
  /** Paired device this connection authenticated as, if it used a device token. */
  readonly deviceId?: string;
  /**
   * Channels a paired device may invoke; undefined means unrestricted (the
   * shared pairing token, which grants full control by design).
   */
  readonly allowedChannels?: ReadonlySet<string>;
  /** Mutations a paired device may issue — only with a `commandId`. */
  readonly commandChannels?: ReadonlySet<string>;
  onMessage(listener: (data: string) => void): void;
  onClose(listener: () => void): void;
}

/**
 * Where a paired device's command results are kept for replay (see the
 * backend module's `command_receipts`). Values are wire-encoded
 * ServiceResponses, so a replay sends exactly what the first attempt got.
 */
export interface CommandReceiptStore {
  find(deviceId: string, commandId: string): Promise<string | null>;
  record(
    deviceId: string,
    commandId: string,
    channel: string,
    result: string,
  ): Promise<void>;
}

export interface ServeConnectionOptions {
  commandReceipts?: CommandReceiptStore;
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
  sink.addClient(conn);
  conn.onClose(() => sink.removeClient(conn.id));
  conn.onMessage((data) => {
    void routeMessage(conn, data, options);
  });
}

// Commands in progress, keyed by device + commandId. Module-level on purpose:
// a retry usually arrives over a NEW socket (the old one is what dropped), and
// it must find the attempt already running rather than start a second one.
const inFlightCommands = new Map<string, Promise<ServiceResponse<unknown>>>();

async function routeMessage(
  conn: WsConnection,
  data: string,
  options: ServeConnectionOptions,
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
  const reply = (result: ServiceResponse<unknown>) =>
    conn.send(encodeWsMessage({ kind: "response", id: message.id, result }));

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
  const result =
    conn.deviceId && commandId && receipts
      ? await runCommand(conn.deviceId, commandId, channel, message.args, ctx, receipts)
      : await invokeHandler(channel, message.args, ctx);
  reply(result);
}

/**
 * Exactly-once for a device's command: a repeat of a finished command replays
 * its receipt; a repeat of one still running waits for that run's result.
 */
function runCommand(
  deviceId: string,
  commandId: string,
  channel: string,
  args: unknown[],
  ctx: IpcInvokeContext,
  store: CommandReceiptStore,
): Promise<ServiceResponse<unknown>> {
  const key = `${deviceId} ${commandId}`;
  const running = inFlightCommands.get(key);
  if (running) return running;

  const attempt = (async () => {
    const stored = await store.find(deviceId, commandId).catch(() => null);
    if (stored !== null) return decodeWireValue(stored) as ServiceResponse<unknown>;
    const result = await invokeHandler(channel, args, ctx);
    try {
      await store.record(deviceId, commandId, channel, encodeWireValue(result));
    } catch (error) {
      // The command ran; a lost receipt only weakens a later retry.
      console.error(`[ws] could not record receipt for ${channel} (${commandId}):`, error);
    }
    return result;
  })().finally(() => {
    inFlightCommands.delete(key);
  });
  inFlightCommands.set(key, attempt);
  return attempt;
}
