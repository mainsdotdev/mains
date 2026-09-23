import { Fragment, useState } from "react";
import {
  Button,
  SegmentedTabs,
  Select,
  Slider,
  Toggle,
  toast,
  type SelectOption,
} from "@/components/ui";
import { Undo } from "@/components/ui/icons";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  setCodeFontSize,
  setFontFamily,
  setInterfaceFontSize,
} from "@/lib/redux/slices/appSettingsSlice";
import {
  CODE_FONT_OPTIONS,
  MAX_CODE_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_INTERFACE_FONT_SIZE,
  UI_FONT_OPTIONS,
  fontFamilyLabel,
  fontFamilyOptions,
  loadInstalledFontFamilies,
} from "@/lib/appearance-fonts";
import {
  appThemesFor,
  editAppearanceChoice,
  paintedPalette,
  resolveAppearance,
  type AppearanceChoice,
  type ThemeAccentSource,
  type ThemeAppearance,
} from "@/lib/app-themes";
import {
  getProviderVariantById,
  type ProviderVariantDescriptor,
} from "@/lib/provider-variants";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useAppThemeSettings } from "@/hooks/use-app-theme";
import { useIsMobile } from "@/lib/platform";
import {
  SettingsDivider,
  SettingsPageShell,
  SettingsRow,
  SettingsSection,
} from "./settings-layout";
import { ThemePicker, ThemeSelect, type ThemeValue } from "./theme-picker";
import { ColorField } from "./color-field";

const ALL_PROVIDERS = "all";
/** The "Default (…)" entry of a provider scope: follow the default. */
const INHERIT = "inherit";

const APPEARANCE_TITLES: Record<ThemeAppearance, string> = {
  light: "Light theme",
  dark: "Dark theme",
};

/**
 * The "Aa" chip a theme menu entry leads with: the theme's background and its
 * accent. A preview of literal colours, like the colour pills.
 */
function ThemeSwatch({
  theme,
  appearance,
}: {
  theme: string;
  appearance: ThemeAppearance;
}) {
  const { background, accent } = paintedPalette(
    resolveAppearance({ theme, accent: "theme" }, appearance),
    appearance,
  );
  return (
    <span
      aria-hidden
      className="flex size-5 shrink-0 items-center justify-center rounded-md border border-primary-950/10 text-t font-semibold dark:border-primary/15"
      style={{ backgroundColor: background, color: accent }}
    >
      Aa
    </span>
  );
}

/** A small reset beside a field that holds an edit. */
function ResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="icon" tooltip={label} aria-label={label} onClick={onClick}>
      <Undo className="size-3.5" />
    </Button>
  );
}

/**
 * One appearance's theme for the current scope: the preset, and the edits on
 * top of it. In a provider scope the preset
 * picker leads with "Default (…)"; while it's picked the fields show the
 * default's values, and editing one takes the appearance over for that
 * provider, starting from the default.
 */
