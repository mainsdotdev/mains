const COLORS = {
  light: {
    background: "#ffffffb3",
    dropdown: "rgb(255 255 255)",
  },
  dark: {
    background: "#00000070",
    dropdown: "rgb(17 24 39)",
  },
} as const;

const DEFAULT_DROPDOWN_OPACITY = 0.99;

export interface DefaultThemeConfig {
  lightBackground: string;
  darkBackground: string;
  lightDropdownBackground: string;
  darkDropdownBackground: string;
  dropdownOpacity: number;
}

export const defaultTheme: DefaultThemeConfig = {
  lightBackground: COLORS.light.background,
  darkBackground: COLORS.dark.background,
  lightDropdownBackground: COLORS.light.dropdown,
  darkDropdownBackground: COLORS.dark.dropdown,
  dropdownOpacity: DEFAULT_DROPDOWN_OPACITY,
};

export const getDefaultBackground = (isDarkMode: boolean): string =>
  isDarkMode ? COLORS.dark.background : COLORS.light.background;

export const getDefaultDropdownBackground = (
  isDarkMode: boolean,
  opacity = DEFAULT_DROPDOWN_OPACITY,
): string => {
  const { dropdown } = isDarkMode ? COLORS.dark : COLORS.light;
  return dropdown.replace(")", ` / ${opacity})`);
};
