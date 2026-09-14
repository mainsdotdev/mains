import { describe, expect, it } from "vitest";
import { getPluginInstallBlockReason } from "./plugin-install-availability";

describe("getPluginInstallBlockReason", () => {
  it("explains plan restrictions with the eligible plans", () => {
    expect(
      getPluginInstallBlockReason({
        installPolicy: "AVAILABLE",
        availability: "AVAILABLE",
        disabledReason: "plan_not_eligible",
        eligiblePlanTypes: ["pro", "business"],
      }),
    ).toBe(
      "This plugin is not available on your current plan. Eligible plans: pro, business.",
    );
  });

  it("blocks admin-disabled and install-policy-disabled plugins", () => {
    expect(
      getPluginInstallBlockReason({
        installPolicy: "AVAILABLE",
        availability: "DISABLED_BY_ADMIN",
      }),
    ).toBe("This plugin is disabled by your administrator.");
    expect(
      getPluginInstallBlockReason({
        installPolicy: "NOT_AVAILABLE",
      }),
    ).toBe("This plugin is not available for installation.");
  });

  it("allows plugins without a blocking condition", () => {
    expect(
      getPluginInstallBlockReason({
        installPolicy: "AVAILABLE",
        availability: "AVAILABLE",
        disabledReason: null,
      }),
    ).toBeNull();
  });
});