function AppearanceCard({
  appearance,
  provider,
}: {
  appearance: ThemeAppearance;
  /** The scope's provider; `null` edits the default. */
  provider: ProviderVariantDescriptor | null;
}) {
  const [settings, change] = useAppThemeSettings();
  const providerId = provider?.providerId ?? null;
  const inherited = settings.default[appearance];
  const own = providerId
    ? settings.providers[providerId]?.[appearance]
    : inherited;
  const choice = own ?? inherited;
  const resolved = resolveAppearance(choice, appearance);
  const painted = paintedPalette(resolved, appearance);
  const title = APPEARANCE_TITLES[appearance];

  const commit = (next: AppearanceChoice | null) =>
    change({ providerId, appearance, choice: next });
  const edit = (patch: Partial<AppearanceChoice>) =>
    commit(editAppearanceChoice(choice, patch));

  const presets: SelectOption[] = appThemesFor(appearance).map((preset) => ({
    value: preset.id,
    label: preset.name,
    icon: <ThemeSwatch theme={preset.id} appearance={appearance} />,
  }));
  const presetName = (id: string) =>
    presets.find((option) => option.value === id)?.label ?? presets[0].label;
  const presetOptions = providerId
    ? [
        {
          value: INHERIT,
          label: `Default (${presetName(inherited.theme)})`,
          icon: <ThemeSwatch theme={inherited.theme} appearance={appearance} />,
        },
        ...presets,
      ]
    : presets;
  const presetValue =
    providerId && !own
      ? INHERIT
      : presets.some((option) => option.value === choice.theme)
        ? choice.theme
        : presets[0].value;

  const accentOptions: SelectOption<ThemeAccentSource>[] = [
    { value: "theme", label: "Theme" },
    { value: "custom", label: "Custom" },
  ];

  return (
    <SettingsSection
      title={title}
      actions={
        <Select
          value={presetValue}
          aria-label={`${title} preset`}
          options={presetOptions}
          onChange={(value) =>
            commit(
              value === INHERIT
                ? null
                : editAppearanceChoice(choice, {
                    theme: value,
                    // A new preset brings its own colours.
                    background: undefined,
                    foreground: undefined,
                    contrast: undefined,
                  }),
            )
          }
        />
      }
    >
      <SettingsRow
        title="Accent"
        description="Buttons, links and focus"
      >
        <div className="flex items-center gap-2">
          <Select
            value={choice.accent}
            aria-label={`${title} accent source`}
            options={accentOptions}
            size="s"
            onChange={(accent) =>
              edit(
                accent === "custom"
                  ? { accent, accentColor: choice.accentColor ?? painted.accent }
                  : { accent },
              )
            }
          />
          <ColorField
            value={painted.accent}
            aria-label={`${title} accent`}
            onChange={(color) => edit({ accent: "custom", accentColor: color })}
          />
        </div>
      </SettingsRow>

      {(["background", "foreground"] as const).map((key) => (
        <Fragment key={key}>
          <SettingsDivider />
          <SettingsRow
            title={key === "background" ? "Background" : "Foreground"}
            description={
              key === "background"
                ? "The content surface; the frame and panels derive from it"
                : "Text; secondary text and borders derive from it"
            }
          >
            <div className="flex items-center gap-2">
              {choice[key] !== undefined && (
                <ResetButton
                  label={`Reset ${key} to the preset`}
                  onClick={() => edit({ [key]: undefined })}
                />
              )}
              <ColorField
                value={painted[key]}
                aria-label={`${title} ${key}`}
                onChange={(color) => edit({ [key]: color })}
              />
            </div>
          </SettingsRow>
        </Fragment>
      ))}

      <SettingsDivider />
      <SettingsRow
        title="Contrast"
        description="Pulls secondary text toward the foreground; surfaces stay put"
      >
        <div className="flex items-center gap-2">
          {choice.contrast !== undefined && (
            <ResetButton
              label="Reset contrast to the preset"
              onClick={() => edit({ contrast: undefined })}
            />
          )}
          <Slider
            value={Math.round(painted.contrast * 100)}
            aria-label={`${title} contrast`}
            onChange={(value) => edit({ contrast: value / 100 })}
            min={0}
            max={100}
            step={1}
          />
        </div>
      </SettingsRow>

      <SettingsDivider />
      <SettingsRow
        title="Translucent sidebar"
        description="Let the desktop show through the frame around the content"
      >
        <Toggle
          enabled={resolved.translucent}
          aria-label={`${title} translucent sidebar`}
          onChange={(translucent) => edit({ translucent })}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

/**
 * The installed families load on first open — the font API wants a user
 * gesture — so until then the list is the curated faces, plus the stored
 * family by name if it's none of them.
 */
function FontFamilySelect({ target }: { target: "ui" | "code" }) {
  const dispatch = useAppDispatch();
  const family = useAppSelector((s) =>
    target === "ui" ? s.appSettings.uiFontFamily : s.appSettings.codeFontFamily,
  );
  const [installed, setInstalled] = useState<string[]>([]);
  const curated = target === "ui" ? UI_FONT_OPTIONS : CODE_FONT_OPTIONS;
  const options = fontFamilyOptions(curated, installed);
  if (!options.some((option) => option.value === family)) {
    options.push({ value: family, label: fontFamilyLabel(family, curated) });
  }
  return (
    <Select
      value={family}
      aria-label={target === "ui" ? "UI font" : "Code font"}
      options={options.map(({ value, label }) => ({ value, label }))}
      onOpenChange={(open) => {
        if (open) void loadInstalledFontFamilies().then(setInstalled);
      }}
      onChange={(next) => dispatch(setFontFamily({ target, family: next }))}
    />
  );
}

/**
 * Applied on release, not while dragging: the interface size rescales the whole
 * page — this row included — so a live update would slide the handle out from
 * under the cursor. The draft drives the readout during the drag.
 */
function InterfaceFontSizeSlider() {
  const dispatch = useAppDispatch();
  const stored = useAppSelector((s) => s.appSettings.interfaceFontSize);
  const [draft, setDraft] = useState(stored);
  const [syncedFrom, setSyncedFrom] = useState(stored);

  // Adjust during render rather than in an effect: keying the slider off
  // `stored` would remount it on every commit and drop keyboard focus mid-step.
  if (syncedFrom !== stored) {
    setSyncedFrom(stored);
    setDraft(stored);
  }

  return (
    <Slider
      value={draft}
      aria-label="Interface size"
      onChange={setDraft}
      onCommit={(next) => dispatch(setInterfaceFontSize(next))}
      min={MIN_INTERFACE_FONT_SIZE}
      max={MAX_INTERFACE_FONT_SIZE}
      step={1}
      formatValue={(size) => `${size}px`}
    />
  );
}

function CodeFontSizeSlider() {
  const dispatch = useAppDispatch();
  const value = useAppSelector((s) => s.appSettings.codeFontSize);

  return (
    <Slider
      value={value}
      aria-label="Code size"
      onChange={(next) => dispatch(setCodeFontSize(next))}
      min={MIN_CODE_FONT_SIZE}
      max={MAX_CODE_FONT_SIZE}
      step={1}
      formatValue={(size) => `${size}px`}
    />
  );
}

/**
 * Settings › Appearance: the colour mode, the app theme per appearance —
 * for every provider, or one provider's own (`lib/app-themes.ts`) — and the
 * fonts, which are app-wide: a font that changed with the active provider
 * would reflow the layout on every switch.
 */
export default function AppearanceSettings() {
  const isMobile = useIsMobile();
  const { spaces } = useActiveSpace();
  const [scope, setScope] = useState(ALL_PROVIDERS);

  const providers = spaces.flatMap((space) => {
    const descriptor = getProviderVariantById(space.providerId);
    return descriptor ? [descriptor] : [];
  });
  // A provider whose space was hidden since drops back to the default scope.
  const provider = providers.find((p) => p.providerId === scope) ?? null;
  const scopeOptions = [
    { value: ALL_PROVIDERS, label: "All providers" },
    ...providers.map((p) => ({ value: p.providerId, label: p.label })),
  ];
  const selectedScope = provider ? scope : ALL_PROVIDERS;

  const handleModeChange = (value: ThemeValue) => {
    const labelMap = { light: "Light", system: "Auto", dark: "Dark" };
    toast.success(`Theme changed to ${labelMap[value]}`);
  };

  return (
    <SettingsPageShell title="Appearance">
      <SettingsSection title="Theme">
        <SettingsRow title="Mode" description="Choose your preferred color mode">
          {isMobile ? (
            <ThemeSelect onChange={handleModeChange} />
          ) : (
            <ThemePicker onChange={handleModeChange} />
          )}
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Customize for"
          description="Every provider uses the default unless it sets its own"
        >
          {isMobile ? (
            <Select
              value={selectedScope}
              aria-label="Customize theme for"
              options={scopeOptions}
              onChange={setScope}
            />
          ) : (
            <SegmentedTabs
              value={selectedScope}
              onChange={setScope}
              options={scopeOptions}
              semantics="radiogroup"
              aria-label="Customize theme for"
            />
          )}
        </SettingsRow>
      </SettingsSection>

      {(["light", "dark"] as const).map((appearance) => (
        <AppearanceCard
          key={appearance}
          appearance={appearance}
          provider={provider}
        />
      ))}

      <SettingsSection title="Fonts">
        <SettingsRow title="UI font" description="Menus, labels, and messages">
          <FontFamilySelect target="ui" />
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Code font"
          description="Diffs, file previews, code blocks, and the terminal"
        >
          <FontFamilySelect target="code" />
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Interface Size"
          description="Scales the whole interface — text, spacing, and controls"
        >
          <InterfaceFontSizeSlider />
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Code Size"
          description="Size of diffs, file previews, and code blocks"
        >
          <CodeFontSizeSlider />
        </SettingsRow>
      </SettingsSection>
    </SettingsPageShell>
  );
}
