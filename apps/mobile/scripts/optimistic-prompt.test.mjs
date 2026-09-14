import assert from "node:assert/strict";
import test from "node:test";

import {
  initialOptimisticPromptState,
  optimisticPromptReducer,
  projectOptimisticPrompt,
} from "../src/features/runs/lib/optimistic-prompt.ts";

const origin = { x: 10, y: 20, images: [] };
const flight = {
  text: {
    from: { x: 10, y: 20, width: 80, height: 24 },
    to: { x: 200, y: 100, width: 80, height: 24 },
  },
  images: [],
};
const firstTurn = [
  { key: "prompt-1", kind: "prompt", text: "First", at: 1, skills: [], files: [], images: [] },
  { key: "response-1", kind: "response", text: "Done", at: 2 },
];

function startContinuation(state, overrides = {}) {
  return optimisticPromptReducer(state, {
    type: "continuationStarted",
    launchId: "continuation:1",
    runId: "run-1",
    durableItems: firstTurn,
    prompt: {
      text: "Next",
      sourceText: "Next",
      skills: [],
      origin,
      attachments: [],
      ...overrides,
    },
  });
}

test("only a prompt with a visual origin begins in measuring", () => {
  assert.equal(
    initialOptimisticPromptState({ text: "Hello", skills: [], origin }).launch?.phase,
    "measuring",
  );
  assert.equal(initialOptimisticPromptState({ text: "Hello", skills: [] }).launch, null);
});

test("continuation start stamps the durable prompt count inside the state machine", () => {
  const state = startContinuation(initialOptimisticPromptState(null));

  assert.equal(state.continuation?.afterPromptCount, 1);
  assert.equal(state.launch?.afterPromptCount, 1);
});

test("stale and out-of-order native flight events are no-ops", () => {
  const measuring = startContinuation(initialOptimisticPromptState(null));
  const stale = optimisticPromptReducer(measuring, {
    type: "flightMeasured",
    launchId: "continuation:old",
    flight,
  });
  assert.equal(stale, measuring);

  const flying = optimisticPromptReducer(measuring, {
    type: "flightMeasured",
    launchId: "continuation:1",
    flight,
  });
  assert.equal(flying.launch?.phase, "flying");
  assert.equal(
    optimisticPromptReducer(flying, {
      type: "measurementFailed",
      launchId: "continuation:1",
    }),
    flying,
  );
  assert.equal(
    optimisticPromptReducer(flying, {
      type: "flightLanded",
      launchId: "continuation:1",
    }).launch?.phase,
    "landed",
  );
});

test("durable acknowledgement waits behind the local prompt until its flight lands", () => {
  const measuring = startContinuation(initialOptimisticPromptState(null));
  const flying = optimisticPromptReducer(measuring, {
    type: "flightMeasured",
    launchId: "continuation:1",
    flight,
  });
  const durableItems = [
    ...firstTurn,
    { key: "prompt-2", kind: "prompt", text: "Next", at: 3, skills: [], files: [], images: [] },
  ];
  const streamingItems = [{ key: "stream-2", kind: "response", text: "Working", at: 4 }];

  const inFlight = projectOptimisticPrompt({
    state: flying,
    initialPrompt: null,
    runId: "run-1",
    durableItems,
    streamingItems,
    runIsLive: true,
  });
  assert.deepEqual(inFlight.renderedItems.map((item) => item.key), ["prompt-1", "response-1"]);
  assert.equal(inFlight.pendingContinuationItem?.key, "pending-continuation");
  assert.deepEqual(inFlight.trailingStreamingItems.map((item) => item.key), ["stream-2"]);
  assert.equal(inFlight.flyingPromptItem?.key, "pending-continuation");

  const landed = optimisticPromptReducer(flying, {
    type: "flightLanded",
    launchId: "continuation:1",
  });
  const afterLanding = projectOptimisticPrompt({
    state: landed,
    initialPrompt: null,
    runId: "run-1",
    durableItems,
    streamingItems,
    runIsLive: true,
  });
  assert.equal(afterLanding.pendingContinuationItem, null);
  assert.deepEqual(afterLanding.renderedItems.map((item) => item.key), [
    "prompt-1",
    "response-1",
    "prompt-2",
    "stream-2",
  ]);
});

test("rollback atomically drops the local continuation and its launch", () => {
  const active = startContinuation(initialOptimisticPromptState(null), {
    text: "",
    sourceText: "",
    origin: null,
    attachments: [
      {
        id: "image:1",
        name: "one.png",
        type: "image",
        uri: "file:///one.png",
        mimeType: "image/png",
      },
    ],
  });
  const projected = projectOptimisticPrompt({
    state: active,
    initialPrompt: null,
    runId: "run-1",
    durableItems: firstTurn,
    streamingItems: [],
    runIsLive: false,
  });
  assert.deepEqual(projected.pendingContinuationItem?.images, [
    { key: "image:1", name: "one.png", uri: "file:///one.png", previewCropBottom: undefined },
  ]);

  assert.deepEqual(optimisticPromptReducer(active, { type: "continuationRolledBack" }), {
    continuation: null,
    launch: null,
  });
});

test("a continuation from another run cannot leak into this transcript", () => {
  const active = startContinuation(initialOptimisticPromptState(null), { origin: null });
  const projected = projectOptimisticPrompt({
    state: active,
    initialPrompt: null,
    runId: "run-2",
    durableItems: [],
    streamingItems: [],
    runIsLive: false,
  });

  assert.equal(projected.pendingContinuationItem, null);
  assert.equal(projected.turnIsActive, false);
});
