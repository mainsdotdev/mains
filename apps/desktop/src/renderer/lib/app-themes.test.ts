import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_THEME_PRESETS,
  DEFAULT_APP_THEME_ID,
  DEFAULT_APP_THEME_SETTINGS,
  SCALE_STEPS,
  applyThemeChoice,
  appThemesFor,
  deriveThemeTokens,
  fitAccent,
  isAppThemeSettings,
  renderAppThemeCss,
  resolveAppTheme,
  themeChoiceFor,
  type AppThemeSettings,
  type ThemeAppearance,
  type ThemeChoice,
  type ThemePalette,
} from "./app-themes";
import { contrastRatio, hexToOklab, oklabLightness } from "./color";
import { PROVIDER_VARIANTS } from "./provider-variants";

const indexCss = readFileSync(
  fileURLToPath(new URL("../index.css", import.meta.url)),
  "utf8",
);

/** The stock scale literals, as index.css declares them. */
function stockScale(): Map<string, string> {
  const css = indexCss;
  const scale = new Map<string, string>();
  for (const [, name, value] of css.matchAll(
    /^\s*(--color-primary(?:-\d+)?):\s*(#[0-9a-fA-F]{6});/gm,
  )) {
    scale.set(name, value);
  }
  return scale;
}

const palettes = APP_THEME_PRESETS.flatMap((preset) =>
  (Object.entries(preset.palettes) as [ThemeAppearance, ThemePalette | null][])
    .filter((entry): entry is [ThemeAppearance, ThemePalette] => !!entry[1])
    .map(([appearance, palette]) => ({
      label: `${preset.name} ${appearance}`,
      appearance,
      palette,
    })),
);

describe("SCALE_STEPS", () => {
  it("matches the stock scale in index.css", () => {
    const scale = stockScale();
    expect([...scale.keys()]).toEqual(SCALE_STEPS.map(([name]) => name));

    const white = oklabLightness(scale.get("--color-primary")!);
    const black = oklabLightness(scale.get("--color-primary-950")!);
    for (const [name, position] of SCALE_STEPS) {
      const measured = (white - oklabLightness(scale.get(name)!)) / (white - black);
      expect(measured, name).toBeCloseTo(position, 2);
    }
  });
});

const choice = (overrides: Partial<ThemeChoice> = {}): ThemeChoice => ({
  ...DEFAULT_APP_THEME_SETTINGS.default,
  ...overrides,
});

describe("resolveAppTheme", () => {
  it("leaves both appearances on the stock scale by default", () => {
    const theme = resolveAppTheme(choice(), null);
    expect(theme.light).toEqual({ palette: null, accent: null });
    expect(theme.dark).toEqual({ palette: null, accent: null });
    expect(renderAppThemeCss(theme)).toBe("");
  });

  it("falls back to stock for unknown ids and appearances a theme lacks", () => {
    const theme = resolveAppTheme(
      choice({ light: "tokyo-night", dark: "removed" }),
      null,
    );
    expect(theme.light.palette).toBeNull();
    expect(theme.dark.palette).toBeNull();
  });

  it("picks each appearance's palette independently", () => {
    const theme = resolveAppTheme(
      choice({ light: "gruvbox", dark: "tokyo-night" }),
      null,
    );
    expect(theme.light.palette?.background).toBe("#fbf1c7");
    expect(theme.dark.palette?.background).toBe("#1a1b26");

    const css = renderAppThemeCss(theme);
    expect(css).toContain("html:not(.dark) {");
    expect(css).toContain("html.dark {");
  });

  it("keeps the theme accent without a brand colour", () => {
    const theme = resolveAppTheme(choice({ accent: "provider" }), null);
    expect(theme.dark.accent).toBeNull();
    expect(renderAppThemeCss(theme)).toBe("");
  });

  it("puts a provider accent over the stock scale without deriving one", () => {
    const css = renderAppThemeCss(
      resolveAppTheme(choice({ accent: "provider" }), "#d97757"),
    );
    expect(css).toContain("--color-accent:");
    expect(css).not.toContain("--color-primary");
    expect(css).not.toContain("--app-frame");
  });

  it("swaps a provider accent into a theme's tokens", () => {
    const theme = resolveAppTheme(
      choice({ dark: "tokyo-night", accent: "provider" }),
      "#d97757",
    );
    expect(theme.dark.accent).not.toBeNull();
    const css = renderAppThemeCss(theme);
    expect(css).toContain(`--color-accent: ${theme.dark.accent};`);
    expect(css).not.toContain("--color-accent: #7aa2f7;");
    expect(css).toContain("--color-primary-950: #1a1b26;");
  });
});

describe("theme settings", () => {
  const settings: AppThemeSettings = {
    default: choice({ dark: "tokyo-night" }),
    providers: { codex: { dark: "gruvbox", accent: "provider" } },
  };

  it("lets a provider override any subset of the default", () => {
    expect(themeChoiceFor(settings, "codex")).toEqual({
      light: DEFAULT_APP_THEME_ID,
      dark: "gruvbox",
      accent: "provider",
    });
    expect(themeChoiceFor(settings, "claude_code")).toEqual(settings.default);
    expect(themeChoiceFor(settings, null)).toEqual(settings.default);
  });

  it("drops an override on null, and the entry once it is empty", () => {
    const once = applyThemeChoice(settings, {
      providerId: "codex",
      key: "dark",
      value: null,
    });
    expect(once.providers.codex).toEqual({ accent: "provider" });

    const twice = applyThemeChoice(once, {
      providerId: "codex",
      key: "accent",
      value: null,
    });
    expect(twice.providers).toEqual({});
  });

  it("edits the default, which has nothing to clear back to", () => {
    const edited = applyThemeChoice(settings, {
      providerId: null,
      key: "light",
      value: "catppuccin",
    });
    expect(edited.default.light).toBe("catppuccin");
    expect(edited.providers).toBe(settings.providers);

    expect(
      applyThemeChoice(settings, { providerId: null, key: "dark", value: null }),
    ).toBe(settings);
  });

  it("validates the persisted blob's shape", () => {
    expect(isAppThemeSettings(DEFAULT_APP_THEME_SETTINGS)).toBe(true);
    expect(isAppThemeSettings(settings)).toBe(true);
    expect(isAppThemeSettings(null)).toBe(false);
    expect(isAppThemeSettings({ default: { light: "mains" } })).toBe(false);
    expect(
      isAppThemeSettings({
        default: { light: "mains", dark: "mains", accent: "rainbow" },
        providers: {},
      }),
    ).toBe(false);
  });
});

describe("appThemesFor", () => {
  it("offers stock in both appearances and dark-only themes only in dark", () => {
    const ids = (appearance: ThemeAppearance) =>
      appThemesFor(appearance).map((preset) => preset.id);
    expect(ids("light")[0]).toBe(DEFAULT_APP_THEME_ID);
    expect(ids("dark")[0]).toBe(DEFAULT_APP_THEME_ID);
    expect(ids("light")).not.toContain("tokyo-night");
    expect(ids("dark")).toContain("tokyo-night");
  });
});

describe("deriveThemeTokens", () => {
  const palette: ThemePalette = {
    background: "#1a1b26",
    foreground: "#a9b1d6",
    accent: "#7aa2f7",
    contrast: 0,
  };

  it("pins the scale's ends to the palette by appearance", () => {
    const dark = deriveThemeTokens(palette, "dark");
    expect(dark["--color-primary-950"]).toBe(palette.background);
    expect(dark["--color-primary"]).toBe(palette.foreground);

    const light = deriveThemeTokens(
      { ...palette, background: "#ffffff", foreground: "#1a1b26" },
      "light",
    );
    expect(light["--color-primary"]).toBe("#ffffff");
    expect(light["--color-primary-950"]).toBe("#1a1b26");
  });

  it("reproduces the stock scale from a neutral palette", () => {
    const scale = stockScale();
    const tokens = deriveThemeTokens(
      {
        background: scale.get("--color-primary")!,
        foreground: scale.get("--color-primary-950")!,
        accent: "#2563eb",
        contrast: 0,
      },
      "light",
    );
    for (const [name] of SCALE_STEPS) {
      // Lightness only: some stock steps carry a faint warm tint (`-400` is
      // #a09d95) that a mix of two neutrals can't have.
      const drift = Math.abs(
        oklabLightness(tokens[name]) - oklabLightness(scale.get(name)!),
      );
      expect(drift, name).toBeLessThan(0.005);
    }
  });

  it("moves only the text half of the scale with contrast", () => {
    const flat = deriveThemeTokens(palette, "dark");
    const lifted = deriveThemeTokens({ ...palette, contrast: 1 }, "dark");
    // Surface steps, within a quarter of the background.
    for (const name of ["--color-primary-800", "--color-primary-900", "--color-primary-950"]) {
      expect(lifted[name], name).toBe(flat[name]);
    }
    expect(lifted["--color-primary-400"]).not.toBe(flat["--color-primary-400"]);
    expect(
      contrastRatio(lifted["--color-primary-400"], palette.background),
    ).toBeGreaterThan(
      contrastRatio(flat["--color-primary-400"], palette.background),
    );
  });
});

describe.each(palettes)("$label", ({ appearance, palette }) => {
  const tokens = deriveThemeTokens(palette, appearance);
  // Light mode sets copy on `bg-primary`, dark mode on `bg-primary-950`; the
  // secondary tier is `text-primary-600` / `dark:text-primary-400`.
  const surface =
    tokens[appearance === "light" ? "--color-primary" : "--color-primary-950"];
  const secondaryText =
    tokens[appearance === "light" ? "--color-primary-600" : "--color-primary-400"];

  it("keeps secondary text at WCAG AA", () => {
    expect(contrastRatio(secondaryText, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps text on the accent at WCAG AA", () => {
    expect(
      contrastRatio(tokens["--color-accent-foreground"], palette.accent),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

const brands = Object.values(PROVIDER_VARIANTS).filter((d) => d.brandColor);
const backgrounds = [
  { label: "stock light", background: "#ffffff" },
  { label: "stock dark", background: "#0c0c0c" },
  ...palettes.map(({ label, palette }) => ({
    label,
    background: palette.background,
  })),
];

describe("provider accents", () => {
  it.each(Object.values(PROVIDER_VARIANTS))(
    "$label's brand colour matches its index.css token",
    ({ variant, brandColor }) => {
      if (!brandColor) return;
      const token = indexCss.match(
        new RegExp(`--color-${variant}:\\s*(#[0-9a-fA-F]{6});`),
      )?.[1];
      expect(token?.toLowerCase()).toBe(brandColor.toLowerCase());
    },
  );

  describe.each(brands)("$label", ({ brandColor }) => {
    it.each(backgrounds)("reaches AA on $label", ({ background }) => {
      const fitted = fitAccent(brandColor!, background);
      expect(contrastRatio(fitted, background)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("keeps the hue and leaves a readable colour alone", () => {
    // Codex's blue on white is already AA.
    expect(fitAccent("#0169cc", "#ffffff")).toBe("#0169cc");
    // Claude's orange on white isn't; it darkens, staying orange.
    const fitted = fitAccent("#d97757", "#ffffff");
    expect(fitted).not.toBe("#d97757");
    const hue = (hex: string) => {
      const [, a, b] = hexToOklab(hex);
      return Math.atan2(b, a);
    };
    expect(Math.abs(hue(fitted) - hue("#d97757"))).toBeLessThan(0.1);
  });

  it("inks text on every fitted accent at AA", () => {
    for (const { brandColor } of brands) {
      for (const appearance of ["light", "dark"] as const) {
        for (const id of ["mains", ...APP_THEME_PRESETS.map((p) => p.id)]) {
          const theme = resolveAppTheme(
            choice({ [appearance]: id, accent: "provider" }),
            brandColor!,
          );
          const css = renderAppThemeCss(theme);
          const accent = theme[appearance].accent!;
          const ink = css.match(
            new RegExp(
              `${appearance === "light" ? "html:not\\(\\.dark\\)" : "html\\.dark"} \\{[^}]*--color-accent-foreground: (#[0-9a-f]{6});`,
            ),
          )?.[1];
          expect(ink, `${brandColor} ${appearance} ${id}`).toBeDefined();
          expect(contrastRatio(ink!, accent)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
