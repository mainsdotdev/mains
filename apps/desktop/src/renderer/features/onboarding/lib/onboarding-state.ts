import type {
  AppSettings,
  AppSettingsPatch,
} from "@/lib/redux/api/appSettingsApi";
import type { DetectedClis, Provider } from "@/lib/redux/api/providersApi";
import type { Space } from "@/lib/redux/api/spaceApi";
import type { ProviderCliSource } from "@mains/contracts/provider-cli";
import {
  APP_THEME_PRESETS,
  type ThemeAppearance,
  type ThemeChoice,
} from "@/lib/app-themes";
import {
  getProviderVariant,
  type ProviderVariant,
} from "@/lib/provider-variants";
import { ONBOARDING_AGENT_SLUGS } from "../onboarding-agents";

export interface OnboardingProvider {
  variant: ProviderVariant;
  space: Space | undefined;
  active: boolean;
  installed: boolean | undefined;
  source?: ProviderCliSource;
  available: boolean;
}

/** Pick an existing space; onboarding never archives or enables other agents. */
export function onboardingProviders(
  providers: readonly Provider[],
  spaces: readonly Space[],
  detected: DetectedClis | undefined,
  activeSpaceId: string | null,
): OnboardingProvider[] {
  const sources: Partial<Record<ProviderVariant, ProviderCliSource | undefined>> = {
    claude: detected?.claudeSource,
  };
  return ONBOARDING_AGENT_SLUGS.map((variant) => {
    const { providerId } = getProviderVariant(variant);
    const candidates = spaces
      .filter((space) => !space.isArchived && space.providerId === providerId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const space =
      candidates.find((candidate) => candidate.id === activeSpaceId) ??
      candidates.find((candidate) => candidate.mode === "developer") ??
      candidates[0];
    const active =
      !!space &&
      providers.some(
        (provider) =>
          provider.id === providerId &&
          provider.isEnabled &&
          provider.kind === "agent_runtime",
      );
    const installed = detected?.[variant];
    return {
      variant,
      space,
      active,
      installed,
      source: sources[variant],
      available: active && installed === true,
    };
  });
}

export function initialProvider(
  options: readonly OnboardingProvider[],
  activeSpaceId: string | null,
): ProviderVariant | null {
  const available = options.filter((option) => option.available);
  return (
    (
      available.find((option) => option.space?.id === activeSpaceId) ??
      available[0]
    )?.variant ?? null
  );
}

/** A shared preset follows both modes when offered, retaining the other mode otherwise. */
export function chooseOnboardingPreset(
  choice: ThemeChoice,
  theme: string,
  appearance: ThemeAppearance,
): ThemeChoice {
  const preset = APP_THEME_PRESETS.find((candidate) => candidate.id === theme);
  if (!preset || !(appearance in preset.palettes)) return choice;
  return {
    light:
      "light" in preset.palettes ? { theme, accent: "theme" } : choice.light,
    dark: "dark" in preset.palettes ? { theme, accent: "theme" } : choice.dark,
  };
}

export function onboardingSettingsPatch(
  settings: AppSettings,
  spaces: readonly Space[],
  provider: OnboardingProvider | null,
  preferences: Pick<AppSettings, "enableWorktrees" | "notifyOnRunComplete">,
): AppSettingsPatch {
  if (provider && !provider.available)
    throw new Error("Choose an available provider or set it up later.");
  const fallback =
    spaces.find(
      (space) => !space.isArchived && space.id === settings.activeSpaceId,
    ) ??
    spaces
      .filter((space) => !space.isArchived)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0];
  return {
    activeSpaceId: provider?.space?.id ?? fallback?.id ?? null,
    ...preferences,
  };
}
