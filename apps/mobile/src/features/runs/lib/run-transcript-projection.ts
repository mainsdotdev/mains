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
  persistedStreamIds: ReadonlySet<string>;
  streamingItems: TranscriptItem[];
} {
  const responses = items
      .filter((item): item is Extract<TranscriptItem, { kind: "response" }> =>
        item.kind === "response",
      );
  const persistedResponseContents = new Set(responses.map((item) => item.text.trim()));
  const persistedStreamIds = new Set(responses.flatMap((item) => item.streamId ? [item.streamId] : []));
  // Older backends lack stream metadata. Match those messages only near the
  // live message's start, allowing SQLite's one-second timestamp precision.
  for (const message of streamingMessages) {
    if (responses.some((item) => !item.streamId && item.at + 1000 >= message.at && item.text.trim() === message.text.trim())) {
      persistedStreamIds.add(message.streamId);
    }
  }
  const streamingItems: TranscriptItem[] = streamingMessages
    .filter((message) => !persistedStreamIds.has(message.streamId))
    .map((message) => ({
      key: message.key,
      kind: "response",
      text: message.text,
      at: message.at,
    }));

  return { persistedResponseContents, persistedStreamIds, streamingItems };
}
