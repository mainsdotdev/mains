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
  editAppearanceChoice,
  fitAccent,
  paintedPalette,
  parseAppThemeSettings,
  parseThemePalette,
  renderAppThemeCss,
  resolveAppTheme,
  resolveAppearance,
  serializeThemePalette,
  themeChoiceFor,
  type AppThemeSettings,
  type AppearanceChoice,
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
  const scale = new Map<string, string>();
  for (const [, name, value] of indexCss.matchAll(
    /^\s*(--color-primary(?:-\d+)?):\s*(#[0-9a-fA-F]{6});/gm,
  )) {
    scale.set(name, value);
  }
  return scale;
}

/** An appearance choice of `theme`, with no edits unless given. */
const pick = (
  theme: string,
  edits: Partial<AppearanceChoice> = {},
): AppearanceChoice => ({ theme, accent: "theme", ...edits });

const stock = pick(DEFAULT_APP_THEME_ID);

const both = (choice: AppearanceChoice): ThemeChoice => ({
  light: choice,
  dark: choice,
});

/** The token block one appearance renders, as a map; `null` when it renders none. */
function tokensIn(css: string, appearance: ThemeAppearance) {
  const selector = appearance === "light" ? "html:not(.dark) {" : "html.dark {";
  const start = css.indexOf(selector);
  if (start < 0) return null;
  const block = css.slice(start, css.indexOf("}", start));
  return new Map(
    [...block.matchAll(/^\s*(--[\w-]+): (.+);$/gm)].map(([, n, v]) => [n, v]),
  );
}

const palettes = APP_THEME_PRESETS.flatMap((preset) =>
  (Object.entries(preset.palettes) as [ThemeAppearance, ThemePalette | null][])
    .filter((entry): entry is [ThemeAppearance, ThemePalette] => !!entry[1])
    .map(([appearance, palette]) => ({
      id: preset.id,
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
      const measured =
        (white - oklabLightness(scale.get(name)!)) / (white - black);
      expect(measured, name).toBeCloseTo(position, 2);
    }
  });
});

describe("resolveAppTheme", () => {
  it("leaves both appearances on the stock scale by default", () => {
    const theme = resolveAppTheme(DEFAULT_APP_THEME_SETTINGS.default, null);
    expect(theme.light).toEqual({
      palette: null,
      accent: null,
      translucent: true,
    });
    expect(renderAppThemeCss(theme)).toBe("");
  });

  it("falls back to stock for unknown ids and appearances a theme lacks", () => {
    const theme = resolveAppTheme(
      { light: pick("tokyo-night"), dark: pick("removed") },
      null,
    );
    expect(theme.light.palette).toBeNull();
    expect(theme.dark.palette).toBeNull();
  });

  it("picks each appearance's palette independently", () => {
    const css = renderAppThemeCss(
      resolveAppTheme(
        { light: pick("gruvbox"), dark: pick("tokyo-night") },
        null,
      ),
    );
    expect(tokensIn(css, "light")?.get("--color-primary")).toBe("#fbf1c7");
    expect(tokensIn(css, "dark")?.get("--color-primary-950")).toBe("#1a1b26");
  });

  it("keeps the theme accent when a provider has no brand colour", () => {
    const theme = resolveAppTheme(
      both(pick(DEFAULT_APP_THEME_ID, { accent: "provider" })),
      null,
    );
    expect(theme.dark.accent).toBeNull();
    expect(renderAppThemeCss(theme)).toBe("");
  });

  it("puts a provider accent over the stock scale without deriving one", () => {
    const css = renderAppThemeCss(
      resolveAppTheme(
        both(pick(DEFAULT_APP_THEME_ID, { accent: "provider" })),
        "#d97757",
      ),
    );
    const light = tokensIn(css, "light")!;
    expect(light.has("--color-accent")).toBe(true);
    expect(light.has("--color-primary")).toBe(false);
    expect(light.has("--app-frame")).toBe(false);
  });

  it("swaps a provider accent into a theme's tokens", () => {
    const theme = resolveAppTheme(
      { light: stock, dark: pick("tokyo-night", { accent: "provider" }) },
      "#d97757",
    );
    const dark = tokensIn(renderAppThemeCss(theme), "dark")!;
    expect(dark.get("--color-accent")).toBe(theme.dark.accent);
    expect(dark.get("--color-accent")).not.toBe("#7aa2f7");
    expect(dark.get("--color-primary-950")).toBe("#1a1b26");
  });

  it("paints a custom accent as picked, without fitting it", () => {
    const dim = "#303040";
    const theme = resolveAppTheme(
      both(pick("tokyo-night", { accent: "custom", accentColor: dim })),
      "#d97757",
    );
    expect(theme.dark.accent).toBe(dim);
  });

  it("derives a scale from stock once one of its colours is edited", () => {
    const theme = resolveAppTheme(
      { light: pick(DEFAULT_APP_THEME_ID, { background: "#f4efe6" }), dark: stock },
      null,
    );
    expect(theme.light.palette?.foreground).toBe("#0c0c0c");
    const css = renderAppThemeCss(theme);
    expect(tokensIn(css, "light")?.get("--color-primary")).toBe("#f4efe6");
    expect(tokensIn(css, "dark")).toBeNull();
  });

  it("keeps a theme's frame opaque unless asked, and stock's translucent", () => {
    const frameOf = (choice: AppearanceChoice, appearance: ThemeAppearance) =>
      tokensIn(renderAppThemeCss(resolveAppTheme(both(choice), null)), appearance);

    expect(frameOf(pick("tokyo-night"), "dark")?.get("--app-frame")).toMatch(
      /^#[0-9a-f]{6}$/,
    );
    expect(
      frameOf(pick("tokyo-night", { translucent: true }), "dark")?.get(
        "--app-frame",
      ),
    ).toContain("transparent");
    // Stock paints nothing until its frame is made opaque — then only that.
    expect(frameOf(stock, "light")).toBeNull();
    expect([
      ...frameOf(pick(DEFAULT_APP_THEME_ID, { translucent: false }), "light")!.keys(),
    ]).toEqual(["--app-frame"]);
  });
});

