import { Fragment, useState } from "react";
import { SegmentedTabs, Select, type SelectOption } from "@/components/ui";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useAppThemeSettings } from "@/hooks/use-app-theme";
import {
  appThemesFor,
  type ThemeAccentSource,
  type ThemeAppearance,
} from "@/lib/app-themes";
import { getProviderVariantById } from "@/lib/provider-variants";
import { SettingsDivider, SettingsRow } from "./settings-layout";

const ALL_PROVIDERS = "all";
/** The "Default (…)" entry of a provider scope: follow the default. */
const INHERIT = "inherit";

const ACCENT_OPTIONS: SelectOption<ThemeAccentSource>[] = [
  { value: "theme", label: "Theme" },
  { value: "provider", label: "Provider color" },
];

const themeOptions = (appearance: ThemeAppearance): SelectOption[] =>
  appThemesFor(appearance).map((preset) => ({
    value: preset.id,
    label: preset.name,
  }));

interface ChoiceSelectProps<T extends string> {
  label: string;
  options: SelectOption<T>[];
  /** The scope's own pick; `undefined` while it follows the default. */
  value: T | undefined;
  /** The default's pick when the scope is a provider, else `null`. */
  inherited: T | null;
  onChange: (value: T | null) => void;
}

/**
 * One pick for the current scope. In a provider scope the first entry is
 * "Default (…)", naming what the default currently is; choosing it drops the
 * override. A value no longer offered (a removed theme) shows as the first
 * entry, which is also what it resolves to.
 */
function ChoiceSelect<T extends string>({
  label,
  options,
  value,
  inherited,
  onChange,
}: ChoiceSelectProps<T>) {
  const labelOf = (v: T | null | undefined) =>
    options.find((option) => option.value === v)?.label ?? options[0].label;
  const entries: SelectOption[] =
    inherited === null
      ? options
      : [{ value: INHERIT, label: `Default (${labelOf(inherited)})` }, ...options];
  const selected = entries.some((entry) => entry.value === value)
    ? (value as string)
    : entries[0].value;
  return (
    <Select
      value={selected}
      aria-label={label}
      options={entries}
      onChange={(next) => onChange(next === INHERIT ? null : (next as T))}
    />
  );
}

/**
 * Settings › General › Appearance: which app theme each provider wears
 * (`lib/app-themes.ts`). "All providers" edits the default; a provider's tab
 * edits its overrides, row by row, each able to go back to the default.
 */
export function AppThemeSettingsRows({ compact }: { compact: boolean }) {
  const [settings, change] = useAppThemeSettings();
  const { spaces } = useActiveSpace();
  const [scope, setScope] = useState(ALL_PROVIDERS);

  const providers = spaces.flatMap((space) => {
    const descriptor = getProviderVariantById(space.providerId);
    return descriptor ? [descriptor] : [];
  });
  // A provider whose space was hidden since drops back to the default scope.
  const provider = providers.find((p) => p.providerId === scope);
  const providerId = provider?.providerId ?? null;
  const own = providerId
    ? (settings.providers[providerId] ?? {})
    : settings.default;
  const inherited = <K extends "light" | "dark" | "accent">(key: K) =>
    providerId ? settings.default[key] : null;

  const scopeOptions = [
    { value: ALL_PROVIDERS, label: "All providers" },
    ...providers.map((p) => ({ value: p.providerId, label: p.label })),
  ];
  const selectedScope = provider ? scope : ALL_PROVIDERS;

  return (
    <>
      <SettingsDivider />
      <SettingsRow
        title="Customize for"
        description="Every provider uses the default unless it sets its own"
      >
        {compact ? (
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

      {(["light", "dark"] as const).map((appearance) => (
        <Fragment key={appearance}>
          <SettingsDivider />
          <SettingsRow
            title={appearance === "light" ? "Light theme" : "Dark theme"}
            description={`Colors used while the app is ${appearance}`}
          >
            <ChoiceSelect
              label={appearance === "light" ? "Light theme" : "Dark theme"}
              options={themeOptions(appearance)}
              value={own[appearance]}
              inherited={inherited(appearance)}
              onChange={(value) =>
                change({ providerId, key: appearance, value })
              }
            />
          </SettingsRow>
        </Fragment>
      ))}

      {/* A provider without a brand colour has no accent to offer. */}
      {(!provider || provider.brandColor) && (
        <>
          <SettingsDivider />
          <SettingsRow
            title="Accent"
            description={
              provider
                ? `Buttons, links and the composer glow while ${provider.label} is active`
                : "Buttons, links and the composer glow. Provider color follows the active agent — Cursor keeps the theme's"
            }
          >
            <ChoiceSelect
              label="Accent"
              options={ACCENT_OPTIONS}
              value={own.accent}
              inherited={inherited("accent")}
              onChange={(value) =>
                change({ providerId, key: "accent", value })
              }
            />
          </SettingsRow>
        </>
      )}
    </>
  );
}
