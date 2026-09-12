import type { ColorValue } from "react-native";
import Svg, { Circle, Defs, Mask, Path } from "react-native-svg";

import { colors, useBrandColors } from "@/theme";

/**
 * Status colors, borrowed from the desktop (`workspace-status.ts` over
 * `index.css`): warning / success / danger are its literal values so a
 * workspace reads the same on both screens.
 */
const WARNING = "#F59E0B";
const SUCCESS = "#22C55E";
const DANGER = "#ff4436";

/** The desktop's status glyphs (`components/ui/icons/status-*.tsx`), on a 16-unit grid. */
export function WorkspaceStatusIcon({ status, size = 16 }: { status: string | null | undefined; size?: number }) {
  const brand = useBrandColors();
  const tint: ColorValue = (() => {
    switch (status) {
      case "in_progress":
        return WARNING;
      case "in_review":
        return SUCCESS;
      case "done":
        return brand.accent;
      case "canceled":
        return DANGER;
      case "duplicate":
        return colors.secondaryLabel;
      default:
        return colors.label;
    }
  })();

  switch (status) {
    case "backlog":
      return (
        <Svg width={size} height={size} viewBox="0 0 16 16">
          <Circle cx={8} cy={8} r={6.25} stroke={tint} strokeWidth={2} strokeDasharray="1.5 1.77" fill="none" />
        </Svg>
      );
    case "in_progress":
      return (
        <Svg width={size} height={size} viewBox="0 0 16 16">
          <Circle cx={8} cy={8} r={6.25} stroke={tint} strokeWidth={1.75} fill="none" />
          <Path fill={tint} d="M8 3.75a4.25 4.25 0 0 1 0 8.5V3.75Z" />
        </Svg>
      );
    case "in_review":
      return (
        <Svg width={size} height={size} viewBox="0 0 16 16">
          <Circle cx={8} cy={8} r={6.25} stroke={tint} strokeWidth={1.75} fill="none" />
          <Path fill={tint} d="M8 3.75a4.25 4.25 0 1 1-4.25 4.25H8V3.75Z" />
        </Svg>
      );
    case "done":
      return (
        <MaskedDisc tint={tint} size={size}>
          <Path d="m4.25 8.25 2.5 2.25 5-4.75" stroke="black" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} fill="none" />
        </MaskedDisc>
      );
    case "canceled":
      return (
        <MaskedDisc tint={tint} size={size}>
          <Path d="m4.5 4.5 7 7m0-7-7 7" stroke="black" strokeLinecap="round" strokeWidth={2.25} fill="none" />
        </MaskedDisc>
      );
    case "duplicate":
      return (
        <MaskedDisc tint={tint} size={size}>
          <Path d="m3.75 10.25 4.25-4.25m0 4 4.25-4.25" stroke="black" strokeLinecap="round" strokeWidth={2} fill="none" />
        </MaskedDisc>
      );
    default:
      // todo
      return (
        <Svg width={size} height={size} viewBox="0 0 16 16">
          <Circle cx={8} cy={8} r={6.25} stroke={tint} strokeWidth={1.75} fill="none" />
        </Svg>
      );
  }
}

/** A filled disc with a glyph cut out of it (the desktop's mask trick). */
function MaskedDisc({ tint, size, children }: { tint: ColorValue; size: number; children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Defs>
        <Mask id="cut">
          <Circle cx={8} cy={8} r={8} fill="white" />
          {children}
        </Mask>
      </Defs>
      <Circle cx={8} cy={8} r={8} fill={tint} mask="url(#cut)" />
    </Svg>
  );
}
