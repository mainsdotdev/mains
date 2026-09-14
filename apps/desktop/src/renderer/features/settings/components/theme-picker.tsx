import { useMemo } from "react";
import { Button, Select, Text } from "@/components/ui";
import { cn } from "@/lib/cn";
import { defaultTheme } from "@/lib/theme";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useDarkMode } from "@/hooks/use-dark-mode";

export type ThemeValue = "light" | "dark" | "system";

interface ThemePreviewCardProps {
  themeValue: ThemeValue;
  label: string;
  isSelected: boolean;
  onClick: () => void;
  lightBackground: string;
  darkBackground: string;
  size?: "sm" | "md" | "lg";
}

export function ThemePreviewCard({
  themeValue,
  label,
  isSelected,
  onClick,
  lightBackground,
  darkBackground,
  size = "md",
}: ThemePreviewCardProps) {
  const isLight = themeValue === "light";
  const isAuto = themeValue === "system";

  const getBackgroundStyle = (bg: string) => {
    if (bg.startsWith("linear-gradient")) {
      return { background: bg };
    }
    return { backgroundColor: bg };
  };

  const lightBgStyle = getBackgroundStyle(lightBackground);
  const darkBgStyle = getBackgroundStyle(darkBackground);

  const dimensions =
    size === "sm" ? "w-20 h-14" : size === "md" ? "w-24 h-16" : size === "lg" ? "w-36 h-24" : "w-64 h-32";

  return (
    <Button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 cursor-pointer group duration-200 transition-all"
    >
      <div
        className={cn(
          "relative rounded-xl overflow-hidden border transition-all duration-200",
          dimensions,
          isSelected
            ? "border-accent/40"
            : "glass-card",
        )}
      >
        {isAuto ? (
          <div className="w-full h-full flex">
            <div className="w-1/2 h-full flex">
              <div
                className="w-4 h-full flex flex-col p-1 gap-1"
                style={lightBgStyle}
              >
                <div className="w-2 h-2 bg-primary-950/10 rounded-full" />
                <div className="w-full h-1 bg-primary-950/10 rounded-full mt-1" />
                <div className="w-2/3 h-1 bg-primary-950/10 rounded-full" />
              </div>
              <div className="flex-1 h-full bg-primary-100 flex flex-col p-1.5">
                <div className="flex-1" />
                <div className="w-full h-2 bg-primary rounded-sm border border-primary-950/10" />
              </div>
            </div>
            <div className="w-1/2 h-full flex">
              <div
                className="w-4 h-full flex flex-col p-1 gap-1"
                style={darkBgStyle}
              >
                <div className="w-2 h-2 bg-primary/20 rounded-full" />
                <div className="w-full h-1 bg-primary/10 rounded-full mt-1" />
                <div className="w-2/3 h-1 bg-primary/10 rounded-full" />
              </div>
              <div className="flex-1 h-full flex bg-primary-950 flex-col p-1.5">
                <div className="flex-1" />
                <div className="w-full h-2 bg-primary/10 rounded-sm flex items-center justify-end pr-0.5" />
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex">
            <div
              className="w-5 h-full flex flex-col p-1.5 gap-1"
              style={isLight ? lightBgStyle : darkBgStyle}
            >
              <div
                className={cn(
                  "w-2 h-2 rounded-full",
                  isLight ? "bg-primary-950/10" : "bg-primary/10",
                )}
              />
              <div className="flex flex-col gap-0.5 mt-1">
                <div
                  className={cn(
                    "w-full h-1 rounded-full",
                    isLight ? "bg-primary-950/10" : "bg-primary/10",
                  )}
                />
                <div
                  className={cn(
                    "w-4/5 h-1 rounded-full",
                    isLight ? "bg-primary-950/10" : "bg-primary/10",
                  )}
                />
              </div>
            </div>
            <div
              className={`flex-1 h-full flex flex-col p-2 ${
                isLight ? "bg-primary-100" : "bg-primary-950"
              }`}
            >
              <div className="flex-1" />
              <div
                className={cn(
                  "w-full h-2 rounded-sm flex items-center px-1",
                  isLight
                    ? "bg-primary/80 border border-primary-950/10"
                    : "bg-primary/10",
                )}
              />
            </div>
          </div>
        )}
      </div>
      <Text
        as="span"
        size="s"
        weight="medium"
        tone={isSelected ? "default" : "subtle"}
        className={cn(
          "transition-colors",
          !isSelected &&
            "group-hover:text-primary-700 dark:group-hover:text-primary-300",
        )}
      >
        {label}
      </Text>
    </Button>
  );
}

export function useSpaceThemeBackgrounds() {
  const { activeSpace } = useActiveSpace();
  const activeSpaceThemeConfig = activeSpace?.themeConfig;

  return useMemo(() => {
    if (!activeSpaceThemeConfig) {
      return {
        lightBackground: defaultTheme.lightBackground.replace(
          /[0-9a-f]{2}$/i,
          "",
        ),
        darkBackground: defaultTheme.darkBackground.replace(
          /[0-9a-f]{2}$/i,
          "",
        ),
      };
    }
    try {
      const config = JSON.parse(activeSpaceThemeConfig);
      return {
        lightBackground: config.lightBackground || "#f5f3ee",
        darkBackground: config.darkBackground || "#1a1a1a",
      };
    } catch {
      return {
        lightBackground: "#f5f3ee",
        darkBackground: "#1a1a1a",
      };
    }
  }, [activeSpaceThemeConfig]);
}

const THEME_OPTIONS: { value: ThemeValue; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "system", label: "Auto" },
  { value: "dark", label: "Dark" },
];

/** Compact dropdown alternative to {@link ThemePicker} for narrow layouts. */
export function ThemeSelect({
  onChange,
}: {
  onChange?: (theme: ThemeValue) => void;
}) {
  const { theme, setTheme } = useDarkMode();
  return (
    <Select
      value={theme}
      aria-label="Theme"
      options={THEME_OPTIONS}
      onChange={(value) => {
        setTheme(value);
        onChange?.(value);
      }}
    />
  );
}

interface ThemePickerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  onChange?: (theme: ThemeValue) => void;
}

export function ThemePicker({
  size = "md",
  className,
  onChange,
}: ThemePickerProps) {
  const { theme, setTheme } = useDarkMode();
  const { lightBackground, darkBackground } = useSpaceThemeBackgrounds();

  const handleSelect = (value: ThemeValue) => {
    setTheme(value);
    onChange?.(value);
  };

  return (
    <div className={cn("flex gap-4", className)}>
      <ThemePreviewCard
        themeValue="light"
        label="Light"
        isSelected={theme === "light"}
        size={size}
        lightBackground={lightBackground}
        darkBackground={darkBackground}
        onClick={() => handleSelect("light")}
      />
      <ThemePreviewCard
        themeValue="system"
        label="Auto"
        isSelected={theme === "system"}
        size={size}
        lightBackground={lightBackground}
        darkBackground={darkBackground}
        onClick={() => handleSelect("system")}
      />
      <ThemePreviewCard
        themeValue="dark"
        label="Dark"
        isSelected={theme === "dark"}
        size={size}
        lightBackground={lightBackground}
        darkBackground={darkBackground}
        onClick={() => handleSelect("dark")}
      />
    </div>
  );
}
