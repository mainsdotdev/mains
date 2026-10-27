// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RealtimeVoiceCatalog } from "@mains/contracts/realtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateConfig: vi.fn(),
  setMemorySetting: vi.fn(),
  resetMemories: vi.fn(),
  voiceCatalog: vi.fn(() => ({ data: undefined as RealtimeVoiceCatalog | undefined })),
  voiceSettings: vi.fn((_props: { catalog?: RealtimeVoiceCatalog | null }) => null),
  memorySettings: {
    supported: true,
    memoriesEnabled: true,
    allowToolAssistedChats: true as boolean | null,
  },
}));

vi.mock("@/lib/transport", () => ({
  appEvents: { providers: { onRateLimitsUpdated: () => () => {} } },
}));
vi.mock("@/lib/redux/hooks", () => ({ useAppDispatch: () => vi.fn() }));
vi.mock("@/lib/redux/api", () => ({
  useGetProviderRateLimitsQuery: () => ({ data: undefined, isLoading: false }),
  useGetProviderAccountInfoQuery: () => ({ data: undefined, isLoading: false }),
  useGetProviderRealtimeVoicesQuery: mocks.voiceCatalog,
  useConsumeProviderRateLimitResetCreditMutation: () => [vi.fn(), { isLoading: false }],
  useGetCodexMemorySettingsQuery: () => ({ data: mocks.memorySettings, isLoading: false, isFetching: false, error: null }),
  useSetCodexMemorySettingMutation: () => [mocks.setMemorySetting, { isLoading: false }],
  useResetCodexMemoriesMutation: () => [mocks.resetMemories, { isLoading: false }],
}));
vi.mock("./provider-settings-shared", () => ({
  useProviderSettings: () => ({
    provider: { id: "codex", isEnabled: true },
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
vi.mock("./codex-voice-settings", () => ({ CodexVoiceSettings: mocks.voiceSettings }));

import CodexSettings from "./codex";

beforeEach(() => {
  mocks.updateConfig.mockClear();
  mocks.voiceCatalog.mockReset().mockReturnValue({ data: undefined });
  mocks.voiceSettings.mockClear();
  mocks.setMemorySetting.mockReset().mockReturnValue({ unwrap: async () => undefined });
  mocks.resetMemories.mockReset().mockReturnValue({ unwrap: async () => undefined });
  mocks.memorySettings.supported = true;
  mocks.memorySettings.memoriesEnabled = true;
  mocks.memorySettings.allowToolAssistedChats = true;
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("Codex voice settings", () => {
  it("refreshes the native catalog when settings open and passes new voices to the picker", () => {
    const catalog = { voices: ["cove", "aube", "rio", "viola"], defaultVoice: "cove" };
    mocks.voiceCatalog.mockReturnValue({ data: catalog });
    render(<CodexSettings />);

    expect(mocks.voiceCatalog).toHaveBeenCalledWith("codex", {
      skip: false,
      refetchOnMountOrArgChange: true,
    });
    expect(mocks.voiceSettings.mock.calls.at(-1)?.[0].catalog).toBe(catalog);
  });
});

describe("Codex memory settings", () => {
  it("writes the UI-facing tool-assisted value and asks before deleting memories", async () => {
    render(<CodexSettings />);

    fireEvent.click(screen.getByRole("switch", { name: "Include chats that use tools" }));
    expect(mocks.setMemorySetting).toHaveBeenCalledWith({
      providerId: "codex",
      setting: "allowToolAssistedChats",
      enabled: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(mocks.resetMemories).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(mocks.resetMemories).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: /Clear memories/ }));
    await waitFor(() => expect(mocks.resetMemories).toHaveBeenCalledWith("codex"));
  });

  it("shows an unset App Server value without assuming a default", () => {
    mocks.memorySettings.allowToolAssistedChats = null;
    render(<CodexSettings />);
    expect(screen.getByText("Using Codex default")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(mocks.setMemorySetting).toHaveBeenCalledWith({
      providerId: "codex",
      setting: "allowToolAssistedChats",
      enabled: false,
    });
  });
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
