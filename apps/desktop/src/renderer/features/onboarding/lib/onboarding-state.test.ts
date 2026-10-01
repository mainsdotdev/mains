import { describe, expect, it } from "vitest";
import { DEFAULT_APP_THEME_SETTINGS } from "@/lib/app-themes";
import type { Space } from "@/lib/redux/api/spaceApi";
import type { Provider } from "@/lib/redux/api/providersApi";
import type { AppSettings } from "@/lib/redux/api/appSettingsApi";
import {
  chooseOnboardingPreset,
  initialProvider,
  onboardingProviders,
  onboardingSettingsPatch,
} from "./onboarding-state";

const spaces = [
  {
    id: "claude",
    providerId: "claude_code",
    mode: "developer",
    sortOrder: 0,
    isArchived: false,
  },
  {
    id: "codex",
    providerId: "codex",
    mode: "developer",
    sortOrder: 1,
    isArchived: false,
  },
  {
    id: "archived",
    providerId: "cursor",
    mode: "developer",
    sortOrder: 2,
    isArchived: true,
  },
] as Space[];
const providers = [
  { id: "claude_code", kind: "agent_runtime", isEnabled: true },
  { id: "codex", kind: "agent_runtime", isEnabled: true },
  { id: "cursor", kind: "agent_runtime", isEnabled: true },
] as Provider[];
const detected = { claude: true, codex: true, cursor: true, copilot: false };

describe("onboarding choices", () => {
  it("offers only detected, enabled providers with a visible space and prefers the current one", () => {
    const options = onboardingProviders(providers, spaces, detected, "codex");
    expect(initialProvider(options, "codex")).toBe("codex");
    expect(
      options
        .filter((option) => option.available)
        .map((option) => option.variant),
    ).toEqual(["claude", "codex"]);
    expect(
      initialProvider(
        onboardingProviders(providers, spaces, undefined, "codex"),
        "codex",
      ),
    ).toBeNull();
    expect(spaces[2].isArchived).toBe(true);
  });

  it("keeps the selected provider's existing mode and excludes disabled providers", () => {
    const chat = { ...spaces[1], id: "codex-chat", mode: "chat" } as Space;
    const options = onboardingProviders(
      providers,
      [...spaces, chat],
      detected,
      chat.id,
    );
    expect(
      options.find((option) => option.variant === "codex")?.space?.id,
    ).toBe(chat.id);
    expect(
      onboardingProviders(
        providers.map((provider) => ({ ...provider, isEnabled: false })),
        spaces,
        detected,
        "codex",
      ).some((option) => option.available),
    ).toBe(false);
  });

  it("writes the three backend preferences together, preserving the current space when skipped", () => {
    const settings = { activeSpaceId: "claude" } as AppSettings;
    const preferences = { enableWorktrees: false, notifyOnRunComplete: true };
    const codex = onboardingProviders(
      providers,
      spaces,
      detected,
      "claude",
    ).find((option) => option.variant === "codex")!;
    expect(
      onboardingSettingsPatch(settings, spaces, codex, preferences),
    ).toEqual({ activeSpaceId: "codex", ...preferences });
    expect(
      onboardingSettingsPatch(settings, spaces, null, preferences),
    ).toEqual({ activeSpaceId: "claude", ...preferences });
    expect(() =>
      onboardingSettingsPatch(
        settings,
        spaces,
        { ...codex, available: false },
        preferences,
      ),
    ).toThrow("Choose an available provider");
    expect(
      onboardingSettingsPatch(
        { activeSpaceId: "archived" } as AppSettings,
        spaces,
        null,
        preferences,
      ).activeSpaceId,
    ).toBe("claude");
  });

  it("applies a preset to its supported modes without losing the other appearance", () => {
    const initial = DEFAULT_APP_THEME_SETTINGS.default;
    const shared = chooseOnboardingPreset(initial, "codex", "light");
    expect(shared.light.theme).toBe("codex");
    expect(shared.dark.theme).toBe("codex");
    const darkOnly = chooseOnboardingPreset(shared, "dracula", "dark");
    expect(darkOnly.light).toBe(shared.light);
    expect(darkOnly.dark.theme).toBe("dracula");
    expect(chooseOnboardingPreset(shared, "dracula", "light")).toBe(shared);
  });
});
