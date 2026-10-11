import { describe, expect, it, vi } from "vitest";
import type { DashboardRange } from "@mains/contracts/stats";
import { formatBucketDate, formatEstimatedCost, formatRange, formatTokens, getClientTimeZone } from "./dashboard-format";

const range: DashboardRange = { period: "week", timeZone: "UTC", startDate: "2026-10-05", endDate: "2026-10-11", granularity: "day" };

describe("dashboard formatting edge cases", () => {
  it.each(["", "not-a-date", "2026-02-30", "2026-13-01", "2026-10-11T12:00:00Z"])("does not throw or invent a calendar date for %j", (date) => {
    expect(formatBucketDate(date, range)).toBe("Date unavailable");
    expect(formatRange({ ...range, startDate: date })).toBe("Date unavailable");
  });

  it("rejects reversed date ranges while preserving real leap days", () => {
    expect(formatRange({ ...range, startDate: "2026-10-12" })).toBe("Date unavailable");
    expect(formatBucketDate("2024-02-29", range, true)).toBe("Feb 29, 2024");
  });

  it.each([NaN, Infinity, -Infinity, undefined, "123"])("keeps an invalid metric %j out of formatted totals", (value) => {
    expect(formatTokens(value as number)).toBe("No data");
    expect(formatEstimatedCost(value as number)).toBe("No data");
  });

  it("preserves actual zeros and signed cache savings", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatEstimatedCost(0)).toBe("$0.00");
    expect(formatEstimatedCost(-2)).toBe("-$2.00");
  });

  it("falls back to UTC if the client cannot report its time zone", () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(() => { throw new Error("Unavailable"); });
    try { expect(getClientTimeZone()).toBe("UTC"); }
    finally { spy.mockRestore(); }
  });
});
