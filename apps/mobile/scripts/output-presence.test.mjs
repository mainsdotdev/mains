import assert from "node:assert/strict";
import test from "node:test";
import { hasRunOutputs } from "../src/features/runs/lib/output-presence.ts";

test("an empty output list hides the action", async () => {
  assert.equal(await hasRunOutputs(async () => ({ items: [], nextOffset: null })), false);
});

test("one available output is enough and later pages are not fetched", async () => {
  const offsets = [];
  assert.equal(await hasRunOutputs(async (offset) => {
    offsets.push(offset);
    return { items: [{ artifactId: 1 }], nextOffset: 100 };
  }), true);
  assert.deepEqual(offsets, [0]);
});

test("empty pages caused by unavailable files do not hide a later available output", async () => {
  const offsets = [];
  assert.equal(await hasRunOutputs(async (offset) => {
    offsets.push(offset);
    return offset === 0 ? { items: [], nextOffset: 100 } : { items: [{ artifactId: 2 }], nextOffset: null };
  }), true);
  assert.deepEqual(offsets, [0, 100]);
});

test("leaving a conversation or changing backend abandons the old result and further reads", async () => {
  let active = true, reads = 0;
  assert.equal(await hasRunOutputs(async () => {
    reads++; active = false;
    return { items: [{ artifactId: 1 }], nextOffset: 100 };
  }, () => active), false);
  assert.equal(reads, 1);
});

test("a broken page cursor fails instead of repeatedly checking the same empty page", async () => {
  await assert.rejects(hasRunOutputs(async () => ({ items: [], nextOffset: 0 })), /Invalid output page/);
});
