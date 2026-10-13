import assert from "node:assert/strict";
import test from "node:test";
import { createProjectionChanges } from "../src/db/projection-changes.ts";

test("a large projection transaction notifies readers once after commit", () => {
  const changes = createProjectionChanges();
  const notifications = [];
  changes.subscribe((tables) => notifications.push([...tables].sort()));
  changes.batch(() => {
    for (let i = 0; i < 100_000; i++) changes.mark("tool_calls");
    changes.mark("run_artifacts");
    assert.equal(notifications.length, 0);
  });
  assert.deepEqual(notifications, [["run_artifacts", "tool_calls"]]);
});

test("a rolled-back batch does not refresh readers or break the next commit", () => {
  const changes = createProjectionChanges();
  const notifications = [];
  changes.subscribe((tables) => notifications.push([...tables]));
  assert.throws(() => changes.batch(() => { changes.mark("runs"); throw new Error("rollback"); }));
  assert.equal(notifications.length, 0);
  changes.batch(() => changes.mark("models"));
  assert.deepEqual(notifications, [["models"]]);
});

test("nested batches preserve earlier changes and unsubscribe stops observation", () => {
  const changes = createProjectionChanges();
  const notifications = [];
  const off = changes.subscribe((tables) => notifications.push([...tables]));
  changes.batch(() => {
    changes.mark("runs");
    assert.throws(() => changes.batch(() => { changes.mark("tools"); throw new Error("rollback"); }));
    changes.batch(() => changes.mark("models"));
  });
  assert.deepEqual(notifications, [["runs", "models"]]);
  off(); changes.mark("runs");
  assert.equal(notifications.length, 1);
});
