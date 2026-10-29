import assert from "node:assert/strict";
import test from "node:test";

import { confirmDeletedRuns } from "../src/backend/output-retention.ts";

test("only a run the Mac reports missing loses its downloaded files", async () => {
  const replies = {
    deleted: null,
    archived: { id: "archived", isArchived: true },
    agedOut: { id: "agedOut", isArchived: false },
  };
  const deleted = await confirmDeletedRuns(["deleted", "archived", "agedOut", "offline"], async (runId) => {
    if (runId === "offline") throw new Error("WebSocket connection closed");
    return replies[runId];
  });
  assert.deepEqual(deleted, ["deleted"]);
});

test("no candidates means no lookups", async () => {
  let calls = 0;
  assert.deepEqual(await confirmDeletedRuns([], async () => { calls++; return null; }), []);
  assert.equal(calls, 0);
});
