import assert from "node:assert/strict";
import test from "node:test";
import { forgetHistory, historyState, historyRequest, historyLoaded, historyLoading, setHistoryFollowing } from "../src/backend/run-history.ts";

const cursor = (id) => ({ timestamp: id * 1000, source: "artifact", id });
const page = (start, end = null) => ({ artifacts: [], toolCalls: [], turns: [], start: cursor(start), end: end == null ? null : cursor(end), last: cursor(100), hasOlder: start > 0, hasNewer: end != null });

test("mobile opens on latest and refreshes the selected bounds", () => {
  forgetHistory("b", "r");
  assert.deepEqual(historyRequest("b", "r", "refresh"), { runId: "r", direction: "latest" });
  historyLoaded("b", "r", page(90));
  assert.deepEqual(historyRequest("b", "r", "older"), { runId: "r", direction: "older", cursor: cursor(90) });
  historyLoaded("b", "r", page(60, 90));
  assert.deepEqual(historyRequest("b", "r", "refresh"), { runId: "r", direction: "refresh", cursor: cursor(60), end: cursor(90) });
  assert.deepEqual(historyRequest("b", "r", "newer"), { runId: "r", direction: "newer", cursor: cursor(90) });
});

test("reading freezes the tail while the complete backend advances", () => {
  forgetHistory("b", "r");
  historyLoaded("b", "r", page(90));
  setHistoryFollowing("b", "r", false);
  const frozen = historyState("b", "r").end;
  assert.deepEqual(frozen, { timestamp: 100000, source: "artifact", id: 101 });
  historyLoaded("b", "r", { ...page(90), end: frozen, last: cursor(200), hasNewer: true });
  assert.deepEqual(historyRequest("b", "r", "refresh").end, frozen);
  setHistoryFollowing("b", "r", true);
  historyLoaded("b", "r", page(190));
  assert.equal(historyState("b", "r").end, null);
});

test("backend identity isolates windows and errors preserve cached bounds", () => {
  forgetHistory("first", "r"); forgetHistory("second", "r");
  historyLoaded("first", "r", page(10, 40));
  historyLoaded("second", "r", page(90));
  historyLoading("first", "r", false, "offline");
  assert.equal(historyState("first", "r").error, "offline");
  assert.deepEqual(historyState("first", "r").start, cursor(10));
  assert.equal(historyState("second", "r").end, null);
});

test("retained navigation metadata has a four-run LRU bound", () => {
  for (let i = 0; i < 5; i++) historyLoaded("lru", `r${i}`, page(90));
  assert.equal(historyState("lru", "r0").loaded, false);
  for (let i = 1; i < 5; i++) assert.equal(historyState("lru", `r${i}`).loaded, true);
});
