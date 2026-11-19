import { ASSISTANT_ROBOT_AVATARS } from "@mains/contracts/assistants";
import { DEFAULT_ROBOT_AVATAR, ROBOT_PRESETS, ROBOT_SHAPES_BY_STYLE, ROBOT_STYLE_LABELS, ROBOT_STYLES } from "./assistant-robot-presets";

export { createRobotRenderer } from "./assistant-robot-renderer";
export { nextRobotAmbientGesture, sampleRobotGesture } from "./assistant-robot-motion";

export const catalogue = {
  defaultShape: DEFAULT_ROBOT_AVATAR.shape,
  styles: ROBOT_STYLES.map(style => ({
    id: style,
    label: ROBOT_STYLE_LABELS[style],
    presets: ROBOT_SHAPES_BY_STYLE[style].map(shape => ({
      id: shape,
      label: ROBOT_PRESETS[shape].label,
      color: ASSISTANT_ROBOT_AVATARS[shape],
    })),
  })),
};
