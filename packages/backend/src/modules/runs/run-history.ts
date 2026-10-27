import type { ReadRunHistoryContentPayload, ReadRunHistoryPayload } from "@mains/contracts/runs";
import { compareHistoryCursors } from "@mains/contracts/run-history";
export { historyWindow, compareHistoryCursors } from "@mains/contracts/run-history";

export function validateHistoryRequest(payload: ReadRunHistoryPayload): void {
  if (!payload || typeof payload.runId !== "string" || !payload.runId) throw new Error("Choose a conversation");
  if (payload.direction && !["latest", "older", "newer", "refresh"].includes(payload.direction)) throw new Error("Invalid history direction");
  if (payload.deferToolOutput != null && typeof payload.deferToolOutput !== "boolean") throw new Error("Invalid output option");
  if (payload.profile != null && payload.profile !== "mobile") throw new Error("Invalid history profile");
  for (const cursor of [payload.cursor, payload.end]) {
    if (cursor == null) continue;
    if (!Number.isSafeInteger(cursor.timestamp) || cursor.timestamp < 0 ||
        !Number.isSafeInteger(cursor.id) || cursor.id < 0 || !["artifact", "tool"].includes(cursor.source)) throw new Error("Invalid history cursor");
  }
  if ((payload.direction === "older" || payload.direction === "newer") && !payload.cursor) throw new Error("History cursor is required");
  if (payload.cursor && payload.end && compareHistoryCursors(payload.cursor, payload.end) > 0) throw new Error("Invalid history window");
}

export function validateHistoryContentRequest(payload: ReadRunHistoryContentPayload): void {
  if (!payload || typeof payload.runId !== "string" || !payload.runId ||
    !["artifact", "tool-input", "tool-output", "turn-diff"].includes(payload.source) ||
    !Number.isSafeInteger(payload.id) || payload.id <= 0 ||
    (payload.offset != null && (!Number.isSafeInteger(payload.offset) || payload.offset < 0))) {
    throw new Error("Invalid conversation content request");
  }
}
