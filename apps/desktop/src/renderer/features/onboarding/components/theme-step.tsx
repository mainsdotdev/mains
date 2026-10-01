import { Input, NativeSelect, SegmentedTabs } from "@/components/ui";
import { SelectOption } from "@/components/ui/icons";
import {
  appThemesFor,
  paintedPalette,
  resolveAppearance,
  type ThemeAppearance,
  type ThemeChoice,
} from "@/lib/app-themes";
import type { ThemePreference } from "@/lib/redux/slices/appSettingsSlice";
import type { ProviderVariant } from "@/lib/provider-variants";
import { ThemePreview } from "./theme-preview";

const FEATURED_PRESETS = [
  "mains",
  "absolutely",
  "codex",
  "catppuccin",
  "flexoki",
  "rose-pine",
];
const APPEARANCES: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "system", label: "Auto" },
  { value: "dark", label: "Dark" },
];
interface ThemeStepProps {
  theme: ThemePreference;
  onThemeChange: (value: ThemePreference) => void;
  palettes: ThemeChoice;
  appearance: ThemeAppearance;
  onPresetChange: (value: string) => void;
  provider: ProviderVariant | null;
}

export function ThemeStep({
  theme,
  onThemeChange,
  palettes,
  appearance,
  onPresetChange,
  provider,
}: ThemeStepProps) {
  const presets = appThemesFor(appearance);
  const selected = palettes[appearance].theme;
  return (
    <div className="onboarding-theme">
      <SegmentedTabs
        id="onboarding-appearance"
        semantics="radiogroup"
        aria-label="Appearance"
        value={theme}
        onChange={onThemeChange}
        options={APPEARANCES}
        className="onboarding-appearance"
      />
      <ThemePreview appearance={appearance} variant={provider} />
      <label className="onboarding-preset-select">
        <span>Color theme</span>
        <span className="onboarding-select-field glass-input">
          <NativeSelect
            variant="bare"
            value={selected}
            className="onboarding-select"
            onChange={(event) => onPresetChange(event.target.value)}
          >
            {!presets.some((preset) => preset.id === selected) && (
              <option value={selected}>Current theme</option>
            )}
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </NativeSelect>
          <SelectOption className="onboarding-select-icon" aria-hidden="true" />
        </span>
      </label>
      <fieldset className="onboarding-swatches">
        <legend className="sr-only">Featured color themes</legend>
        {presets
          .filter((preset) => FEATURED_PRESETS.includes(preset.id))
          .map((preset) => {
            const palette = paintedPalette(
              resolveAppearance(
                { theme: preset.id, accent: "theme" },
                appearance,
              ),
              appearance,
            );
            return (
              <label key={preset.id} title={preset.name}>
                <Input
                  variant="bare"
                  type="radio"
                  name="onboarding-preset"
                  className="sr-only"
                  aria-label={preset.name}
                  checked={selected === preset.id}
                  onChange={() => onPresetChange(preset.id)}
                />
                <span
                  className="glass-outline"
                  style={{
                    background: `linear-gradient(135deg, ${palette.background} 48%, ${palette.accent} 52%)`,
                  }}
                />
              </label>
            );
          })}
      </fieldset>
      <p className="onboarding-panel-note">
        {theme === "system"
          ? "Auto follows your Mac’s appearance."
          : "A look that feels like you."}{" "}
        This becomes your default theme.
      </p>
    </div>
  );
}
