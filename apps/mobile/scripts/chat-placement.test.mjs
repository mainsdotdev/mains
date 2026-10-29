import assert from "node:assert/strict";
import test from "node:test";

import { placeChats } from "../src/lib/chat-placement.ts";

const chat = (id, collectionId, isReplica = false) => ({ id, collectionId, isReplica });
const ids = (list) => list.map((run) => run.id);

test("files each chat under its listed project, the rest under Recents, in order", () => {
  const { standalone, byCollection } = placeChats(
    [chat("a", "work"), chat("b", null), chat("c", "work"), chat("d", "home")],
    new Set(["work", "home"]),
  );
  assert.deepEqual(ids(standalone), ["b"]);
  assert.deepEqual(ids(byCollection.get("work")), ["a", "c"]);
  assert.deepEqual(ids(byCollection.get("home")), ["d"]);
});

test("another computer's chat in a project this backend does not list falls back to Recents", () => {
  const { standalone, byCollection } = placeChats(
    [chat("replica", "theirs", true), chat("shared", "work", true)],
    new Set(["work"]),
  );
  assert.deepEqual(ids(standalone), ["replica"]);
  assert.deepEqual(ids(byCollection.get("work")), ["shared"]);
  assert.equal(byCollection.has("theirs"), false);
});

test("this computer's chat keeps its project even when that project is not listed", () => {
  // The desktop hides a local chat whose project is archived rather than
  // promoting it to Recents; only replicas are rescued.
  const { standalone, byCollection } = placeChats([chat("local", "archived")], new Set());
  assert.deepEqual(standalone, []);
  assert.deepEqual(ids(byCollection.get("archived")), ["local"]);
});
