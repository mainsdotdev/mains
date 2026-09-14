import assert from "node:assert/strict";
import test from "node:test";

import { parseStoredEffortLevels } from "./demo-snapshot-utils.mjs";

test("reads a JSON-encoded effort-level list", () => {
  assert.deepEqual(parseStoredEffortLevels('["low","medium","high"]'), [
    "low",
    "medium",
    "high",
  ]);
});

test("repairs effort levels repeatedly encoded by the old exporter", () => {
  const expected = ["low", "medium", "high", "xhigh", "max"];
  let stored = JSON.stringify(expected);

  for (let pass = 0; pass < 7; pass += 1) {
    const oldExport = stored.split(",").filter(Boolean);
    stored = JSON.stringify(oldExport);
  }

  assert.deepEqual(parseStoredEffortLevels(stored), expected);
});

test("rejects malformed effort-level storage instead of exporting garbage", () => {
  assert.throws(() => parseStoredEffortLevels('["low",'), /Invalid effort-level list/);
});
