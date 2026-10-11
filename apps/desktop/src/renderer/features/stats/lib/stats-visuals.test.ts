import { describe, expect, it } from "vitest";
import type { TokenUsageBucket } from "@mains/contracts/stats";
import { calendarCells, tokenIntensity } from "./token-activity";
import { trendSegments } from "./consumption-trend";

const day = (date: string, tokens: number | null, turns = 1): TokenUsageBucket => ({
  date, totalTokens: tokens, inputTokens: tokens, outputTokens: tokens === null ? null : 0,
  completedTurns: turns, tokenReportedTurns: tokens === null ? 0 : turns,
  cacheReadTokens: null, cacheWriteTokens: null, estimatedCostUsd: null, durationMs: null, costReportedTurns: 0,
});

describe("usage visualizations", () => {
  it("aligns Sunday and the next Monday into different calendar weeks without inventing outside-range days", () => {
    const days = [day("2026-10-11", 10), day("2026-10-12", 20)];
    const cells = calendarCells(days);
    expect(cells).toHaveLength(14);
    expect(cells[6]).toBe(days[0]);
    expect(cells[7]).toBe(days[1]);
    expect(cells.filter(Boolean)).toEqual(days);
    expect(calendarCells([])).toEqual([]);
  });
  it("keeps leap day on its real weekday", () => {
    const cells = calendarCells([day("2024-02-28", 10), day("2024-02-29", 20), day("2024-03-01", 30)]);
    expect(cells[3]?.date).toBe("2024-02-29");
    expect(cells[4]?.date).toBe("2024-03-01");
  });
  it("distinguishes unreported usage, real zero and days without turns", () => {
    expect(tokenIntensity(day("2026-10-11", null), 100)).toBeNull();
    expect(tokenIntensity(day("2026-10-11", 0), 100)).toBe(0);
    expect(tokenIntensity(day("2026-10-11", null, 0), 100)).toBe(0);
    expect(tokenIntensity(day("2026-10-11", 1), 100)).toBeGreaterThan(0);
    expect(tokenIntensity(day("2026-10-11", 100), 100)).toBe(4);
  });
  it("breaks trend lines across missing estimates instead of drawing through zero", () => {
    const segments = trendSegments([0, 10, null, 20, 0], 20);
    expect(segments.map((segment) => segment.length)).toEqual([2, 2]);
    expect(segments[0][0]).toEqual({ x: 100, y: 240 });
    expect(segments[1][0]).toEqual({ x: 700, y: 0 });
    expect(segments[1][1]).toEqual({ x: 900, y: 240 });
  });
  it("keeps an isolated real zero while leaving entirely unknown trends empty", () => {
    expect(trendSegments([null], 1)).toEqual([]);
    expect(trendSegments([0], 1)).toEqual([[{ x: 500, y: 240 }]]);
  });

  it("handles large calendar arrays without overflowing the JavaScript argument stack", () => {
    const days = Array.from({ length: 150_000 }, () => day("2026-10-11", 1));
    const cells = calendarCells(days);
    expect(cells.filter(Boolean)).toHaveLength(days.length);
  });

  it("does not emit NaN or infinite coordinates for invalid usage or chart scales", () => {
    const segments = trendSegments([10, NaN, Infinity, -1, 20], NaN);
    expect(segments.map((segment) => segment.length)).toEqual([1, 1]);
    expect(segments.flat().every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expect(tokenIntensity(day("2026-10-11", NaN), 100)).toBeNull();
    expect(tokenIntensity(day("2026-10-11", Infinity), 100)).toBeNull();
  });
});
