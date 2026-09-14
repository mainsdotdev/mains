import { describe, expect, it } from "vitest";
import { buildContextBreakdown } from "./context-usage-meter";
import type { ContextUsageCategory } from "../hooks/use-context-usage";

function used(name: string, tokens: number, slot: number): ContextUsageCategory {
  return { name, tokens, kind: "used", slot };
}

describe("buildContextBreakdown", () => {
  it("returns nothing when the provider sends no partition", () => {
    // Codex/Copilot and older Claude CLIs report totals only; the meter falls
    // back to its plain used/remaining rows rather than an empty legend.
    expect(buildContextBreakdown(undefined)).toEqual([]);
    expect(buildContextBreakdown([])).toEqual([]);
  });

  it("colors identity rows by slot and trails them with empty space", () => {
    const rows = buildContextBreakdown([
      { name: "Free", tokens: 150_000, kind: "free", slot: -1 },
      used("System prompt", 30_000, 0),
      { name: "Autocompact", tokens: 15_000, kind: "buffer", slot: -1 },
      used("MCP tools", 5_000, 1),
    ]);

    expect(rows.map((row) => row.label)).toEqual([
      "System prompt",
      "MCP tools",
      "Compaction buffer",
      "Free",
    ]);
    expect(rows[0].color).toBe("var(--viz-cat-1)");
    expect(rows[1].color).toBe("var(--viz-cat-2)");
    // Empty space is not an identity — it wears a surface tone, never a hue.
    expect(rows[2].color).toBeUndefined();
    expect(rows[3].color).toBeUndefined();
  });

  it("orders identity rows by slot, not by size", () => {
    // Ordering by tokens would reshuffle the legend (and the bar) every time one
    // category overtook another, so a reader could never track a single row.
    const rows = buildContextBreakdown([
      used("Messages", 90_000, 2),
      used("System prompt", 1_000, 0),
      used("MCP tools", 40_000, 1),
    ]);

    expect(rows.map((row) => row.label)).toEqual([
      "System prompt",
      "MCP tools",
      "Messages",
    ]);
  });

  it("folds categories past the last slot into one neutral row", () => {
    // A sixth generated hue would be indistinguishable from an existing slot
    // under colorblind simulation, so the tail collapses instead.
    const rows = buildContextBreakdown([
      used("a", 10, 0),
      used("b", 10, 1),
      used("c", 10, 2),
      used("d", 10, 3),
      used("e", 10, 4),
      used("f", 7, 5),
      used("g", 3, 6),
    ]);

    expect(rows).toHaveLength(6);
    const other = rows[5];
    expect(other.label).toBe("Other");
    expect(other.tokens).toBe(10);
    expect(other.color).toBeUndefined();
  });

  it("drops deferred rows", () => {
    // The provider excludes them from the usage math (out-of-window tool
    // schemas), so putting them in a bar that represents the window would
    // overstate what is occupying it.
    const rows = buildContextBreakdown([
      used("Messages", 100, 0),
      { name: "Deferred tools", tokens: 900, kind: "deferred", slot: -1 },
    ]);

    expect(rows.map((row) => row.label)).toEqual(["Messages"]);
  });

  it("drops empty rows so they cannot render as a minimum-width sliver", () => {
    const rows = buildContextBreakdown([
      used("Messages", 100, 0),
      used("Skills", 0, 1),
      { name: "Free", tokens: 0, kind: "free", slot: -1 },
    ]);

    expect(rows.map((row) => row.label)).toEqual(["Messages"]);
  });

  it("returns nothing when only empty space is reported", () => {
    // A bar of pure track carries no information the ring does not already show.
    expect(
      buildContextBreakdown([{ name: "Free", tokens: 200_000, kind: "free", slot: -1 }]),
    ).toEqual([]);
  });

  it("sums repeated kinds rather than listing them twice", () => {
    const rows = buildContextBreakdown([
      used("Messages", 100, 0),
      { name: "Free (a)", tokens: 10, kind: "free", slot: -1 },
      { name: "Free (b)", tokens: 15, kind: "free", slot: -1 },
    ]);

    expect(rows[1]).toMatchObject({ label: "Free", tokens: 25 });
  });
});
