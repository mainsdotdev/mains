import assert from "node:assert/strict";
import test from "node:test";

import { asyncQuestionMessageId } from "@mains/contracts/async-questions";
import { pendingAsyncQuestions } from "../src/lib/async-questions.ts";

const questionArtifact = (id, metadata = {}) => ({
  id,
  kind: "report",
  metadataJson: JSON.stringify({
    source: "codex_async_questions",
    questions: [
      { title: "Which database?", options: ["SQLite", "Postgres"] },
      { title: "Anything else?", options: null },
    ],
    ...metadata,
  }),
});
const prompt = (id, metadata = {}) => ({ id, kind: "user-prompt", metadataJson: JSON.stringify(metadata) });
const answerPrompt = (id, artifactId) => prompt(id, {
  clientUserMessageId: asyncQuestionMessageId(artifactId),
  asyncQuestionReply: { artifactId, answers: ["SQLite", "No"] },
});

test("offers the newest unanswered questions with their options", () => {
  assert.deepEqual(pendingAsyncQuestions([questionArtifact(7), prompt(3)]), {
    artifactId: 7,
    questions: [
      { title: "Which database?", options: ["SQLite", "Postgres"] },
      { title: "Anything else?", options: null },
    ],
  });
});

test("an ordinary message after the questions moves the conversation on", () => {
  assert.equal(pendingAsyncQuestions([prompt(9, { source: "user" }), questionArtifact(7)]), null);
});

test("the prompt that answers earlier questions does not supersede them", () => {
  const pending = pendingAsyncQuestions([questionArtifact(12), answerPrompt(10, 7), questionArtifact(7)]);
  assert.equal(pending?.artifactId, 12);
});

test("answered, dismissed and superseded questions are not offered", () => {
  const answered = questionArtifact(7, {
    asyncQuestionAnswer: { artifactId: 7, answers: ["SQLite", "No"], clientUserMessageId: asyncQuestionMessageId(7) },
  });
  assert.equal(pendingAsyncQuestions([answered]), null);
  assert.equal(pendingAsyncQuestions([questionArtifact(7, { asyncQuestionState: { dismissed: true } })]), null);
  assert.equal(pendingAsyncQuestions([questionArtifact(7, { asyncQuestionState: { supersededBy: 9 } })]), null);
});

test("a subagent's questions are its parent's business, not the user's", () => {
  assert.equal(pendingAsyncQuestions([questionArtifact(7, { isFromSubagent: true })]), null);
});

test("an older question stays open when the newer one was answered without a new message", () => {
  const answered = questionArtifact(12, {
    asyncQuestionAnswer: { artifactId: 12, answers: ["SQLite", "No"], clientUserMessageId: asyncQuestionMessageId(12) },
  });
  assert.equal(pendingAsyncQuestions([answered, questionArtifact(7)])?.artifactId, 7);
});
