import type { AppThemePreset, ThemePalette } from "./app-themes";

/**
 * The app theme presets offered in Settings › Appearance (`app-themes.ts`
 * resolves and paints them). Each is a family with a palette per appearance
 * it supports; Mains, the stock theme, has `null` for both — index.css as is.
 *
 * Palettes use the themes' published colours where there are some. Four
 * editor palettes set body text too light for UI copy, so their foreground is
 * the family's next-darker (or lighter) tone: Solarized light base02 for
 * base00, Solarized dark base1 for base0, Everforest light its dark bg1,
 * Kanagawa light lotusInk2 for lotusInk1. Names marked ≈ are brand or app
 * themes with no published palette, read off their interfaces.
 *
 * `contrast` is what each palette takes to keep secondary text at WCAG AA;
 * accents that sit under AA on their background are fitted when resolved
 * (`fitAccent`). `app-themes.test.ts` holds every entry to both.
 */

const palette = (
  background: string,
  foreground: string,
  accent: string,
  contrast = 0,
): ThemePalette => ({ background, foreground, accent, contrast });

export const DEFAULT_APP_THEME_ID = "mains";

/** Stock first, then alphabetical — the menu order. */
export const APP_THEME_PRESETS: readonly AppThemePreset[] = [
  {
    id: DEFAULT_APP_THEME_ID,
    name: "Mains",
    palettes: { light: null, dark: null },
  },
  {
    // ≈ Claude's own cream, slate and clay.
    id: "absolutely",
    name: "Absolutely",
    palettes: {
      light: palette("#faf9f5", "#141413", "#d97757"),
      dark: palette("#262624", "#f5f4ed", "#d97757"),
    },
  },
  {
    id: "ayu",
    name: "Ayu",
    palettes: { dark: palette("#0b0e14", "#bfbdb6", "#e6b450", 0.1) },
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    palettes: {
      light: palette("#eff1f5", "#4c4f69", "#8839ef", 1),
      dark: palette("#1e1e2e", "#cdd6f4", "#cba6f7"),
    },
  },
  {
    // ≈ dark.
    id: "codex",
    name: "Codex",
    palettes: {
      light: palette("#ffffff", "#0d0d0d", "#0169cc"),
      dark: palette("#111111", "#fcfcfc", "#339cff"),
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    palettes: { dark: palette("#282a36", "#f8f8f2", "#ff79c6") },
  },
  {
    id: "everforest",
    name: "Everforest",
    palettes: {
      light: palette("#fdf6e3", "#343f44", "#8da101", 0.55),
      dark: palette("#2d353b", "#d3c6aa", "#a7c080", 0.3),
    },
  },
  {
    id: "flexoki",
    name: "Flexoki",
    palettes: {
      light: palette("#fffcf0", "#100f0f", "#205ea6"),
      dark: palette("#100f0f", "#cecdc3", "#4385be"),
    },
  },
  {
    id: "github",
    name: "GitHub",
    palettes: {
      light: palette("#ffffff", "#1f2328", "#0969da", 0.15),
      dark: palette("#0d1117", "#e6edf3", "#4493f8"),
    },
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    palettes: {
      light: palette("#fbf1c7", "#3c3836", "#076678", 0.6),
      dark: palette("#282828", "#ebdbb2", "#83a598"),
    },
  },
  {
    // Lotus light, Wave dark.
    id: "kanagawa",
    name: "Kanagawa",
    palettes: {
      light: palette("#f2ecbc", "#43436c", "#4d699b", 0.8),
      dark: palette("#1f1f28", "#dcd7ba", "#7e9cd8"),
    },
  },
  {
    // ≈
    id: "linear",
    name: "Linear",
    palettes: {
      light: palette("#fcfcfd", "#1c1d21", "#5e6ad2", 0.1),
      dark: palette("#0f1011", "#f7f8f8", "#5e6ad2"),
    },
  },
  {
    // ≈
    id: "lobster",
    name: "Lobster",
    palettes: { dark: palette("#141625", "#e4e4ef", "#ff5f5f") },
  },
  {
    id: "material",
    name: "Material",
    palettes: { dark: palette("#263238", "#eeffff", "#80cbc4") },
  },
  {
    // ≈
    id: "matrix",
    name: "Matrix",
    palettes: { dark: palette("#050a06", "#a8f0b8", "#22e55a") },
  },
  {
    id: "monokai",
    name: "Monokai",
    palettes: { dark: palette("#272822", "#f8f8f2", "#a6e22e") },
  },
  {
    id: "night-owl",
    name: "Night Owl",
    palettes: {
      // Light Owl.
      light: palette("#fbfbfb", "#403f53", "#4876d6", 0.55),
      dark: palette("#011627", "#d6deeb", "#82aaff"),
    },
  },
  {
    // Dayfox light, Nightfox dark.
    id: "nightfox",
    name: "Nightfox",
    palettes: {
      light: palette("#f6f2ee", "#3d2b5a", "#2848a9", 0.4),
      dark: palette("#192330", "#cdcecf", "#719cd6"),
    },
  },
  {
    id: "nord",
    name: "Nord",
    palettes: { dark: palette("#2e3440", "#d8dee9", "#88c0d0") },
  },
  {
    // ≈
    id: "notion",
    name: "Notion",
    palettes: {
      light: palette("#ffffff", "#37352f", "#2383e2", 0.35),
      dark: palette("#191919", "#d4d4d4", "#2383e2"),
    },
  },
  {
    id: "one",
    name: "One",
    palettes: {
      light: palette("#fafafa", "#383a42", "#4078f2", 0.45),
      dark: palette("#282c34", "#abb2bf", "#61afef", 0.5),
    },
  },
  {
    // ≈
    id: "oscurange",
    name: "Oscurange",
    palettes: { dark: palette("#0b0b0f", "#e6e6e6", "#f5a468") },
  },
  {
    // ≈
    id: "proof",
    name: "Proof",
    palettes: { light: palette("#f4f3ee", "#1f2421", "#3f6f55", 0.2) },
  },
  {
    // ≈
    id: "raycast",
    name: "Raycast",
    palettes: {
      light: palette("#ffffff", "#121212", "#ff6363"),
      dark: palette("#111111", "#eeeeee", "#ff6363"),
    },
  },
  {
    id: "rose-pine",
    name: "Rose Pine",
    palettes: {
      light: palette("#faf4ed", "#575279", "#d7827e", 1),
      dark: palette("#191724", "#e0def4", "#ebbcba"),
    },
  },
  {
    // ≈
    id: "sentry",
    name: "Sentry",
    palettes: { dark: palette("#1a1523", "#ebe6ef", "#7553ff") },
  },
  {
    id: "solarized",
    name: "Solarized",
    palettes: {
      light: palette("#fdf6e3", "#073642", "#b58900", 0.35),
      dark: palette("#002b36", "#93a1a1", "#dc322f", 0.75),
    },
  },
  {
    // ≈
    id: "temple",
    name: "Temple",
    palettes: { dark: palette("#07140d", "#e5e4c9", "#e3e34f") },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    palettes: { dark: palette("#1a1b26", "#a9b1d6", "#7aa2f7", 0.3) },
  },
  {
    // ≈
    id: "vercel",
    name: "Vercel",
    palettes: {
      light: palette("#ffffff", "#171717", "#0070f3"),
      dark: palette("#0a0a0a", "#ededed", "#0070f3"),
    },
  },
  {
    // VS Code's Light+ / Dark+.
    id: "vscode-plus",
    name: "VS Code Plus",
    palettes: {
      light: palette("#ffffff", "#1f1f1f", "#005fb8", 0.1),
      dark: palette("#1e1e1e", "#d4d4d4", "#007acc"),
    },
  },
  {
    id: "xcode",
    name: "Xcode",
    palettes: {
      light: palette("#ffffff", "#000000", "#0e0eff"),
      dark: palette("#1f1f24", "#dfdfe0", "#6699ff"),
    },
  },
];
