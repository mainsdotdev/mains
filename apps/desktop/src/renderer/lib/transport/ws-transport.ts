import { WsTransport as WireTransport, type WsTransportOptions } from "@mains/contracts/ws-client";
import { CHANNELS } from "@mains/contracts/channels";
import { PR_MEDIA_CREATE_TIMEOUT_MS } from "@mains/contracts/pr-attachments";
import type { Transport } from "./types";

export type { WebSocketLike, WsTransportOptions } from "@mains/contracts/ws-client";

/** Desktop policy for long operations; wire lifecycle is shared with mobile. */
export class WsTransport extends WireTransport implements Transport {
  private readonly defaultInvokeTimeoutMs: number;

  constructor(url: string, options: WsTransportOptions = {}) {
    super(url, { maxMessageChars: Infinity, ...options });
    this.defaultInvokeTimeoutMs = options.invokeTimeoutMs ?? 30_000;
  }

  override invoke(channel: string, args: unknown[] = []) {
    const hasPrMedia = channel === CHANNELS.gitFlow.createPr &&
      Array.isArray((args[0] as { attachmentIds?: unknown } | undefined)?.attachmentIds) &&
      ((args[0] as { attachmentIds: unknown[] }).attachmentIds.length > 0);
    const isClone = channel === CHANNELS.workspace.createFromSource &&
      (args[0] as { source?: { kind?: unknown } } | undefined)?.source?.kind === "clone";
    const timeoutMs = isClone ? 0 : hasPrMedia && this.defaultInvokeTimeoutMs > 0
      ? Math.max(this.defaultInvokeTimeoutMs, PR_MEDIA_CREATE_TIMEOUT_MS) : this.defaultInvokeTimeoutMs;
    return super.invoke(channel, args, { timeoutMs });
  }
}
