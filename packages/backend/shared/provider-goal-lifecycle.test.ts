import { describe, expect, it } from "vitest";
import { mapProviderGoal, mayEstablishProviderGoal } from "./provider-goal-lifecycle";

const goal = { threadId: "thread-1", objective: "A provider objective", status: "active" };

describe("provider goal facts", () => {
  it("preserves future provider states while discarding invalid usage values", () => {
    expect(mapProviderGoal({ ...goal, status: "futureState", tokenBudget: null, tokensUsed: NaN, timeUsedSeconds: Infinity, updatedAt: 12 }))
      .toEqual({ ...goal, status: "futureState", tokenBudget: undefined, tokensUsed: undefined, timeUsedSeconds: undefined, createdAt: undefined, updatedAt: 12 });
  });
  it("does not apply malformed or differently owned snapshots", () => {
    for (const raw of [undefined, {}, { ...goal, status: null }, { ...goal, threadId: "other-thread" }]) {
      expect(mapProviderGoal(raw, "thread-1")).toBeNull();
    }
  });
  it("distinguishes verified absence/completion from missing or malformed read results", () => {
    for (const response of [undefined, {}, { goal: undefined }, { goal: {} }, { goal }, { goal: { ...goal, status: "futureState" } }, { goal: { ...goal, threadId: "other-thread", status: "complete" } }]) {
      expect(mayEstablishProviderGoal(response, "thread-1")).toBe(false);
    }
    expect(mayEstablishProviderGoal({ goal: null }, "thread-1")).toBe(true);
    expect(mayEstablishProviderGoal({ goal: { ...goal, status: "complete" } }, "thread-1")).toBe(true);
  });
});
