import { describe, expect, it } from "vitest";
import { describePulseStatus, formatRelative } from "./pulse-status";

const NOW = Date.UTC(2026, 8, 16, 12, 0, 0);
const MIN = 60_000;

describe("formatRelative", () => {
  it("reads future and past distances in the largest whole unit", () => {
    expect(formatRelative(NOW + 5 * MIN, NOW)).toBe("in 5m");
    expect(formatRelative(NOW + 179 * MIN, NOW)).toBe("in 2h");
    expect(formatRelative(NOW - 3 * 24 * 60 * MIN, NOW)).toBe("3d ago");
  });

  it("collapses anything under a minute to now", () => {
    expect(formatRelative(NOW + 30_000, NOW)).toBe("now");
  });

  it("accepts Date, ISO string, and epoch ms, and rejects the rest", () => {
    const at = NOW + 10 * MIN;
    expect(formatRelative(new Date(at), NOW)).toBe("in 10m");
    expect(formatRelative(new Date(at).toISOString(), NOW)).toBe("in 10m");
    expect(formatRelative(at, NOW)).toBe("in 10m");
    expect(formatRelative(null, NOW)).toBeNull();
    expect(formatRelative("not a date", NOW)).toBeNull();
  });
});

describe("describePulseStatus", () => {
  const base = {
    isActive: true,
    lastError: null,
    lastRunAt: null,
    nextRunAt: new Date(NOW + 90 * MIN),
  };

  it("shows when an active pulse fires next", () => {
    expect(describePulseStatus(base, NOW)).toEqual({
      state: "active",
      label: "Next in 1h",
    });
  });

  it("marks an overdue active pulse as due", () => {
    expect(
      describePulseStatus({ ...base, nextRunAt: new Date(NOW - MIN) }, NOW),
    ).toEqual({ state: "active", label: "Due now" });
  });

  it("says nothing extra when an active pulse has no next run yet", () => {
    expect(describePulseStatus({ ...base, nextRunAt: null }, NOW)).toEqual({
      state: "active",
      label: null,
    });
  });

  it("reports a paused pulse as paused", () => {
    expect(describePulseStatus({ ...base, isActive: false }, NOW)).toEqual({
      state: "paused",
      label: "Paused",
    });
  });

  it("lets a failed run outrank paused", () => {
    expect(
      describePulseStatus(
        {
          ...base,
          isActive: false,
          lastError: "No developer space",
          lastRunAt: new Date(NOW - 2 * 60 * MIN),
        },
        NOW,
      ),
    ).toEqual({ state: "failed", label: "Failed 2h ago" });
  });
});
