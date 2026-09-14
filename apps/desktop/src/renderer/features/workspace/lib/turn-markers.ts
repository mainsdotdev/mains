import type { EventGroup } from "./group-events";
import { isUserPromptGroup } from "./transcript-rows";

/** Longest reply excerpt kept for a marker's card; the card clamps the rest. */
const REPLY_EXCERPT_CHARS = 320;

export interface TurnMarker {
  /** Index of the user-prompt group — what the rail scrolls to. */
  index: number;
  /** Stable across re-renders (groups are reconciled by id), so a good key. */
  groupId: string;
  /** What the user asked. */
  prompt: string;
  /** The opening of the agent's answer to it, or "" while it is still thinking. */
  reply: string;
}

/** Collapse the whitespace a transcript excerpt would otherwise carry into a
 *  one-or-two-line card. */
function excerpt(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/**
 * One marker per user message, each carrying the reply it got.
 *
 * The reply is the response text between this prompt and the next one — the
 * same span the turn summary reads, minus the tool calls. An unanswered last
 * prompt yields an empty reply rather than being dropped: the user asked, so
 * the turn exists and has to be navigable.
 */
export function buildTurnMarkers(groups: EventGroup[]): TurnMarker[] {
  const markers: TurnMarker[] = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (!isUserPromptGroup(group)) continue;

    const prompt = group.events.map((e) => e.content).join(" ");
    const replyParts: string[] = [];
    for (let j = i + 1; j < groups.length && !isUserPromptGroup(groups[j]); j++) {
      if (groups[j].type !== "response") continue;
      for (const event of groups[j].events) {
        if (event.content) replyParts.push(event.content);
      }
      // One response group is enough for a preview; the rest is scrolling.
      if (replyParts.join(" ").length >= REPLY_EXCERPT_CHARS) break;
    }

    markers.push({
      index: i,
      groupId: group.id,
      prompt: excerpt(prompt, REPLY_EXCERPT_CHARS),
      reply: excerpt(replyParts.join(" "), REPLY_EXCERPT_CHARS),
    });
  }

  return markers;
}
