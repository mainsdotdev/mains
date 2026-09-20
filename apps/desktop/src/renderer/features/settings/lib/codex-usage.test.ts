import { describe, expect, it } from "vitest";
import type { RateLimitInfo } from "../../../../shared/adapter.types";
import {
  buildCodexUsageRows,
  codexUsageBucketLabel,
  mergeCodexRateLimitUpdate,
} from "./codex-usage";

const fullRateLimits: RateLimitInfo = {
  limitId: "codex",
  ordinaryUsageAllowed: true,
  primary: { usedPercent: 37, windowDurationMins: 300, resetsAt: 100 },
  secondary: { usedPercent: 90, windowDurationMins: 10080, resetsAt: 200 },
  rateLimitsByLimitId: {
    codex: {
      limitId: "codex",
      primary: { usedPercent: 37, windowDurationMins: 300, resetsAt: 100 },
      secondary: {
        usedPercent: 90,
        windowDurationMins: 10080,
        resetsAt: 200,
      },
    },
    base_model_inference: {
      limitId: "base_model_inference",
      limitName: "gpt-reserve",
      normalModelSlug: "gpt-5.6-luna",
      primary: { usedPercent: 2, windowDurationMins: 10080, resetsAt: 300 },
    },
  },
  rateLimitResetCredits: { availableCount: 1 },
};

describe("Codex usage presentation", () => {
  it("shows advanced and model-reserve buckets as distinct groups", () => {
    expect(buildCodexUsageRows(fullRateLimits)).toEqual([
      {
        key: "codex:primary",
        group: "Advanced usage",
        label: "5 hour usage limit",
        usedPercent: 37,
        resetsAt: 100,
      },
      {
        key: "codex:secondary",
        group: "Advanced usage",
        label: "Weekly usage limit",
        usedPercent: 90,
        resetsAt: 200,
      },
      {
        key: "base_model_inference:primary",
        group: "Luna Reserve",
        label: "Weekly usage limit",
        usedPercent: 2,
        resetsAt: 300,
      },
    ]);
  });

  it("derives future reserve labels from the model slug", () => {
    expect(
      codexUsageBucketLabel("base_model_inference", {
        limitName: "gpt-reserve",
        normalModelSlug: "gpt-6-nova-mini",
      }),
    ).toBe("Nova Mini Reserve");
  });
});

describe("mergeCodexRateLimitUpdate", () => {
  it("updates the advanced snapshot without dropping reserve metadata", () => {
    const merged = mergeCodexRateLimitUpdate(fullRateLimits, {
      limitId: "codex",
      primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 400 },
      secondary: { usedPercent: 91, windowDurationMins: 10080, resetsAt: 500 },
    });

    expect(merged).toMatchObject({
      ordinaryUsageAllowed: true,
      primary: { usedPercent: 42 },
      rateLimitsByLimitId: {
        codex: { primary: { usedPercent: 42 } },
        base_model_inference: {
          normalModelSlug: "gpt-5.6-luna",
          primary: { usedPercent: 2 },
        },
      },
      rateLimitResetCredits: { availableCount: 1 },
    });
  });

  it("updates only the reserve bucket for a reserve push", () => {
    const merged = mergeCodexRateLimitUpdate(fullRateLimits, {
      limitId: "base_model_inference",
      limitName: "gpt-reserve",
      normalModelSlug: "gpt-5.6-luna",
      primary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: 600 },
    });

    expect(merged.primary?.usedPercent).toBe(37);
    expect(
      merged.rateLimitsByLimitId?.base_model_inference?.primary?.usedPercent,
    ).toBe(5);
    expect(merged.rateLimitsByLimitId?.codex?.primary?.usedPercent).toBe(37);
  });
});
