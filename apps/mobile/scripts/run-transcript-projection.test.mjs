import assert from "node:assert/strict";
import test from "node:test";

import { projectStreamingTranscript } from "../src/features/runs/lib/run-transcript-projection.ts";

test("durable response text replaces its transient streaming twin", () => {
  const durable = [
    { key: "prompt-1", kind: "prompt", text: "Go", at: 1, skills: [], files: [], images: [] },
    { key: "response-1", kind: "response", text: "Finished.  ", at: 2 },
  ];
  const streaming = [
    { key: "stream-1", streamId: "1", text: " Finished.", at: 2 },
    { key: "stream-2", streamId: "2", text: "Still working", at: 3 },
  ];

  const projected = projectStreamingTranscript(durable, streaming);

  assert.deepEqual([...projected.persistedResponseContents], ["Finished."]);
  assert.deepEqual(projected.streamingItems, [
    { key: "stream-2", kind: "response", text: "Still working", at: 3 },
  ]);
});

test("transient response metadata keeps its stable wire identity", () => {
  const projected = projectStreamingTranscript([], [
    { key: "stream-answer", streamId: "answer", text: "Partial", at: 42 },
  ]);

  assert.deepEqual(projected.streamingItems, [
    { key: "stream-answer", kind: "response", text: "Partial", at: 42 },
  ]);
});
