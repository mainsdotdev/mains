import type { ReadRunHistoryPayload, RunHistoryCursor } from "./runs";

const PAGE_TURNS = 20;
const WINDOW_TURNS = 60;

export function compareHistoryCursors(a: RunHistoryCursor, b: RunHistoryCursor): number {
  return a.timestamp - b.timestamp || Number(a.source === "tool") - Number(b.source === "tool") || a.id - b.id;
}

/** Exclusive upper bound after the last known row, including timestamp ties. */
export function historyEndAfter(cursor: RunHistoryCursor): RunHistoryCursor {
  return { ...cursor, id: cursor.id + 1 };
}

/** Select complete prompt blocks. Only lightweight keys are examined here. */
export function historyWindow(anchors: RunHistoryCursor[], request: ReadRunHistoryPayload) {
  const seek = (cursor: RunHistoryCursor) => {
    let low = 0, high = anchors.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (compareHistoryCursors(anchors[mid], cursor) < 0) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  let start = Math.max(0, anchors.length - PAGE_TURNS);
  let end = anchors.length;
  let endCursor: RunHistoryCursor | null = null;
  switch (request.direction) {
    case "older":
      start = Math.max(0, seek(request.cursor!) - PAGE_TURNS);
      end = Math.min(anchors.length, start + WINDOW_TURNS);
      endCursor = anchors[end] ?? null;
      break;
    case "newer":
      end = Math.min(anchors.length, seek(request.cursor!) + PAGE_TURNS);
      start = Math.max(0, end - WINDOW_TURNS);
      endCursor = anchors[end] ?? null;
      break;
    case "refresh":
      start = request.cursor ? seek(request.cursor) : start;
      end = request.end ? seek(request.end) : anchors.length;
      start = Math.max(start, end - WINDOW_TURNS);
      endCursor = request.end ?? null;
      break;
  }
  return { start: anchors[start] ?? null, end: endCursor };
}
