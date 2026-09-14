import { ComponentType, SVGProps } from "react";
import * as Icons from "@/components/ui/icons/space";
import { Codex, Cursor } from "@/components/ui/icons";

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export const iconRegistry: Record<string, IconComponent> = {

  basketball: Icons.Basketball,
  bolt: Icons.Bolt,
  broadcast: Icons.Broadcast,
  chat: Icons.Chat,
  cloud: Icons.Cloud,
  code: Icons.Code,
  compass: Icons.Compass,
  earth: Icons.Earth,
  gallery: Icons.Gallery,
  globe: Icons.Globe,
  heart: Icons.Heart,
  home: Icons.Home,
  incognito: Icons.Incognito,
  mitts: Icons.Mitts,
  star: Icons.Star,
  sun: Icons.Sun,
  user: Icons.User,
  vinyl: Icons.Vinyl,
  album: Icons.Album,
  asteroid: Icons.Asteroid,
  atom: Icons.Atom,
  bell: Icons.Bell,
  bicycle: Icons.Bicycle,
  bag: Icons.Bag,
  box: Icons.Box,
  bug: Icons.Bug,
  cat: Icons.Cat,
  chefhat: Icons.Chefhat,
  clapperboard: Icons.Clapperboard,
  clipboard: Icons.Clipboard,
  clock: Icons.Clock,
  colortune: Icons.Colortune,
  confetti: Icons.Confetti,
  dna: Icons.Dna,
  document: Icons.Document,
  filters: Icons.Filters,
  ghost: Icons.Ghost,
  glasses: Icons.Glasses,
  layers: Icons.Layers,
  lightbulb: Icons.Lightbulb,
  moon: Icons.Moon,
  music: Icons.Music,
  notebook: Icons.Notebook,
  notification: Icons.Notification,
  palette: Icons.Palette,
  play: Icons.Play,
  pointer: Icons.Pointer,
  smartphone: Icons.Smartphone,
  teacup: Icons.Teacup,
  world: Icons.World,
  academy: Icons.Academy,
  backpack: Icons.Backpack,
  bookmark: Icons.Bookmark,
  calendar: Icons.Calendar,
  dumbbell: Icons.Dumbbell,
  gamepad: Icons.Gamepad,
  price: Icons.Price,
  rocket: Icons.Rocket,
  scan: Icons.Scan,
  smile: Icons.Smile,



  claude: Icons.Claude,
  copilot: Icons.Copilot,
  codex: Codex,
  cursor: Cursor,
};

/**
 * Provider brand marks. They stay in `iconRegistry` so already-saved values
 * (`icon:claude`, …) keep resolving through `parseIcon`, but they are not
 * offered as manual choices — a provider mark on a project or space would read
 * as a runtime badge rather than a user-picked icon.
 */
const providerIconNames = new Set(["claude", "copilot", "codex", "cursor"]);

/** Icons offered in the icon picker grid. */
export const availableIcons = Object.entries(iconRegistry)
  .filter(([name]) => !providerIconNames.has(name))
  .map(([name, component]) => ({
    name,
    component,
  }));

export interface IconColorOption {
  name: string;
  label: string;
  /** Class for the swatch dot in the picker. */
  swatch: string;
  /** Class applied to the rendered icon; empty means "inherit the call site". */
  className: string;
}

/**
 * Tints available for registry icons (emoji carry their own color). Stored as a
 * name rather than a hex value so each tint can resolve differently in light and
 * dark themes instead of turning invisible in one of them.
 *
 * Deliberately plain palette colours rather than the semantic tokens
 * (`danger`/`warning`/`success`/`accent`): an icon tint is decoration, and
 * borrowing the state colours both ties a user's pink project to whatever
 * "danger" becomes and reads louder than a picked colour should. The names are
 * stable — only the shades moved — so icons already saved keep resolving.
 */
export const ICON_COLORS: IconColorOption[] = [
  {
    name: "default",
    label: "Default",
    swatch: "bg-primary-900 dark:bg-primary-100",
    className: "",
  },
  {
    name: "pink",
    label: "Pink",
    swatch: "bg-pink-500",
    className: "text-pink-600 dark:text-pink-500",
  },
  {
    name: "red",
    label: "Red",
    swatch: "bg-red-400",
    className: "text-red-500 dark:text-red-400",
  },
  {
    name: "orange",
    label: "Orange",
    swatch: "bg-orange-400",
    className: "text-orange-500 dark:text-orange-400",
  },
  {
    name: "amber",
    label: "Yellow",
    swatch: "bg-amber-300",
    className: "text-amber-500 dark:text-amber-300",
  },
  {
    name: "green",
    label: "Green",
    swatch: "bg-lime-400",
    className: "text-lime-500 dark:text-lime-400",
  },
  {
    name: "blue",
    label: "Blue",
    swatch: "bg-blue-400",
    className: "text-blue-500 dark:text-blue-400",
  },
  {
    name: "purple",
    label: "Purple",
    swatch: "bg-indigo-500",
    className: "text-indigo-500 dark:text-indigo-400",
  }
];

