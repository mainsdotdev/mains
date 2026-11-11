/** Shared classification and client transitions; live text never enters SQLite. */
export function isAssistantReportStream(event: { kind: string; metadata?: Record<string, unknown> }): boolean {
  if (event.kind !== "report" || event.metadata?.voice === true || event.metadata?.isFromSubagent === true) return false;
  const source = event.metadata?.source;
  return source === undefined || source === "agent_message_streaming" || source === "assistant.message_delta";
}

export interface TranscriptStream {
  kind: string;
  content: string;
  metadata?: Record<string, unknown>;
  streamId: string;
  timestamp: number;
}

/** Scope this owner to one backend/conversation. Acknowledgement survives a
 * paged row leaving the visible window. Terminal previews cannot be replaced
 * by late deltas; ordinary work completion does not close a voice connection. */
export function createTranscriptStreams() {
  const streams = new Map<string, TranscriptStream>();
  const acknowledged = new Set<string>();
  const closedVoice = new Set<string>();
  return {
    receive(input: TranscriptStream): boolean {
      const id = input.streamId;
      if (!id || acknowledged.has(id)) return false;
      if (input.metadata?.voice === true && typeof input.metadata.realtimeSessionId === "string" && closedVoice.has(input.metadata.realtimeSessionId)) return false;
      const previous = streams.get(id);
      if (previous?.metadata?.streaming === false) return false;
      if (!input.content) return streams.delete(id);
      streams.set(id, { ...input, timestamp: previous?.timestamp ?? input.timestamp });
      return true;
    },
    acknowledge(ids: ReadonlySet<string>): boolean {
      let changed = false;
      for (const id of ids) { acknowledged.add(id); if (streams.delete(id)) changed = true; }
      return changed;
    },
    settleTurn(interrupted = false): boolean {
      let changed = false;
      for (const [id, stream] of streams) {
        if (stream.metadata?.voice === true) continue;
        if (isAssistantReportStream(stream)) {
          if (stream.metadata?.streaming === false) continue;
          streams.set(id, { ...stream, metadata: { ...stream.metadata, streaming: false, interrupted } });
        } else streams.delete(id);
        changed = true;
      }
      return changed;
    },
    closeVoice(connectionId: string): boolean {
      closedVoice.add(connectionId);
      let changed = false;
      for (const [id, stream] of streams) {
        if (stream.metadata?.voice === true && stream.metadata.realtimeSessionId === connectionId && stream.metadata.streaming !== false) {
          streams.delete(id); acknowledged.add(id); changed = true;
        }
      }
      return changed;
    },
    values: () => [...streams.values()],
    clear(): void { streams.clear(); acknowledged.clear(); closedVoice.clear(); },
  };
}
