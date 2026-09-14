import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";

import type { IconShape } from "@mains/icons/registry";

/**
 * Draws one desktop registry icon (see `@mains/icons/registry`) at a given
 * size and color — the phone's stand-in for the desktop's SVG components.
 */
export function RegistryIcon({
  shape,
  size,
  color,
  style,
}: {
  shape: IconShape;
  size: number;
  color: ColorValue;
  style?: React.ComponentProps<typeof Svg>["style"];
}) {
  return (
    <Svg width={size} height={size} viewBox={shape.viewBox} style={style}>
      {shape.paths.map((path, index) => (
        <Path key={index} d={path.d} fill={color} fillRule={path.fillRule} clipRule={path.clipRule} />
      ))}
    </Svg>
  );
}
