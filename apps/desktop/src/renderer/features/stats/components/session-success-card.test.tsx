// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StatusBreakdown } from "@mains/contracts/stats";
import SessionSuccessCard from "./session-success-card";

const empty: StatusBreakdown = { days: [], totalSucceeded: 0, totalFailed: 0, totalCanceled: 0, totalOther: 0 };

describe("session success rate", () => {
  afterEach(cleanup);

  it("uses successful and failed sessions without counting canceled or ongoing sessions as failures", () => {
    render(<SessionSuccessCard data={{ ...empty, totalSucceeded: 6, totalFailed: 2, totalCanceled: 100, totalOther: 100 }} />);
    expect(screen.getByRole("img", { name: "Session success rate: 75%" })).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByLabelText("How session success rate is calculated").getAttribute("title")).toContain("Uses the current status");
  });

  it("shows No data when no session has a successful or failed outcome", () => {
    render(<SessionSuccessCard data={{ ...empty, totalCanceled: 3, totalOther: 5 }} />);
    expect(screen.getByRole("img", { name: "Session success rate: No data" })).toBeTruthy();
    expect(screen.getByText("No data")).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
  });

  it.each([
    { totalSucceeded: 0, totalFailed: 4, value: "0%" },
    { totalSucceeded: 4, totalFailed: 0, value: "100%" },
  ])("preserves the measured $value rate", ({ totalSucceeded, totalFailed, value }) => {
    render(<SessionSuccessCard data={{ ...empty, totalSucceeded, totalFailed }} />);
    expect(screen.getByRole("img", { name: `Session success rate: ${value}` })).toBeTruthy();
    expect(screen.queryByText("No data")).toBeNull();
  });
});
