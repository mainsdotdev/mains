/** The stable action anchors for a transcript while its final turn changes. */
export interface TranscriptActionState {
  /** A response still being written must not expose copy/fork yet. */
  liveResponseKey: string | null;
  /** The latest settled response from which the provider session can branch. */
  forkKey: string | null;
}

interface ActionItem {
  kind: string;
  key: string;
}

/** Last response before an item boundary, or the transcript's last response. */
function responseBefore(items: readonly ActionItem[], end = items.length): string | null {
  for (let index = end - 1; index >= 0; index--) {
    if (items[index].kind === "response") return items[index].key;
  }
  return null;
}

/**
 * Work out which action row is live and which one remains the fork point.
 *
 * A local continuation is significant: the Mac may report the run as live
 * before its copy of the prompt arrives. During that window the transcript's
 * final response is still the *previous*, settled one, so its action row must
 * stay mounted rather than being mistaken for a response currently streaming.
 */
export function transcriptActionState(
  items: readonly ActionItem[],
  options: { runIsLive: boolean; hasLocalContinuation: boolean },
): TranscriptActionState {
  const lastResponseKey = responseBefore(items);
  const turnIsActive = options.runIsLive || options.hasLocalContinuation;
  if (!turnIsActive) {
    return { liveResponseKey: null, forkKey: lastResponseKey };
  }

  if (options.hasLocalContinuation) {
    return { liveResponseKey: null, forkKey: lastResponseKey };
  }

  let lastPromptIndex = -1;
  let lastResponseIndex = -1;
  for (let index = 0; index < items.length; index++) {
    if (items[index].kind === "prompt") lastPromptIndex = index;
    if (items[index].kind === "response") lastResponseIndex = index;
  }

  return {
    liveResponseKey:
      lastResponseIndex > lastPromptIndex ? items[lastResponseIndex].key : null,
    forkKey: responseBefore(items, lastPromptIndex),
  };
}