describe("theme settings", () => {
  const settings: AppThemeSettings = {
    default: { light: stock, dark: pick("tokyo-night") },
    providers: { codex: { dark: pick("gruvbox", { accent: "provider" }) } },
  };

  it("lets a provider take over one appearance at a time", () => {
    expect(themeChoiceFor(settings, "codex")).toEqual({
      light: stock,
      dark: pick("gruvbox", { accent: "provider" }),
    });
    expect(themeChoiceFor(settings, "claude_code")).toEqual(settings.default);
    expect(themeChoiceFor(settings, null)).toEqual(settings.default);
  });

  it("hands an appearance back on null, dropping an entry left empty", () => {
    const cleared = applyThemeChoice(settings, {
      providerId: "codex",
      appearance: "dark",
      choice: null,
    });
    expect(cleared.providers).toEqual({});
  });

  it("edits the default, which has nothing to clear back to", () => {
    const edited = applyThemeChoice(settings, {
      providerId: null,
      appearance: "light",
      choice: pick("catppuccin"),
    });
    expect(edited.default.light.theme).toBe("catppuccin");
    expect(edited.providers).toBe(settings.providers);

    expect(
      applyThemeChoice(settings, {
        providerId: null,
        appearance: "dark",
        choice: null,
      }),
    ).toBe(settings);
  });

  it("drops edits set back to undefined instead of storing holes", () => {
    const edited = editAppearanceChoice(
      pick("gruvbox", { background: "#ffffff" }),
      { background: undefined, contrast: 0.4 },
    );
    expect(edited).toEqual(pick("gruvbox", { contrast: 0.4 }));
    expect("background" in edited).toBe(false);
  });
});

