import assert from "node:assert/strict";
import test from "node:test";

import { projectedPromptLandingY } from "../src/lib/prompt-flight.ts";

test("projects a prompt measured before scrolling onto the final landing point", () => {
  assert.equal(
    projectedPromptLandingY({
      measuredWindowY: 900,
      rootWindowY: 0,
      currentScrollOffset: 520,
      finalScrollOffset: 600,
      reservedTop: 120,
    }),
    820,
  );
});

test("keeps the projected target fixed midway through the same scroll", () => {
  assert.equal(
    projectedPromptLandingY({
      measuredWindowY: 860,
      rootWindowY: 0,
      currentScrollOffset: 560,
      finalScrollOffset: 600,
      reservedTop: 120,
    }),
    820,
  );
});

test("never lets an initial prompt land beneath the transparent toolbar", () => {
  assert.equal(
    projectedPromptLandingY({
      measuredWindowY: 68,
      rootWindowY: 0,
      currentScrollOffset: null,
      finalScrollOffset: -59,
      reservedTop: 129,
    }),
    129,
  );
});
