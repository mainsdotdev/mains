import type { ReadRunHistoryContentPayload, ReadRunHistoryPayload } from "@mains/contracts/runs";
import { compareHistoryCursors } from "@mains/contracts/run-history";
export { historyWindow, compareHistoryCursors } from "@mains/contracts/run-history";

export function validateHistoryRequest(payload: ReadRunHistoryPayload): void {
  if (!payload || typeof payload.runId !== "string" || !payload.runId) throw new Error("Choose a conversation");
  if (payload.direction && !["latest", "older", "newer", "refresh"].includes(payload.direction)) throw new Error("Invalid history direction");
  if (payload.deferToolOutput != null && typeof payload.deferToolOutput !== "boolean") throw new Error("Invalid output option");
  if (payload.profile != null && payload.profile !== "mobile") throw new Error("Invalid history profile");
  if (payload.conversationWindow != null && (typeof payload.conversationWindow !== "boolean" || payload.profile !== "mobile")) throw new Error("Invalid conversation window");
  if (payload.range != null && (payload.profile !== "mobile" || payload.conversationWindow || !payload.range.start || !payload.range.end)) throw new Error("Invalid activity range");
  for (const cursor of [payload.cursor, payload.end, payload.range?.start, payload.range?.end]) {
    if (cursor == null) continue;
    if (!Number.isSafeInteger(cursor.timestamp) || cursor.timestamp < 0 ||
        !Number.isSafeInteger(cursor.id) || cursor.id < 0 || !["artifact", "tool"].includes(cursor.source)) throw new Error("Invalid history cursor");
  }
  if ((payload.direction === "older" || payload.direction === "newer") && !payload.cursor) throw new Error("History cursor is required");
  if (payload.cursor && payload.end && compareHistoryCursors(payload.cursor, payload.end) > 0) throw new Error("Invalid history window");
  if (payload.range && compareHistoryCursors(payload.range.start, payload.range.end) >= 0) throw new Error("Invalid activity range");
}

export function validateHistoryContentRequest(payload: ReadRunHistoryContentPayload): void {
  if (!payload || typeof payload.runId !== "string" || !payload.runId ||
    !["artifact", "tool-input", "tool-output", "turn-diff"].includes(payload.source) ||
    !Number.isSafeInteger(payload.id) || payload.id <= 0 ||
    (payload.offset != null && (!Number.isSafeInteger(payload.offset) || payload.offset < 0))) {
    throw new Error("Invalid conversation content request");
  }
}
