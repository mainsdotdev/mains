import assert from "node:assert/strict";
import test from "node:test";

import { dismissKeyboardAndWait } from "../src/lib/keyboard-transition.ts";

test("waits for the keyboard to finish hiding before camera work continues", async () => {
  let visible = true;
  let didHide = null;
  let removed = false;
  const keyboard = {
    isVisible: () => visible,
    dismiss: () => {},
    addListener: (event, listener) => {
      assert.equal(event, "keyboardDidHide");
      didHide = listener;
      return { remove: () => (removed = true) };
    },
  };

  let continued = false;
  const transition = dismissKeyboardAndWait(keyboard).then(() => {
    continued = true;
  });

  await Promise.resolve();
  assert.equal(continued, false);
  assert.equal(removed, false);

  visible = false;
  didHide();
  await transition;

  assert.equal(continued, true);
  assert.equal(removed, true);
});

test("continues immediately when the keyboard is already hidden", async () => {
  let dismissCount = 0;
  const keyboard = {
    isVisible: () => false,
    dismiss: () => dismissCount++,
    addListener: () => {
      throw new Error("hidden keyboards need no listener");
    },
  };

  await dismissKeyboardAndWait(keyboard);
  assert.equal(dismissCount, 1);
});
