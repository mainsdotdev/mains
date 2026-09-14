import { describe, expect, it } from "vitest";
import type { RunEvent } from "../types";
import {
  hasOutstandingWork,
  parseStructuralPlanSnapshot,
  selectTodoSnapshot,
} from "./todo-summary-bar";

describe("TodoSummaryBar structural plans", () => {
  it("prefers the persisted structural plan over legacy tool snapshots", () => {
    const events: RunEvent[] = [{
      id: "event-1",
      type: "tool_call",
      content: "UpdateTodos",
      timestamp: new Date(1),
      metadata: {
        input: {
          todos: [{
            content: "Stale tool task",
            status: "in_progress",
          }],
        },
      },
    }];
    const structuralPlan = parseStructuralPlanSnapshot({
      providerTurnId: "turn-1",
      explanation: "Executing",
      steps: [
        { step: "Inspect", status: "completed" },
        { step: "Implement", status: "in_progress" },
        { step: "Verify", status: "pending" },
      ],
      updatedAt: 123,
    });

    expect(structuralPlan).not.toBeNull();
    expect(selectTodoSnapshot(events, structuralPlan)).toEqual([
      { content: "Inspect", status: "completed" },
      { content: "Implement", status: "in_progress" },
      { content: "Verify", status: "pending" },
    ]);
  });
});

describe("TodoSummaryBar visibility", () => {
  it("hides once every step is completed", () => {
    // The bar floats over the transcript; a finished list would cover the text
    // the reader is on to say nothing they can act on.
    expect(
      hasOutstandingWork([
        { content: "Port the commit", status: "completed" },
        { content: "Wire the descriptor", status: "completed" },
      ]),
    ).toBe(false);
  });

  it("shows while a step is in progress", () => {
    expect(
      hasOutstandingWork([
        { content: "Port the commit", status: "completed" },
        { content: "Wire the descriptor", status: "in_progress" },
      ]),
    ).toBe(true);
  });

  it("shows while a step is still pending", () => {
    // A plan that has not started yet is exactly what the bar is for.
    expect(
      hasOutstandingWork([
        { content: "Port the commit", status: "completed" },
        { content: "Chat sidebar", status: "pending" },
      ]),
    ).toBe(true);
  });

  it("hides when there is no plan at all", () => {
    expect(hasOutstandingWork(null)).toBe(false);
    expect(hasOutstandingWork([])).toBe(false);
  });
});
