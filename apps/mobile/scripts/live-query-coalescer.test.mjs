import assert from "node:assert/strict";
import test from "node:test";

import { createChangeRefreshCoalescer } from "../src/db/change-refresh-coalescer.ts";

function createManualScheduler() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();

  const schedule = (callback, delayMs) => {
    const id = nextId++;
    tasks.set(id, { at: now + delayMs, callback });
    return () => tasks.delete(id);
  };

  const advanceBy = (durationMs) => {
    const end = now + durationMs;
    while (true) {
      const next = [...tasks.entries()]
        .filter(([, task]) => task.at <= end)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!next) break;
      const [id, task] = next;
      tasks.delete(id);
      now = task.at;
      task.callback();
    }
    now = end;
  };

  return { advanceBy, schedule };
}

test("a bulk sync refreshes a live query once after the row-change burst settles", () => {
  const scheduler = createManualScheduler();
  let refreshCount = 0;
  const coalescer = createChangeRefreshCoalescer(() => refreshCount++, {
    schedule: scheduler.schedule,
    settleMs: 32,
    maxWaitMs: 250,
  });

  for (let row = 0; row < 70; row++) coalescer.request();

  scheduler.advanceBy(31);
  assert.equal(refreshCount, 0);
  scheduler.advanceBy(1);
  assert.equal(refreshCount, 1);
});

test("continuous changes cannot postpone a refresh forever", () => {
  const scheduler = createManualScheduler();
  let refreshCount = 0;
  const coalescer = createChangeRefreshCoalescer(() => refreshCount++, {
    schedule: scheduler.schedule,
    settleMs: 32,
    maxWaitMs: 250,
  });

  for (let elapsed = 0; elapsed < 250; elapsed += 20) {
    coalescer.request();
    scheduler.advanceBy(20);
  }

  assert.equal(refreshCount, 1);
});

test("disposing cancels a pending refresh", () => {
  const scheduler = createManualScheduler();
  let refreshCount = 0;
  const coalescer = createChangeRefreshCoalescer(() => refreshCount++, {
    schedule: scheduler.schedule,
  });

  coalescer.request();
  coalescer.dispose();
  scheduler.advanceBy(1_000);

  assert.equal(refreshCount, 0);
});
