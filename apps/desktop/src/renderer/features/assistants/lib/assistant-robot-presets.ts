import { ASSISTANT_ROBOT_AVATARS } from "@mains/contracts/assistants";
import type { AssistantAvatar, AssistantRobotShape } from "@mains/contracts/assistants";

export const DEFAULT_ROBOT_AVATAR = { shape: "terminal-amber", color: ASSISTANT_ROBOT_AVATARS["terminal-amber"] } as const satisfies AssistantAvatar;

export const ROBOT_STYLES = ["terminal", "clear", "metal"] as const;
export type RobotStyle = typeof ROBOT_STYLES[number];

export const ROBOT_STYLE_LABELS: Record<RobotStyle, string> = {
  terminal: "Retro Terminal",
  clear: "Clear Shell",
  metal: "One-Eye Metal",
};

export const ROBOT_PRESETS = {
  "terminal-amber": { style: "terminal", label: "Amber" },
  "terminal-teal": { style: "terminal", label: "Teal" },
  "terminal-cherry": { style: "terminal", label: "Cherry" },
  "terminal-indigo": { style: "terminal", label: "Indigo" },
  "terminal-plum": { style: "terminal", label: "Plum" },
  "terminal-olive": { style: "terminal", label: "Olive" },
  "terminal-frost": { style: "terminal", label: "Frost" },
  "clear-violet": { style: "clear", label: "Violet Drop" },
  "clear-glacier": { style: "clear", label: "Glacier Dome" },
  "clear-jade": { style: "clear", label: "Jade Tile" },
  "clear-rose": { style: "clear", label: "Rose Prism" },
  "clear-honey": { style: "clear", label: "Honey Lantern" },
  "clear-lime": { style: "clear", label: "Lime Capsule" },
  "clear-coral": { style: "clear", label: "Coral Kite" },
  "metal-silver": { style: "metal", label: "Silver" },
  "metal-bronze": { style: "metal", label: "Bronze" },
  "metal-graphite": { style: "metal", label: "Graphite" },
  "metal-titanium": { style: "metal", label: "Titanium" },
  "metal-copper": { style: "metal", label: "Copper" },
  "metal-ice": { style: "metal", label: "Ice Disc" },
  "metal-moss": { style: "metal", label: "Moss Shield" },
} as const satisfies Record<AssistantRobotShape, { style: RobotStyle; label: string }>;

const shapes = Object.keys(ROBOT_PRESETS) as AssistantRobotShape[];
export const ROBOT_SHAPES_BY_STYLE = {
  terminal: shapes.filter(shape => ROBOT_PRESETS[shape].style === "terminal"),
  clear: shapes.filter(shape => ROBOT_PRESETS[shape].style === "clear"),
  metal: shapes.filter(shape => ROBOT_PRESETS[shape].style === "metal"),
};
