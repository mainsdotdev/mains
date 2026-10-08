import { describe, expect, it } from "vitest";
import { statusBarLimits } from "./status-bar-limits";

describe("status bar remaining limits", () => {
  it("converts provider usage to remaining allowance and keeps reset timestamps", () => {
    expect(statusBarLimits({
      primary: { usedPercent: 32, windowDurationMins: 300, resetsAt: 123 },
      secondary: { usedPercent: 59, windowDurationMins: 10080 },
    })).toEqual([
      { key: "codex:primary", group: "codex", label: "5h", remainingPercent: 68, resetsAt: 123 },
      { key: "codex:secondary", group: "codex", label: "Weekly", remainingPercent: 41, resetsAt: undefined },
    ]);
  });

  it("does not invent allowance when usage is unavailable", () => {
    expect(statusBarLimits(null)).toEqual([]);
    expect(statusBarLimits({ primary: { usedPercent: NaN } })).toEqual([]);
    expect(statusBarLimits({ primary: { usedPercent: Infinity } })).toEqual([]);
  });

  it("keeps a real zero and clamps provider overages", () => {
    expect(statusBarLimits({
      primary: { usedPercent: 0 }, secondary: { usedPercent: 120 },
    }).map((row) => row.remainingPercent)).toEqual([100, 0]);
  });

  it("preserves provider quota labels", () => {
    expect(statusBarLimits({ primary: { usedPercent: 25, label: "Premium requests" } })[0])
      .toMatchObject({ label: "Premium requests", remainingPercent: 75 });
  });

  it("does not duplicate the root bucket or show its reserve as ordinary allowance", () => {
    const rows = statusBarLimits({
      primary: { usedPercent: 99, windowDurationMins: 300 },
      rateLimitsByLimitId: {
        reserve: { limitName: "Model reserve", primary: { usedPercent: 5 } },
        codex: { primary: { usedPercent: 70, windowDurationMins: 300 }, secondary: { usedPercent: 80, windowDurationMins: 10080 } },
      },
    });
    expect(rows.map((row) => row.key)).toEqual(["codex:primary", "codex:secondary", "reserve:primary"]);
    expect(rows.map((row) => row.remainingPercent)).toEqual([30, 20, 95]);
  });
});
