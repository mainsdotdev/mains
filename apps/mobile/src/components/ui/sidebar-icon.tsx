import type { ColorValue } from "react-native";
import Svg, { Line } from "react-native-svg";

/**
 * The sidebar glyph the ChatGPT / Claude apps use — leading-aligned lines,
 * each shorter than the one above — which SF Symbols has no exact match for
 * (`text.alignleft` has four lines, `line.3.horizontal.decrease` is centered
 * and reads as a filter). Two lines is the ChatGPT form, three the Claude one.
 */
export function SidebarIcon({
  size = 20,
  color,
  lines = 2,
}: {
  size?: number;
  color: ColorValue;
  lines?: 2 | 3;
}) {
  // Drawn on a 24-unit grid with the weight of a medium SF Symbol.
  const stroke = 2.2;
  const left = 4;
  const rows =
    lines === 2
      ? [
          { y: 9, right: 20 },
          { y: 15, right: 14 },
        ]
      : [
          { y: 7, right: 20 },
          { y: 12, right: 16 },
          { y: 17, right: 12 },
        ];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {rows.map((row) => (
        <Line
          key={row.y}
          x1={left}
          y1={row.y}
          x2={row.right}
          y2={row.y}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
      ))}
    </Svg>
  );
}
