// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ContextUsageListener = (data: { runId: string; event: Record<string, unknown> }) => void;

const listeners: ContextUsageListener[] = [];

vi.mock("@/lib/transport", () => ({
  appEvents: {
    runs: {
      onContextUsage: (callback: ContextUsageListener) => {
        listeners.push(callback);
        return () => {
          const index = listeners.indexOf(callback);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
    },
  },
}));

import { useContextUsage } from "./use-context-usage";

function push(runId: string, event: Record<string, unknown>): void {
  act(() => {
    for (const listener of [...listeners]) listener({ runId, event });
  });
}

function snapshot(categories: unknown[]): Record<string, unknown> {
  return {
    type: "context_usage",
    totalTokens: 1_000,
    maxTokens: 10_000,
    percentage: 10,
    model: "claude-opus-4-8",
    categories,
    ts: 1,
  };
}

beforeEach(() => {
  listeners.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useContextUsage", () => {
  it("holds a category's slot as the run grows", () => {
    // The slot is the category's color. Deriving it from position or size would
    // repaint every other row whenever one overtook another mid-run.
    const { result } = renderHook(() => useContextUsage("run-1"));

    push(
      "run-1",
      snapshot([
        { name: "System prompt", tokens: 500, kind: "used" },
        { name: "MCP tools", tokens: 500, kind: "used" },
      ]),
    );
    expect(result.current?.categories?.map((c) => [c.name, c.slot])).toEqual([
      ["System prompt", 0],
      ["MCP tools", 1],
    ]);

    // Next turn: order flipped, sizes diverged, a new category appeared.
    push(
      "run-1",
      snapshot([
        { name: "MCP tools", tokens: 9_000, kind: "used" },
        { name: "Messages", tokens: 40, kind: "used" },
        { name: "System prompt", tokens: 500, kind: "used" },
      ]),
    );
    expect(result.current?.categories?.map((c) => [c.name, c.slot])).toEqual([
      ["MCP tools", 1],
      ["Messages", 2],
      ["System prompt", 0],
    ]);
  });

  it("gives empty space no slot", () => {
    const { result } = renderHook(() => useContextUsage("run-1"));

    push(
      "run-1",
      snapshot([
        { name: "Messages", tokens: 500, kind: "used" },
        { name: "Free", tokens: 9_500, kind: "free" },
        { name: "Buffer", tokens: 100, kind: "buffer" },
        { name: "Deferred", tokens: 100, kind: "deferred" },
      ]),
    );

    expect(result.current?.categories?.map((c) => c.slot)).toEqual([0, -1, -1, -1]);
  });

  it("starts slots over for a different run", () => {
    // Otherwise the second run inherits the first run's vocabulary and its
    // first category comes up in some later slot's color.
    const { result, rerender } = renderHook(({ runId }) => useContextUsage(runId), {
      initialProps: { runId: "run-1" },
    });

    push("run-1", snapshot([{ name: "System prompt", tokens: 500, kind: "used" }]));
    expect(result.current?.categories?.[0].slot).toBe(0);

    rerender({ runId: "run-2" });
    push("run-2", snapshot([{ name: "Messages", tokens: 500, kind: "used" }]));
    expect(result.current?.categories?.[0]).toMatchObject({ name: "Messages", slot: 0 });
  });

  it("ignores snapshots from another run", () => {
    const { result } = renderHook(() => useContextUsage("run-1"));

    push("run-2", snapshot([{ name: "Messages", tokens: 500, kind: "used" }]));

    expect(result.current).toBeNull();
  });
});
