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

test("identical text in an older message cannot acknowledge a different live stream", () => {
  const projected = projectStreamingTranscript([
    { key: "response-old", kind: "response", text: "Done", at: 1, streamId: "old-message" },
  ], [{ key: "stream-new", streamId: "new-message", text: "Done", at: 20 }]);
  assert.equal(projected.streamingItems.length, 1);
  assert.deepEqual([...projected.persistedStreamIds], ["old-message"]);
});
