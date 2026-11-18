import { isAssistantRobotShape, type AssistantAvatar, type ASSISTANT_AVATAR_SHAPES_BY_FAMILY } from "@mains/contracts/assistants";
import { avatarOutline, MOSAIC_SHAPES } from "./assistant-mosaic";
import { ROBOT_PRESETS } from "./assistant-robot-presets";

type ShapesByFamily = typeof ASSISTANT_AVATAR_SHAPES_BY_FAMILY;
type MaterialShape<Family extends "badge" | "felt"> = {
  family: Family;
  label: string;
  eyes: readonly [left: number, right: number, y: number];
  outline: string;
};

const BADGE_SHAPES: Record<ShapesByFamily["badge"][number], MaterialShape<"badge">> = {
  "badge-card": {
    family: "badge", label: "Card", eyes: [36, 62, 48],
    outline: avatarOutline([
      [28, 13], [75, 13], [81, 15], [86, 19], [93, 30], [95, 36], [94, 43],
      [86, 75], [83, 82], [78, 85], [22, 94], [16, 93], [12, 90],
      [6, 81], [5, 75], [17, 28], [21, 19], [24, 15],
    ]),
  },
  "badge-pin": {
    family: "badge", label: "Pin", eyes: [38, 62, 48],
    outline: "ellipse(41% 41% at 50% 50%)",
  },
  "badge-shield": {
    family: "badge", label: "Shield", eyes: [37, 63, 44],
    outline: avatarOutline([
      [17, 24], [20, 20], [43, 10], [48, 8], [52, 8], [57, 10], [80, 20], [83, 24],
      [85, 36], [85, 47], [82, 59], [77, 69], [68, 80], [57, 89], [52, 92],
      [48, 92], [43, 89], [32, 80], [23, 69], [18, 59], [15, 47], [15, 36],
    ]),
  },
  "badge-ticket": {
    family: "badge", label: "Ticket", eyes: [35, 60, 49],
    outline: avatarOutline([
      [15, 23], [20, 19], [79, 19], [85, 21], [89, 26], [91, 44],
      [86, 45], [83, 48], [82, 52], [84, 56], [87, 58], [92, 58],
      [93, 70], [91, 76], [85, 80], [21, 84], [15, 82], [11, 77], [9, 60],
      [14, 59], [17, 56], [18, 51], [16, 47], [12, 45], [8, 45], [9, 31], [11, 26],
    ]),
  },
};

const FELT_SHAPES: Record<ShapesByFamily["felt"][number], MaterialShape<"felt">> = {
  "felt-sprout": {
    family: "felt", label: "Sprout", eyes: [38, 63, 54],
    outline: avatarOutline([
      [8, 56], [10, 45], [16, 35], [23, 29], [33, 24], [39, 20],
      [45, 12], [50, 9], [54, 10], [61, 15], [67, 22], [73, 22],
      [81, 24], [88, 30], [92, 39], [94, 50], [92, 61], [88, 72],
      [82, 80], [74, 86], [62, 90], [50, 93], [38, 92], [27, 88],
      [18, 81], [12, 73], [9, 64],
    ]),
  },
  "felt-pebble": {
    family: "felt", label: "Pebble", eyes: [37, 62, 53],
    outline: avatarOutline([
      [7, 55], [8, 46], [13, 36], [21, 27], [31, 20], [44, 16],
      [57, 15], [68, 17], [79, 23], [87, 30], [92, 40], [94, 52], [93, 63],
      [89, 73], [80, 80], [68, 85], [54, 88], [40, 87], [28, 84], [18, 78], [11, 68],
    ]),
  },
  "felt-cloud": {
    family: "felt", label: "Cloud", eyes: [36, 64, 58],
    outline: avatarOutline([
      [6, 60], [7, 50], [12, 42], [20, 37], [28, 36], [31, 28], [36, 21],
      [43, 17], [52, 15], [61, 17], [68, 22], [72, 30], [78, 31], [85, 34],
      [90, 40], [94, 50], [95, 61], [92, 71], [85, 78], [76, 82], [61, 85],
      [45, 85], [28, 83], [18, 79], [10, 72], [7, 66],
    ]),
  },
  "felt-bloom": {
    family: "felt", label: "Bloom", eyes: [37, 63, 51],
    outline: avatarOutline([
      [12, 38], [13, 30], [18, 22], [26, 18], [35, 18], [41, 12], [49, 9], [57, 10],
      [64, 14], [69, 20], [77, 20], [85, 25], [89, 32], [89, 41], [94, 48], [95, 57],
      [92, 66], [85, 72], [82, 81], [75, 87], [66, 88], [58, 93], [49, 95],
      [40, 92], [34, 88], [25, 87], [17, 81], [14, 73], [8, 67], [5, 58], [6, 48],
    ]),
  },
};

const MATERIAL_SHAPES = { ...BADGE_SHAPES, ...FELT_SHAPES };

function isMosaicShape(shape: AssistantAvatar["shape"]): shape is keyof typeof MOSAIC_SHAPES {
  return Object.prototype.hasOwnProperty.call(MOSAIC_SHAPES, shape);
}

export function assistantAvatarDesign(shape: AssistantAvatar["shape"]) {
  if (isAssistantRobotShape(shape)) return { family: "robot" as const, shape, ...ROBOT_PRESETS[shape] };
  return isMosaicShape(shape) ? { family: "mosaic" as const, ...MOSAIC_SHAPES[shape] } : MATERIAL_SHAPES[shape];
}
