import assert from "node:assert/strict";
import test from "node:test";

import { latestThinking } from "../src/features/runs/lib/latest-thinking.ts";

test("prefers the latest thinking artifact over legacy thinking logs", () => {
  assert.equal(
    latestThinking([
      { kind: "thinking", content: "Current reasoning" },
      { kind: "log", content: "[thinking] Legacy fallback" },
    ]),
    "Current reasoning",
  );
});

test("falls back to the latest legacy thinking log", () => {
  assert.equal(
    latestThinking([
      { kind: "log", content: "[thinking] First thought" },
      { kind: "log", content: "ordinary output" },
      { kind: "log", content: "[thinking] Latest thought" },
    ]),
    "Latest thought",
  );
});
