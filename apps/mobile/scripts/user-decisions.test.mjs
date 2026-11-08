import assert from "node:assert/strict";
import test from "node:test";
import { createDecisionOwner } from "@mains/contracts/decision-owner";

test("duplicate presses admit one decision before a render can disable the controls", () => {
  const owner = createDecisionOwner(); owner.attach();
  const first = owner.begin(); assert.ok(first); assert.equal(owner.begin(), undefined);
  first.finish(); assert.ok(owner.begin());
});
test("a backend switch during consent cannot deliver an answer after returning to the old backend", async () => {
  let backend = "A", release;
  const consent = new Promise((resolve) => { release = resolve; });
  const owner = createDecisionOwner(() => backend === "A"); owner.attach();
  const lease = owner.begin(); let sends = 0;
  const send = (async () => { await consent; lease.assertCurrent(); sends++; })();
  backend = "B"; owner.retire(); backend = "A"; release();
  await assert.rejects(send, /changed/); assert.equal(sends, 0);
});
test("old effect cleanup and completion cannot unlock a replacement decision", () => {
  const owner = createDecisionOwner(); owner.attach(); const first = owner.begin();
  owner.detach(); owner.attach(); const next = owner.begin();
  first.finish(); assert.equal(first.current(), false); assert.equal(next.current(), true); assert.equal(owner.begin(), undefined);
});
