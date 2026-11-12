// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrChecksCard } from "./pr-checks-card";
import { prFixture } from "./pull-request-test-fixtures";
import { checkDuration } from "../lib/pr-checks";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("check timing", () => {
  it("ticks live checks only while their preview is active and freezes completed runs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T10:00:17Z"));
    const detail = { ...prFixture, ciStatus: "pending" as const, checks: [{ ...prFixture.checks[0], status: "pending" as const,
      startedAt: "2026-11-12T10:00:00Z", completedAt: null }] };
    const view = render(<PrChecksCard detail={detail} active />);
    expect(screen.getAllByText("00:17")).toHaveLength(2);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getAllByText("00:18")).toHaveLength(2);
    view.rerender(<PrChecksCard detail={detail} active={false} />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getAllByText("00:18")).toHaveLength(2);
    view.rerender(<PrChecksCard active detail={{ ...detail, ciStatus: "passing", checks: [{ ...detail.checks[0],
      status: "passing", completedAt: "2026-11-12T10:00:20Z" }] }} />);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(screen.getAllByText("00:20")).toHaveLength(2);
    expect(screen.getByText("All checks passed")).toBeTruthy();
  });

  it.each([
    [null, null, null],
    ["invalid", null, null],
    ["2026-11-12T10:00:00Z", "invalid", null],
    ["2026-11-12T10:00:01Z", "2026-11-12T10:00:00Z", null],
    ["2026-11-12T10:00:00Z", "2026-11-12T11:02:03Z", "1:02:03"],
  ])("handles missing, invalid and long timings", (start, end, expected) => {
    expect(checkDuration(start, end, Date.parse("2026-11-12T10:00:17Z"))).toBe(expected);
  });
});
