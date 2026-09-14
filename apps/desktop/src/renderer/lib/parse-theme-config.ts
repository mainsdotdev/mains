/**
 * Wire shape of the `space.themeConfig` JSON blob. Stored as a string in DB;
 * hooks/components read the parsed form via `parseThemeConfig`. Every field
 * optional because the blob may be partial / legacy.
 */
export interface ParsedThemeConfig {
  /** Legacy single-color field (pre dark/light split) */
  backgroundColor?: string;
  /** Background colour applied in light mode */
  lightBackground?: string;
  /** Background colour applied in dark mode */
  darkBackground?: string;
  /** User-message bubble background — light mode */
  lightUserMessageBackground?: string;
  /** User-message bubble background — dark mode */
  darkUserMessageBackground?: string;
  /** Nested format used by predefined-space seeds */
  light?: { value: string; preview?: string };
  dark?: { value: string; preview?: string };
}

/**
 * Parses the JSON blob stored in `space.themeConfig`. Returns `{}` for
 * missing, malformed, or null input so callers can read with optional
 * chaining safely.
 */
export function parseThemeConfig(
  raw: string | null | undefined,
): ParsedThemeConfig {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ParsedThemeConfig;
  } catch (err) {
    console.error("Failed to parse space themeConfig:", err);
    return {};
  }
}
