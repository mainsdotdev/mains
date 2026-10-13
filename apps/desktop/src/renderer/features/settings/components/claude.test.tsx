// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RateLimitInfo } from "../../../../shared/adapter.types";
import { PROVIDER_IDS } from "../../../../shared/provider-ids";

const mocks = vi.hoisted(() => ({ rateLimits: vi.fn() }));

vi.mock("@/lib/redux/api", () => ({
  useGetProviderRateLimitsQuery: mocks.rateLimits,
  useGetProviderAccountInfoQuery: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("@/lib/platform", () => ({ useCapabilities: () => ({ revealInFolder: false }) }));
vi.mock("./provider-settings-shared", async (importOriginal) => ({
  ...await importOriginal<typeof import("./provider-settings-shared")>(),
  useProviderSettings: () => ({
    provider: { id: "claude_code", isEnabled: true },
    isLoading: false,
    error: null,
    config: {},
    updateConfig: vi.fn(),
    updating: false,
  }),
  ProviderSettingsLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ProviderAccountSection: () => null,
  ProviderCliSection: () => null,
  selectedSchemaLabel: () => "None",
}));
vi.mock("./structured-outputs-modal", () => ({ StructuredOutputsModal: () => null }));

import ClaudeSettings from "./claude";

beforeEach(() => {
  mocks.rateLimits.mockReset().mockReturnValue({ data: null, isLoading: false });
  vi.stubGlobal("api", { platform: { homedir: "/tmp/mains-test" } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Claude usage settings", () => {
  it("shows every allowance once, with remaining percentages and reset times", () => {
    const primary = { label: "5 hour usage limit", usedPercent: 25, resetsAt: 1791828000 };
    const secondary = { label: "Weekly usage limit", usedPercent: 60 };
    const limits: RateLimitInfo = {
      primary,
      secondary,
      rateLimitsByLimitId: {
        five_hour: { primary },
        seven_day: { primary: secondary },
        seven_day_sonnet: { primary: { label: "Sonnet weekly usage limit", usedPercent: 90 } },
      },
    };
    mocks.rateLimits.mockReturnValue({ data: limits, isLoading: false });
    render(<ClaudeSettings />);

    expect(mocks.rateLimits).toHaveBeenCalledWith(PROVIDER_IDS.claude, { pollingInterval: 60000 });
    expect(screen.getByText("Usage")).toBeTruthy();
    expect(screen.getByText("75% left")).toBeTruthy();
    expect(screen.getByText("40% left")).toBeTruthy();
    expect(screen.getByText("10% left")).toBeTruthy();
    expect(screen.getByText(/^Resets /)).toBeTruthy();
    expect(screen.getAllByRole("progressbar").map((bar) => bar.getAttribute("aria-valuenow")))
      .toEqual(["75", "40", "10"]);
  });

  it("distinguishes an unused allowance from unavailable usage", () => {
    mocks.rateLimits.mockReturnValue({
      data: { primary: { label: "5 hour usage limit", usedPercent: 0 } },
      isLoading: false,
    });
    const view = render(<ClaudeSettings />);
    expect(screen.getByText("100% left")).toBeTruthy();

    mocks.rateLimits.mockReturnValue({ data: null, isLoading: false });
    view.rerender(<ClaudeSettings />);
    expect(screen.getByText("No usage data available")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText("100% left")).toBeNull();
  });

  it("uses the shared loading state while the first usage query is pending", () => {
    mocks.rateLimits.mockReturnValue({ data: undefined, isLoading: true });
    render(<ClaudeSettings />);
    expect(screen.getAllByRole("progressbar", { name: "Loading usage" })).toHaveLength(2);
    expect(screen.queryByText("No usage data available")).toBeNull();
  });
});
