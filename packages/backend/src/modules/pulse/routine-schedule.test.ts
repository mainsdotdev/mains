import { describe, expect, it } from "vitest";
import { computeRoutineNextRunAt } from "./routine-schedule";

const daily = { frequency: "daily" as const, hour: 9, minute: 0, timezone: "Europe/Istanbul" };
describe("assistant routine wall-clock schedules", () => {
  it("uses the saved timezone and chooses a time strictly after the current instant", () => {
    expect(computeRoutineNextRunAt(daily, new Date("2026-11-16T05:59:59Z")).toISOString()).toBe("2026-11-16T06:00:00.000Z");
    expect(computeRoutineNextRunAt(daily, new Date("2026-11-16T06:00:00Z")).toISOString()).toBe("2026-11-17T06:00:00.000Z");
  });
  it("skips weekends and resolves weekly days in the saved timezone", () => {
    const now = new Date("2026-11-13T08:00:00Z");
    expect(computeRoutineNextRunAt({ ...daily, frequency: "weekdays" }, now).toISOString()).toBe("2026-11-16T06:00:00.000Z");
    expect(computeRoutineNextRunAt({ ...daily, frequency: "weekly", dayOfWeek: 6 }, now).toISOString()).toBe("2026-11-14T06:00:00.000Z");
  });
  it("supports fractional UTC offsets for hourly schedules", () => {
    expect(computeRoutineNextRunAt({ ...daily, frequency: "hourly", minute: 15, timezone: "Asia/Kathmandu" }, new Date("2026-11-16T00:31:00Z")).toISOString()).toBe("2026-11-16T01:30:00.000Z");
  });
  it("skips nonexistent spring-forward times instead of shifting the routine's wall time", () => {
    expect(computeRoutineNextRunAt({ ...daily, hour: 2, minute: 30, timezone: "America/New_York" }, new Date("2026-03-08T05:00:00Z")).toISOString()).toBe("2026-03-09T06:30:00.000Z");
  });
  it("finds the following week when the next weekly slot falls in a spring-forward gap", () => {
    expect(computeRoutineNextRunAt({ ...daily, frequency: "weekly", dayOfWeek: 0, hour: 2, minute: 30, timezone: "America/New_York" }, new Date("2026-03-02T05:00:00Z")).toISOString()).toBe("2026-03-15T06:30:00.000Z");
  });
  it("runs a daily routine only once during a fall-back day", () => {
    const spec = { ...daily, hour: 1, minute: 30, timezone: "America/New_York" };
    expect(computeRoutineNextRunAt(spec, new Date("2026-11-01T04:00:00Z")).toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(computeRoutineNextRunAt(spec, new Date("2026-11-01T05:30:00Z")).toISOString()).toBe("2026-11-02T06:30:00.000Z");
  });
});
