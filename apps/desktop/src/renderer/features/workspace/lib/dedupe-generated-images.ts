import type { RunEvent } from "../types";

function imageIdentity(event: RunEvent): { hash: string; generated: boolean } | null {
  if (event.type !== "artifact" || event.metadata?.kind !== "image") return null;
  const hash = event.metadata.imageContentHash;
  const imagePath = event.metadata.path;
  if (typeof hash !== "string" || typeof imagePath !== "string") return null;
  return {
    hash,
    generated: imagePath.includes("/.codex/generated_images/"),
  };
}

/** Keep the saved deliverable when Codex's generated PNG was copied into the run. */
export function dedupeGeneratedImageCopies(events: RunEvent[]): RunEvent[] {
  const hiddenIds = new Set<string>();
  let turnStart = 0;

  const inspectTurn = (end: number) => {
    const savedHashes = new Set<string>();
    for (let i = turnStart; i < end; i++) {
      const identity = imageIdentity(events[i]);
      if (
        identity &&
        !identity.generated &&
        events[i].metadata?.working !== true &&
        events[i].metadata?.viewed !== true
      ) {
        savedHashes.add(identity.hash);
      }
    }
    for (let i = turnStart; i < end; i++) {
      const identity = imageIdentity(events[i]);
      if (identity?.generated && savedHashes.has(identity.hash)) {
        hiddenIds.add(events[i].id);
      }
    }
  };

  for (let i = 0; i < events.length; i++) {
    if (events[i].type === "artifact" && events[i].metadata?.kind === "user-prompt") {
      inspectTurn(i);
      turnStart = i + 1;
    }
  }
  inspectTurn(events.length);

  return hiddenIds.size === 0
    ? events
    : events.filter((event) => !hiddenIds.has(event.id));
}
