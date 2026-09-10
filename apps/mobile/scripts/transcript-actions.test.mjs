import assert from "node:assert/strict";
import test from "node:test";

import { transcriptActionState } from "../src/lib/transcript-actions.ts";

const settledTurn = [
  { kind: "prompt", key: "prompt-1" },
  { kind: "response", key: "response-1" },
];

test("keeps the previous response actions stable while a local continuation starts", () => {
  assert.deepEqual(
    transcriptActionState(settledTurn, {
      runIsLive: true,
      hasLocalContinuation: true,
    }),
    { liveResponseKey: null, forkKey: "response-1" },
  );
});

test("hides only the response currently streaming and preserves the prior fork point", () => {
  assert.deepEqual(
    transcriptActionState(
      [
        ...settledTurn,
        { kind: "prompt", key: "prompt-2" },
        { kind: "response", key: "response-2" },
      ],
      { runIsLive: true, hasLocalContinuation: false },
    ),
    { liveResponseKey: "response-2", forkKey: "response-1" },
  );
});

test("moves the fork point to the latest response only after the run settles", () => {
  assert.deepEqual(
    transcriptActionState(
      [
        ...settledTurn,
        { kind: "prompt", key: "prompt-2" },
        { kind: "response", key: "response-2" },
      ],
      { runIsLive: false, hasLocalContinuation: false },
    ),
    { liveResponseKey: null, forkKey: "response-2" },
  );
});
