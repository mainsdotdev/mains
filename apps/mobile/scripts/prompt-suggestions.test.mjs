import assert from "node:assert/strict";
import test from "node:test";

import { latestPromptSuggestions } from "../src/lib/prompt-suggestions.ts";

const artifact = (kind, content = "", metadata = null) => ({
  kind,
  content,
  metadataJson: metadata ? JSON.stringify(metadata) : null,
});

test("offers the newest run of follow-ups, oldest first, with their short labels", () => {
  const newestFirst = [
    artifact("prompt_suggestion", "Write the tests next", { label: "Add tests" }),
    artifact("prompt_suggestion", "Explain the change"),
    artifact("report", "Done."),
    artifact("user-prompt", "Fix the bug"),
  ];
  assert.deepEqual(latestPromptSuggestions(newestFirst), [
    { prompt: "Explain the change" },
    { prompt: "Write the tests next", label: "Add tests" },
  ]);
});

test("later assistant output does not consume an offer", () => {
  const newestFirst = [
    artifact("report", "One more thing."),
    artifact("prompt_suggestion", "Ship it"),
    artifact("report", "Done."),
  ];
  assert.deepEqual(latestPromptSuggestions(newestFirst), [{ prompt: "Ship it" }]);
});

test("the user's next message consumes the offer before it", () => {
  const newestFirst = [
    artifact("report", "Shipping."),
    artifact("user-prompt", "Ship it"),
    artifact("prompt_suggestion", "Ship it"),
  ];
  assert.deepEqual(latestPromptSuggestions(newestFirst), []);
});

test("only the newest unbroken run is offered, and blank offers are skipped", () => {
  const newestFirst = [
    artifact("prompt_suggestion", "Newest"),
    artifact("prompt_suggestion", "   "),
    artifact("report", "Second answer"),
    artifact("prompt_suggestion", "Older offer"),
  ];
  assert.deepEqual(latestPromptSuggestions(newestFirst), [{ prompt: "Newest" }]);
});

test("unreadable metadata keeps the offer without a label", () => {
  const newestFirst = [{ kind: "prompt_suggestion", content: "Keep going", metadataJson: "{not json" }];
  assert.deepEqual(latestPromptSuggestions(newestFirst), [{ prompt: "Keep going" }]);
});
