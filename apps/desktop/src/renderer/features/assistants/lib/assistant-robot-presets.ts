import { ASSISTANT_ROBOT_AVATARS } from "@mains/contracts/assistants";
import type { AssistantAvatar, AssistantRobotShape } from "@mains/contracts/assistants";

export const DEFAULT_ROBOT_AVATAR = { shape: "terminal-amber", color: ASSISTANT_ROBOT_AVATARS["terminal-amber"] } as const satisfies AssistantAvatar;

export const ROBOT_STYLES = ["terminal", "metal", "specialists"] as const;
export type RobotStyle = typeof ROBOT_STYLES[number];

export const ROBOT_STYLE_LABELS: Record<RobotStyle, string> = {
  terminal: "Retro Terminal",
  metal: "One-Eye Metal",
  specialists: "Specialists",
};

export const ROBOT_PRESETS = {
  "terminal-amber": { style: "terminal", label: "Amber" },
  "terminal-teal": { style: "terminal", label: "Teal" },
  "terminal-cherry": { style: "terminal", label: "Cherry" },
  "terminal-indigo": { style: "terminal", label: "Indigo" },
  "terminal-plum": { style: "terminal", label: "Plum" },
  "terminal-olive": { style: "terminal", label: "Olive" },
  "terminal-frost": { style: "terminal", label: "Frost" },
  "metal-silver": { style: "metal", label: "Silver" },
  "metal-bronze": { style: "metal", label: "Bronze" },
  "metal-graphite": { style: "metal", label: "Graphite" },
  "metal-titanium": { style: "metal", label: "Titanium" },
  "metal-copper": { style: "metal", label: "Copper" },
  "metal-ice": { style: "metal", label: "Ice Disc" },
  "metal-moss": { style: "metal", label: "Moss Shield" },
  "specialist-travel": { style: "specialists", label: "Travel Planner" },
  "specialist-kitchen": { style: "specialists", label: "Kitchen Mate" },
  "specialist-cloud": { style: "specialists", label: "Cloud Specialist" },
  "specialist-law": { style: "specialists", label: "Lawyer" },
  "specialist-sports": { style: "specialists", label: "Sports Mate" },
  "specialist-writer": { style: "specialists", label: "Writer" },
  "specialist-research": { style: "specialists", label: "Researcher" },
  "specialist-finance": { style: "specialists", label: "Finance Mate" },
  "specialist-design": { style: "specialists", label: "Designer" },
  "specialist-developer": { style: "specialists", label: "Developer" },
  "specialist-photo": { style: "specialists", label: "Photographer" },
  "specialist-garden": { style: "specialists", label: "Gardener" },
  "specialist-music": { style: "specialists", label: "Music Mate" },
  "specialist-language": { style: "specialists", label: "Language Mate" },
  "specialist-projects": { style: "specialists", label: "Project Manager" },
  "specialist-beach-palm": { style: "specialists", label: "Beach Palm" },
} as const satisfies Record<AssistantRobotShape, { style: RobotStyle; label: string }>;

const shapes = Object.keys(ROBOT_PRESETS) as AssistantRobotShape[];
export const ROBOT_SHAPES_BY_STYLE = {
  terminal: shapes.filter(shape => ROBOT_PRESETS[shape].style === "terminal"),
  metal: shapes.filter(shape => ROBOT_PRESETS[shape].style === "metal"),
  specialists: shapes.filter(shape => ROBOT_PRESETS[shape].style === "specialists"),
} satisfies Record<RobotStyle, AssistantRobotShape[]>;
