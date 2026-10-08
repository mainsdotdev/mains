// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateConfig: vi.fn(),
}));

vi.mock("@/lib/transport", () => ({
  appEvents: { providers: { onRateLimitsUpdated: () => () => {} } },
}));
vi.mock("@/lib/redux/hooks", () => ({ useAppDispatch: () => vi.fn() }));
vi.mock("@/lib/redux/api", () => ({
  useGetProviderRateLimitsQuery: () => ({ data: undefined, isLoading: false }),
  useGetProviderAccountInfoQuery: () => ({ data: undefined, isLoading: false }),
  useGetProviderRealtimeVoicesQuery: () => ({ data: undefined }),
  useConsumeProviderRateLimitResetCreditMutation: () => [vi.fn(), { isLoading: false }],
}));
vi.mock("./provider-settings-shared", () => ({
  useProviderSettings: () => ({
    provider: { id: "codex", isEnabled: false },
    isLoading: false,
    error: null,
    config: { sandboxMode: "workspace-write" },
    updateConfig: mocks.updateConfig,
    updating: false,
  }),
  ProviderSettingsLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ProviderAccountSection: () => null,
  ProviderCliSection: () => null,
  ProviderUsageSection: () => null,
  selectedSchemaLabel: () => "None",
}));
vi.mock("./structured-outputs-modal", () => ({ StructuredOutputsModal: () => null }));
vi.mock("./codex-voice-settings", () => ({ CodexVoiceSettings: () => null }));

import CodexSettings from "./codex";

beforeEach(() => {
  mocks.updateConfig.mockClear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("Codex sandbox settings", () => {
  it("only saves Full Access after confirmation", () => {
    render(<CodexSettings />);
    const chooseFullAccess = () => {
      fireEvent.click(screen.getByRole("button", { name: "Sandbox mode" }));
      fireEvent.click(screen.getByRole("option", { name: /Full Access/ }));
    };

    chooseFullAccess();
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.updateConfig).not.toHaveBeenCalled();

    chooseFullAccess();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(mocks.updateConfig).toHaveBeenCalledExactlyOnceWith({
      sandboxMode: "danger-full-access",
    });
  });
});
