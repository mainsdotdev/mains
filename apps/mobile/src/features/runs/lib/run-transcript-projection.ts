import type { StreamingMessage } from "../../../backend/streaming-messages";
import type { TranscriptItem } from "../../../lib/transcript";

/**
 * Merge the durable transcript with the assistant text that still exists only
 * on the wire. Durable text wins as soon as it lands, so the same response is
 * never rendered twice while the streaming store catches up.
 */
export function projectStreamingTranscript(
  items: TranscriptItem[],
  streamingMessages: readonly StreamingMessage[],
): {
  persistedResponseContents: ReadonlySet<string>;
  streamingItems: TranscriptItem[];
} {
  const persistedResponseContents = new Set(
    items
      .filter((item): item is Extract<TranscriptItem, { kind: "response" }> =>
        item.kind === "response",
      )
      .map((item) => item.text.trim()),
  );
  const streamingItems: TranscriptItem[] = streamingMessages
    .filter((message) => !persistedResponseContents.has(message.text.trim()))
    .map((message) => ({
      key: message.key,
      kind: "response",
      text: message.text,
      at: message.at,
    }));

  return { persistedResponseContents, streamingItems };
}
