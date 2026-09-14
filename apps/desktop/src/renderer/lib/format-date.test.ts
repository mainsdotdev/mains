import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatDate, formatAbsoluteDate } from "./format-date";

describe("formatDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for less than 60 seconds ago", () => {
    const date = new Date("2026-03-10T11:59:30Z").toISOString();
    expect(formatDate(date)).toBe("just now");
  });

  it("returns minutes ago", () => {
    const date = new Date("2026-03-10T11:45:00Z").toISOString();
    expect(formatDate(date)).toBe("15m ago");
  });

  it("returns hours ago", () => {
    const date = new Date("2026-03-10T09:00:00Z").toISOString();
    expect(formatDate(date)).toBe("3h ago");
  });

  it("returns days ago", () => {
    const date = new Date("2026-03-05T12:00:00Z").toISOString();
    expect(formatDate(date)).toBe("5d ago");
  });

  it("returns formatted date for 30+ days", () => {
    const date = new Date("2026-01-15T12:00:00Z").toISOString();
    const result = formatDate(date);
    // Should contain month and day (locale-dependent)
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/15/);
  });

  it("handles unix timestamp in seconds", () => {
    // 2026-03-10T11:55:00Z in unix seconds
    const timestamp = Math.floor(new Date("2026-03-10T11:55:00Z").getTime() / 1000);
    expect(formatDate(timestamp)).toBe("5m ago");
  });

  it("handles unix timestamp in milliseconds", () => {
    const timestamp = new Date("2026-03-10T11:55:00Z").getTime();
    expect(formatDate(timestamp)).toBe("5m ago");
  });
});

describe("formatAbsoluteDate", () => {
  // Dates are built from local components so the expected string holds in any
  // timezone — the formatter renders local time by design.
  it("renders the exact timestamp", () => {
    expect(formatAbsoluteDate(new Date(2026, 5, 16, 10, 3))).toBe(
      "Jun 16, 2026, 10:03 AM",
    );
  });

  it("uses 12-hour time with a meridiem", () => {
    expect(formatAbsoluteDate(new Date(2026, 5, 16, 22, 3))).toBe(
      "Jun 16, 2026, 10:03 PM",
    );
    expect(formatAbsoluteDate(new Date(2026, 5, 16, 0, 30))).toBe(
      "Jun 16, 2026, 12:30 AM",
    );
  });

  it("pads minutes but not the hour or day", () => {
    expect(formatAbsoluteDate(new Date(2026, 0, 5, 9, 7))).toBe(
      "Jan 5, 2026, 9:07 AM",
    );
  });

  it("handles unix timestamps in seconds and milliseconds", () => {
    const date = new Date(2026, 5, 16, 10, 3);
    const expected = "Jun 16, 2026, 10:03 AM";

    expect(formatAbsoluteDate(date.getTime())).toBe(expected);
    expect(formatAbsoluteDate(Math.floor(date.getTime() / 1000))).toBe(expected);
  });

  it("handles ISO strings", () => {
    const date = new Date(2026, 5, 16, 10, 3);
    expect(formatAbsoluteDate(date.toISOString())).toBe("Jun 16, 2026, 10:03 AM");
  });
});
