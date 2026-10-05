import type { RunTurn } from "@/lib/redux/api";
import type { RunEvent } from "../types";

function identity(metadata: Record<string, unknown> | null | undefined): string | null {
  if (typeof metadata?.realtimeSessionId !== "string" || typeof metadata.providerTurnId !== "string") return null;
  return JSON.stringify([metadata.realtimeSessionId, metadata.providerTurnId]);
}

export function voiceWorkTurnIdentity(turn: RunTurn): string | null {
  return turn.metadata?.inputSource === "voice" ? identity(turn.metadata) : null;
}

/** Speech stays in permanent history. Only work gets a presentation annotation;
 * the call's current state never participates in its identity or visibility. */
export function annotateVoiceWorkEvents(events: RunEvent[], turns: RunTurn[]): RunEvent[] {
  const scopes = new Map<string, { id: string; turn?: RunTurn }>();
  const byNativeTurn = new Map(turns.flatMap((turn) =>
    typeof turn.metadata?.providerTurnId === "string"
      ? [[turn.metadata.providerTurnId, turn] as const]
      : [],
  ));
  for (const turn of turns) {
    const id = voiceWorkTurnIdentity(turn);
    if (id) scopes.set(turn.metadata!.providerTurnId as string, { id, turn });
  }
  // Older voice work has no inputSource marker. Native call/turn evidence in
  // persisted reports or speech can recover its origin without text matching.
  for (const event of events) {
    const id = identity(event.metadata);
    const nativeId = event.metadata?.providerTurnId;
    if (!id || typeof nativeId !== "string" || event.metadata?.inputSource === "text" || scopes.has(nativeId)) continue;
    const turn = byNativeTurn.get(nativeId);
    if (turn?.metadata?.inputSource === "text") continue;
    scopes.set(nativeId, { id, turn });
  }
  if (!scopes.size) return events;
  const boundaries = turns.map((turn) => ({
    turn,
    start: turn.startedAt != null ? new Date(turn.startedAt).getTime() : Infinity,
    end: turn.endedAt != null ? new Date(turn.endedAt).getTime() : Infinity,
  }));
  let changed = false;
  const projected = events.map((event) => {
    const metadata = event.metadata;
    if (metadata?.voice === true || metadata?.kind === "user-prompt" || metadata?.inputSource === "text") return event;
    const nativeId = metadata?.providerTurnId;
    let scope = typeof nativeId === "string" ? scopes.get(nativeId) : undefined;
    if (typeof nativeId !== "string") {
      // Conservative compatibility for old tools/logs: an overlapping or
      // unknown turn cannot prove ownership. Explicit ids always take priority.
      const at = event.timestamp.getTime();
      const owners = boundaries.filter(({ start, end }) => at >= start && at <= end);
      if (owners.length === 1 && typeof owners[0].turn.metadata?.providerTurnId === "string") {
        scope = scopes.get(owners[0].turn.metadata.providerTurnId);
      }
    }
    if (!scope) return event;
    changed = true;
    return {
      ...event,
      metadata: {
        ...metadata,
        voiceWorkId: scope.id,
        ...(scope.turn ? { voiceWorkTurnId: scope.turn.id } : {}),
      },
    };
  });
  return changed ? projected : events;
}

/** Native voice work produces written agent prose as well as spoken narration.
 * Show the conversation once, keeping tools and deliverables in the timeline.
 * Provenance is permanent: ending a call cannot resurrect its written duplicate
 * or hide the agent's response to a subsequent typed message. */
export function projectVoiceTranscriptEvents(events: RunEvent[], turns: RunTurn[]): RunEvent[] {
  const annotated = annotateVoiceWorkEvents(events, turns);
  const visible = annotated.filter((event) => !(
    event.type === "artifact" && event.metadata?.kind === "report" &&
    event.metadata.voice !== true &&
    (event.metadata.inputSource === "voice" || typeof event.metadata.voiceWorkId === "string")
  ));
  return visible.length === annotated.length ? annotated : visible;
}