export const DEFAULT_ICON_COLOR = "default";

/** Text class for a stored color name; empty for default / unknown values. */
export function iconColorClass(color: string | null | undefined): string {
  if (!color) return "";
  return ICON_COLORS.find((c) => c.name === color)?.className ?? "";
}

/** What an untinted registry icon is drawn in. */
export const NEUTRAL_ICON_CLASS = "text-primary-700 dark:text-primary-300";

/**
 * The class to render a registry icon with. Unlike `iconColorClass`, never
 * empty: the default tint carries no class of its own, and an icon left with
 * no color at all inherits whatever the surrounding surface happens to be —
 * which is how a white-tinted icon ends up drawn near-black on a dark panel.
 */
export function iconTintClass(color: string | null | undefined): string {
  return iconColorClass(color) || NEUTRAL_ICON_CLASS;
}

type ParsedIcon =
  | { type: "emoji"; value: string }
  | { type: "icon"; value: IconComponent; color?: string };

/** Splits the stored `<name>|<color>` form; color is optional. */
function splitIconToken(token: string): { name: string; color?: string } {
  const [name, color] = token.split("|");
  return {
    name: name.trim().toLowerCase(),
    color: color?.trim().toLowerCase() || undefined,
  };
}

/**
 * The inverse of `formatIcon`: splits a stored value into the three fields an
 * icon picker edits. Lives here next to its counterpart so the two forms of the
 * same string can't drift apart.
 */
export function splitStoredIcon(stored: string | null | undefined): {
  value: string;
  mode: "emoji" | "icon";
  color: string;
} {
  if (!stored) return { value: "", mode: "emoji", color: DEFAULT_ICON_COLOR };
  if (stored.startsWith("emoji:")) {
    return {
      value: stored.slice("emoji:".length),
      mode: "emoji",
      color: DEFAULT_ICON_COLOR,
    };
  }
  const token = stored.startsWith("icon:") ? stored.slice("icon:".length) : stored;
  const { name, color } = splitIconToken(token);
  // A bare value that names no registry icon is a legacy raw emoji.
  if (!stored.startsWith("icon:") && !iconRegistry[name]) {
    return { value: stored, mode: "emoji", color: DEFAULT_ICON_COLOR };
  }
  return { value: name, mode: "icon", color: color ?? DEFAULT_ICON_COLOR };
}

/**
 * What a picked value *is*, read off the value itself rather than off whichever
 * tab the picker happens to be showing. Registry names ("rocket") are icons;
 * everything else is an emoji. The two are separate questions — a user can pick
 * an emoji and then browse the icon tab — and storing the tab's answer is how
 * `emoji:rocket` and `icon:🚀` get written.
 */
export function iconKindOf(value: string | null | undefined): "emoji" | "icon" {
  return value && iconRegistry[value] ? "icon" : "emoji";
}

/**
 * Builds the value persisted in the `icon` column. The default tint is omitted
 * so untinted icons keep the original `icon:<name>` form.
 */
export function formatIcon(
  mode: "emoji" | "icon",
  value: string,
  color?: string,
): string | null {
  if (!value) return null;
  if (mode === "emoji") return `emoji:${value}`;
  return color && color !== DEFAULT_ICON_COLOR
    ? `icon:${value}|${color}`
    : `icon:${value}`;
}

export function parseIcon(iconString: string | null | undefined): ParsedIcon {
  if (!iconString) {
    return { type: "emoji", value: "💬" };
  }

  if (iconString.startsWith("icon:")) {
    const { name, color } = splitIconToken(iconString.slice("icon:".length));
    const Icon = iconRegistry[name];
    return Icon
      ? { type: "icon", value: Icon, color }
      : { type: "emoji", value: "⌘" };
  }

  if (iconString.startsWith("emoji:")) {
    return { type: "emoji", value: iconString.slice("emoji:".length) };
  }

  const { name, color } = splitIconToken(iconString);
  const Icon = iconRegistry[name];
  if (Icon) return { type: "icon", value: Icon, color };

  return { type: "emoji", value: iconString };
}

export default iconRegistry;