describe("parseAppThemeSettings", () => {
  it("reads the current shape back unchanged", () => {
    const settings: AppThemeSettings = {
      default: {
        light: pick("gruvbox", { contrast: 0.2, translucent: true }),
        dark: pick("tokyo-night", { accent: "custom", accentColor: "#ff00aa" }),
      },
      providers: { codex: { light: pick("catppuccin") } },
    };
    expect(
      parseAppThemeSettings(JSON.parse(JSON.stringify(settings))),
    ).toEqual(settings);
  });

  it("migrates the first release's theme ids and scope-wide accent", () => {
    const migrated = parseAppThemeSettings({
      default: { light: "gruvbox", dark: "tokyo-night", accent: "provider" },
      providers: {
        codex: { dark: "catppuccin" },
        claude_code: { accent: "theme" },
      },
    });
    expect(migrated.default).toEqual({
      light: pick("gruvbox", { accent: "provider" }),
      dark: pick("tokyo-night", { accent: "provider" }),
    });
    // A provider's lone theme keeps the default's accent source.
    expect(migrated.providers.codex).toEqual({
      dark: pick("catppuccin", { accent: "provider" }),
    });
    // A lone accent applies over the default's themes.
    expect(migrated.providers.claude_code).toEqual({
      light: pick("gruvbox"),
      dark: pick("tokyo-night"),
    });
  });

  it("drops malformed fields and falls back on unreadable blobs", () => {
    expect(parseAppThemeSettings(null)).toBe(DEFAULT_APP_THEME_SETTINGS);
    expect(parseAppThemeSettings("tokyo-night")).toBe(
      DEFAULT_APP_THEME_SETTINGS,
    );
    const cleaned = parseAppThemeSettings({
      default: {
        light: {
          theme: "gruvbox",
          accent: "theme",
          background: "red",
          contrast: 7,
        },
        dark: { theme: "tokyo-night", accent: "rainbow" },
      },
      providers: { codex: "gruvbox" },
    });
    expect(cleaned.default.light).toEqual(pick("gruvbox", { contrast: 1 }));
    expect(cleaned.default.dark).toEqual(stock);
    expect(cleaned.providers).toEqual({});
  });
});

describe("Copy theme / Import", () => {
  it("round-trips what an appearance paints", () => {
    const painted = paintedPalette(
      resolveAppearance(pick("tokyo-night"), "dark", null),
      "dark",
    );
    expect(parseThemePalette(serializeThemePalette(painted))).toEqual(painted);
  });

  it("takes any subset of the keys, and rejects what carries none", () => {
    expect(parseThemePalette('{"accent":"#FF00AA","contrast":40}')).toEqual({
      accent: "#ff00aa",
      contrast: 0.4,
    });
    expect(parseThemePalette('{"accent":"hotpink"}')).toBeNull();
    expect(parseThemePalette("not json")).toBeNull();
    expect(parseThemePalette("[1,2]")).toBeNull();
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
    for (const name of [
      "--color-primary-800",
      "--color-primary-900",
      "--color-primary-950",
    ]) {
      expect(lifted[name], name).toBe(flat[name]);
    }
    expect(
      contrastRatio(lifted["--color-primary-400"], palette.background),
    ).toBeGreaterThan(
      contrastRatio(flat["--color-primary-400"], palette.background),
    );
  });
});

describe.each(palettes)("$label", ({ id, appearance, palette }) => {
  // Through the real path, so the fitted accent is what's checked.
  const tokens = tokensIn(
    renderAppThemeCss(resolveAppTheme(both(pick(id)), null)),
    appearance,
  )!;
  // Light mode sets copy on `bg-primary`, dark mode on `bg-primary-950`; the
  // secondary tier is `text-primary-600` / `dark:text-primary-400`.
  const surface = palette.background;
  const secondaryText = tokens.get(
    appearance === "light" ? "--color-primary-600" : "--color-primary-400",
  )!;
  const accent = tokens.get("--color-accent")!;

  it("keeps secondary text at WCAG AA", () => {
    expect(contrastRatio(secondaryText, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the accent readable as text", () => {
    expect(contrastRatio(accent, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps text on the accent at WCAG AA", () => {
    expect(
      contrastRatio(tokens.get("--color-accent-foreground")!, accent),
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
        for (const { id } of appThemesFor(appearance)) {
          const theme = resolveAppTheme(
            both(pick(id, { accent: "provider" })),
            brandColor!,
          );
          const ink = tokensIn(renderAppThemeCss(theme), appearance)?.get(
            "--color-accent-foreground",
          );
          expect(ink, `${brandColor} ${appearance} ${id}`).toBeDefined();
          expect(
            contrastRatio(ink!, theme[appearance].accent!),
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
