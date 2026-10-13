import { describe, expect, it } from "vitest";
import { resolveDashboardRange } from "./stats.range";
import type { DashboardQuery } from "./stats.dto";

describe("dashboard calendar ranges", () => {
  it("crosses a year boundary with exactly 7 dates", () => {
    const range = resolveDashboardRange({ period: "week", timeZone: "UTC" }, new Date("2026-01-02T12:00:00Z"));
    expect(range.dates).toEqual(["2025-12-27", "2025-12-28", "2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]);
  });

  it("includes leap day in a rolling 30-day month", () => {
    const range = resolveDashboardRange({ period: "month", timeZone: "UTC" }, new Date("2024-03-01T12:00:00Z"));
    expect(range.dates).toHaveLength(30);
    expect(range.dates).toContain("2024-02-29");
    expect(range.dates[0]).toBe("2024-02-01");
  });

  it("uses local dates and hours across spring DST without losing a calendar day", () => {
    const range = resolveDashboardRange({ period: "week", timeZone: "America/New_York" }, new Date("2026-03-09T03:30:00Z"));
    expect(range.range).toMatchObject({ startDate: "2026-03-02", endDate: "2026-03-08" });
    expect(range.dates).toHaveLength(7);
    expect(range.localTime(Date.parse("2026-03-08T06:30:00Z") / 1000)).toEqual({ date: "2026-03-08", hour: 1 });
    expect(range.localTime(Date.parse("2026-03-08T07:30:00Z") / 1000)).toEqual({ date: "2026-03-08", hour: 3 });
    expect(range.includes(Date.parse("2026-03-02T05:00:00Z") / 1000)).toBe(true);
    expect(range.includes(Date.parse("2026-03-02T04:59:59Z") / 1000)).toBe(false);
  });

  it("maps both fall DST occurrences to the same local hour", () => {
    const range = resolveDashboardRange({ period: "week", timeZone: "America/New_York" }, new Date("2026-11-02T12:00:00Z"));
    expect(range.localTime(Date.parse("2026-11-01T05:30:00Z") / 1000)).toEqual({ date: "2026-11-01", hour: 1 });
    expect(range.localTime(Date.parse("2026-11-01T06:30:00Z") / 1000)).toEqual({ date: "2026-11-01", hour: 1 });
  });

  it("keeps a daily calendar for yearly heatmaps, including leap day and excluding future dates", () => {
    const range = resolveDashboardRange({ period: "year", timeZone: "UTC" }, new Date("2024-03-01T12:00:00Z"));
    expect(range.dates).toHaveLength(12);
    expect(range.dailyDates[0]).toBe("2023-04-01");
    expect(range.dailyDates.at(-1)).toBe("2024-03-01");
    expect(range.dailyDates).toContain("2024-02-29");
    expect(range.dailyDates).not.toContain("2024-03-02");
    expect(new Set(range.dailyDates).size).toBe(range.dailyDates.length);
  });

  it("covers extreme client time zones within database bounds", () => {
    const range = resolveDashboardRange({ period: "week", timeZone: "Pacific/Kiritimati" }, new Date("2026-01-02T12:00:00Z"));
    const start = Date.parse("2025-12-27T10:00:00Z") / 1000;
    expect(range.range.startDate).toBe("2025-12-28");
    expect(range.includes(start)).toBe(true);
    expect(range.fromSeconds).toBeLessThanOrEqual(start);
  });

  it.each([{ period: "decade" }, { provider: "unknown" }, { timeZone: "invalid-zone" }, { timeZone: "" }, []])("rejects invalid query %j", (query) => {
    expect(() => resolveDashboardRange(query as DashboardQuery)).toThrow("Invalid dashboard");
  });

  it("accepts the previous provider-only query shape", () => {
    const range = resolveDashboardRange("codex");
    expect(range.provider).toBe("codex");
    expect(range.range.period).toBe("month");
  });

  it.each([NaN, Infinity, -Infinity, 1e20, -1e20])("ignores an invalid or out-of-range activity timestamp %j without throwing", (timestamp) => {
    const range = resolveDashboardRange({ period: "week", timeZone: "UTC" }, new Date("2026-10-11T12:00:00Z"));
    expect(range.includes(timestamp)).toBe(false);
  });
});
