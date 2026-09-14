import { bench, describe } from "vitest";
import type { RunEvent } from "../types";
import { groupEvents, reconcileEventGroups } from "./group-events";
import { buildTurnRenderRows, matchTurnsToGroups } from "./transcript-rows";

function makeTranscript(eventCount: number): RunEvent[] {
  const events: RunEvent[] = [];
  const baseTime = 1_700_000_000_000;

  for (let i = 0; i < eventCount; i++) {
    const turnOffset = i % 10;
    const timestamp = new Date(baseTime + i * 10);
    if (turnOffset === 0) {
      events.push({
        id: `prompt-${i}`,
        type: "artifact",
        content: `User prompt ${i / 10}`,
        timestamp,
        metadata: { kind: "user-prompt" },
      });
    } else if (turnOffset === 3 || turnOffset === 7) {
      events.push({
        id: `response-${i}`,
        type: "artifact",
        content: `Assistant response ${i}`,
        timestamp,
        metadata: { kind: "response" },
      });
    } else {
      events.push({
        id: `tool-${i}`,
        type: "tool_call",
        content: `Read: file-${i % 50}.ts`,
        timestamp,
        metadata: { toolName: "Read" },
      });
    }
  }

  return events;
}

function runTranscriptPipeline(events: RunEvent[]) {
  const groups = groupEvents(events);
  const reconciled = reconcileEventGroups(groups, groupEvents(events));
  buildTurnRenderRows(reconciled);
  matchTurnsToGroups(reconciled, [], events[0]?.timestamp, true);
}

describe("transcript derivation", () => {
  const medium = makeTranscript(1_000);
  const long = makeTranscript(10_000);
  const options = { time: 2_000, warmupTime: 500 };

  bench("1,000 events", () => runTranscriptPipeline(medium), options);
  bench("10,000 events", () => runTranscriptPipeline(long), options);
});
