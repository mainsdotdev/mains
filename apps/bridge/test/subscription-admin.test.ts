import { expect, it } from "vitest";
import { bridgePeriodEnd, bridgeSubscriptionGrant } from "../src/subscription-admin";

it.each([
  ["2027-01-31T23:45:12.345Z", "monthly", "2027-02-28T23:45:12.345Z"],
  ["2028-01-31T23:45:12.345Z", "monthly", "2028-02-29T23:45:12.345Z"],
  ["2028-02-29T10:00:00.000Z", "yearly", "2029-02-28T10:00:00.000Z"],
  ["2026-12-15T10:00:00.000Z", "monthly", "2027-01-15T10:00:00.000Z"],
] as const)("uses calendar periods and UTC for %s %s", (start, interval, end) => {
  expect(new Date(bridgePeriodEnd(Date.parse(start), interval)).toISOString()).toBe(end);
});
it("rejects unknown plans/intervals and makes a grant replay use the identical period", () => {
  const grant = { accountId: "account", interval: "monthly" as const, startsAt: Date.parse("2026-10-16T00:00:00Z") };
  expect(bridgeSubscriptionGrant(grant).expiresAt).toEqual(bridgeSubscriptionGrant(grant).expiresAt);
  expect(() => bridgeSubscriptionGrant({ ...grant, planId: "free-invented" })).toThrow();
  expect(() => bridgeSubscriptionGrant({ ...grant, interval: "weekly" as "monthly" })).toThrow();
  expect(() => bridgeSubscriptionGrant({ ...grant, startsAt: NaN })).toThrow();
});
