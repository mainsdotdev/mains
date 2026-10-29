import type { RunHistoryContentPage, RunTurnChangesSummary } from "@mains/contracts/runs";

import { demoPromptAttachment } from "./demo-outputs";

export const DEMO_REVIEW_RUN_ID = "demo-review-files";
export const DEMO_REVIEW_TURN_ID = 900_001;
export const DEMO_REVIEW_TITLE = "Review demo files";

/** A small stored patch exercises the same reader and numbered diff UI as a paired backend. */
const patch = [
  "diff --git a/src/greeting.ts b/src/greeting.ts",
  "--- a/src/greeting.ts",
  "+++ b/src/greeting.ts",
  "@@ -1,3 +1,3 @@",
  " export function greeting(name: string): string {",
  "-  return `Hello ${name}`;",
  "+  return `Hello, ${name}!`;",
  " }",
  "diff --git a/README.md b/README.md",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/README.md",
  "@@ -0,0 +1,3 @@",
  "+# Demo workspace",
  "+",
  "+These changes are bundled sample data. No real files were edited.",
  "",
].join("\n");

export function readDemoTurnDiff(runId: string, turnId: number, offset = 0): RunHistoryContentPage {
  if (runId !== DEMO_REVIEW_RUN_ID || turnId !== DEMO_REVIEW_TURN_ID) {
    throw new Error("This demo conversation has no stored turn diff. Open “Review demo files” to try the diff viewer.");
  }
  const characters = Array.from(patch);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > characters.length) {
    throw new Error("Invalid demo diff offset");
  }
  const next = Math.min(offset + 8192, characters.length);
  return { text: characters.slice(offset, next).join(""), offset,
    nextOffset: next < characters.length ? next : null, totalChars: characters.length };
}

export function createDemoReview<T extends { id: string; model?: unknown }>(template: T, timestamp = new Date().toISOString()) {
  const startedAt = new Date(new Date(timestamp).getTime() - 1000).toISOString();
  const prompt = "Improve the sample greeting and add a short README.";
  const response = "Updated the sample greeting and added a README. Tap either file under **Edited 2 files** to inspect its diff. Open **Outputs** to preview the bundled PDF and Markdown documents, or tap the PDF attached to the prompt. These are simulated changes; no real files were edited.";
  const changes: RunTurnChangesSummary = {
    id: "demo-review-changes", fileCount: 2, additions: 4, deletions: 1, truncated: false, undoneAt: null,
    files: [
      { path: "src/greeting.ts", status: "modified", additions: 1, deletions: 1, binary: false },
      { path: "README.md", status: "added", additions: 3, deletions: 0, binary: false },
    ],
  };
  return {
    run: { ...template, id: DEMO_REVIEW_RUN_ID, title: DEMO_REVIEW_TITLE, goal: prompt,
      status: "succeeded", isArchived: false, lastError: null, stopReason: null,
      startedAt, endedAt: timestamp, createdAt: startedAt, updatedAt: timestamp },
    turns: [{ id: DEMO_REVIEW_TURN_ID, runId: DEMO_REVIEW_RUN_ID, turnIndex: 0,
      promptContent: prompt, responseContent: response, startedAt, endedAt: timestamp,
      elapsedMs: 1000, status: "completed", model: typeof template.model === "string" ? template.model : null,
      metadata: null, changes, createdAt: startedAt }],
    artifacts: [
      { id: 900_002, runId: DEMO_REVIEW_RUN_ID, kind: "user-prompt", path: null, content: prompt,
        metadata: { source: "user", turnId: DEMO_REVIEW_TURN_ID, attachments: [demoPromptAttachment()] }, createdAt: startedAt },
      { id: 900_003, runId: DEMO_REVIEW_RUN_ID, kind: "report", path: null, content: response,
        metadata: { source: "agent_message", turnId: DEMO_REVIEW_TURN_ID }, createdAt: timestamp },
    ],
  };
}
