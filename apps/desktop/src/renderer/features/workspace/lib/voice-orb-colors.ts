import type { CSSProperties } from "react";
import type { VoiceOrbColor } from "@mains/contracts/realtime";

type OrbColorStyle = CSSProperties & {
  "--color-voice-orb-deep"?: string;
  "--color-voice-orb-soft"?: string;
  "--color-voice-orb-light"?: string;
  "--color-voice-orb-secondary"?: string;
  "--color-voice-orb-tertiary"?: string;
};

export const VOICE_ORB_COLORS: Array<{
  value: VoiceOrbColor;
  label: string;
  colors?: [string, string, string];
  companions?: [string, string];
}> = [
  { value: "theme", label: "Theme" },
  { value: "blue", label: "Blue", colors: ["#245cdd", "#9abbfc", "#f1f6ff"], companions: ["#79d5d2", "#bea4f3"] },
  { value: "violet", label: "Violet", colors: ["#7c3aed", "#ccb8f9", "#f9f5ff"], companions: ["#93bff2", "#f2a8ce"] },
  { value: "rose", label: "Rose", colors: ["#dc435c", "#f2acbb", "#fff1f4"], companions: ["#f3b878", "#aaafe9"] },
  { value: "amber", label: "Amber", colors: ["#d97706", "#f5c987", "#fff8e7"], companions: ["#f28f91", "#f7dc86"] },
  { value: "mint", label: "Mint", colors: ["#078569", "#8bdcc2", "#effff7"], companions: ["#a3c9f5", "#f5dfa0"] },
];

export function voiceOrbColorStyle(color: VoiceOrbColor = "theme"): OrbColorStyle | undefined {
  const choice = VOICE_ORB_COLORS.find((choice) => choice.value === color);
  const colors = choice?.colors;
  if (!colors) return;
  return {
    "--color-voice-orb-deep": colors[0],
    "--color-voice-orb-soft": colors[1],
    "--color-voice-orb-light": colors[2],
    "--color-voice-orb-secondary": choice.companions?.[0],
    "--color-voice-orb-tertiary": choice.companions?.[1],
  };
}
