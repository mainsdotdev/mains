import type { AssistantAvatar } from "@mains/contracts/assistants";

type TileTone = "base" | "light" | "shade";
type Corners = number | readonly [number, number, number, number];

/** Geometry uses a 100 × 100 coordinate space at every display size. */
export type MosaicTile = readonly [
  x: number, y: number, width: number, height: number, tone: TileTone, corners?: Corners,
];

interface MosaicShape {
  label: string;
  eyes: readonly [left: number, right: number, y: number];
  tiles: readonly MosaicTile[];
  accents: readonly number[];
  outline?: string;
}

function outline(points: readonly (readonly [x: number, y: number])[]): string {
  return `polygon(evenodd, ${points.map(([x, y]) => `${x}% ${y}%`).join(", ")})`;
}

export const MOSAIC_SHAPES: Record<AssistantAvatar["shape"], MosaicShape> = {
  steps: {
    label: "Steps",
    eyes: [32, 61, 61],
    tiles: [
      [13, 28, 19, 21, "shade", [7, 3, 4, 5]],
      [34, 16, 29, 33, "light", [8, 9, 4, 4]],
      [65, 22, 23, 27, "base", [6, 9, 5, 4]],
      [13, 51, 29, 29, "base", [5, 4, 4, 10]],
      [44, 51, 44, 29, "light", [4, 5, 11, 4]],
      [25, 82, 17, 8, "shade"],
      [44, 82, 21, 8, "shade"],
      [67, 82, 12, 8, "shade"],
    ],
    accents: [5, 6, 7],
  },
  sphere: {
    label: "Sphere",
    eyes: [36, 64, 53],
    outline: "ellipse(41% 40% at 50% 50%)",
    tiles: [
      [8, 8, 40, 23, "light", 2],
      [50, 8, 42, 23, "base", 2],
      [7, 33, 42, 35, "base"],
      [51, 33, 42, 35, "light"],
      [8, 70, 28, 23, "shade", 2],
      [38, 70, 24, 23, "base"],
      [64, 70, 28, 23, "shade", 2],
    ],
    accents: [4, 5, 6],
  },
  cube: {
    label: "Block",
    eyes: [33, 66, 55],
    tiles: [
      [12, 13, 33, 25, "light", [9, 3, 3, 3]],
      [47, 13, 41, 25, "base", [3, 9, 3, 3]],
      [12, 40, 37, 32, "base", 4],
      [51, 40, 37, 32, "light", 4],
      [12, 74, 24, 13, "shade", [3, 3, 3, 8]],
      [38, 74, 24, 13, "shade"],
      [64, 74, 24, 13, "shade", [3, 3, 8, 3]],
    ],
    accents: [4, 5, 6],
  },
  flower: {
    label: "Flower",
    eyes: [35, 65, 62],
    tiles: [
      [13, 10, 35, 38, "light", [18, 17, 8, 10]],
      [52, 10, 35, 38, "base", [17, 18, 10, 8]],
      [8, 50, 41, 37, "base", [20, 7, 10, 19]],
      [51, 50, 41, 37, "light", [7, 20, 19, 10]],
    ],
    accents: [0, 1],
  },
  weave: {
    label: "Weave",
    eyes: [33, 65, 54],
    tiles: [
      [11, 12, 23, 23, "light", [7, 6, 3, 3]],
      [66, 9, 23, 32, "base", [6, 7, 3, 3]],
      [11, 37, 38, 29, "base", 4],
      [51, 43, 38, 26, "light", 4],
      [11, 68, 23, 22, "shade", [3, 3, 6, 7]],
      [66, 71, 23, 16, "shade", [3, 3, 7, 6]],
    ],
    accents: [4, 5],
  },
  lantern: {
    label: "Lantern",
    eyes: [36, 64, 50],
    outline: outline([
      [34, 28], [34, 17], [35, 12], [39, 8], [44, 7], [56, 7], [61, 8], [65, 12], [66, 17],
      [66, 28], [72, 28], [78, 30], [81, 34], [83, 38], [88, 70], [91, 70], [94, 71],
      [95, 74], [95, 86], [93, 88], [7, 88], [5, 86], [5, 74], [6, 71], [9, 70], [12, 70],
      [17, 38], [19, 34], [22, 30], [28, 28], [34, 28],
      // Return along the same edge after drawing the handle's cutout.
      [42, 28], [42, 18], [43, 16], [45, 15], [55, 15], [57, 16], [58, 18], [58, 28], [42, 28],
    ]),
    tiles: [
      [33, 6, 34, 22, "light"],
      [12, 29, 37, 37, "base"],
      [51, 29, 37, 37, "light"],
      [4, 68, 27, 21, "shade"],
      [33, 68, 34, 21, "base"],
      [69, 68, 27, 21, "shade"],
    ],
    accents: [3, 4, 5],
  },
  arch: {
    label: "Arch",
    eyes: [35, 65, 51],
    outline: outline([
      [13, 85], [13, 48], [14, 39], [17, 30], [22, 22], [30, 16], [39, 12], [50, 10],
      [61, 12], [70, 16], [78, 22], [83, 30], [86, 39], [87, 48], [87, 85], [85, 88],
      [83, 89], [68, 89], [65, 88], [64, 85], [64, 72], [63, 69], [60, 68], [40, 68],
      [37, 69], [36, 72], [36, 85], [35, 88], [32, 89], [17, 89], [14, 88],
    ]),
    tiles: [
      [12, 8, 38, 27, "light"],
      [52, 8, 36, 27, "base"],
      [12, 37, 36, 29, "base"],
      [50, 37, 38, 29, "light"],
      [12, 68, 27, 22, "shade"],
      [61, 68, 27, 22, "shade"],
    ],
    accents: [4, 5],
  },
  kite: {
    label: "Kite",
    eyes: [36, 65, 49],
    outline: outline([
      [56, 7], [58, 6], [60, 7], [62, 10], [91, 43], [92, 46], [90, 51],
      [47, 93], [44, 95], [42, 95], [39, 92], [9, 54], [7, 51], [9, 47],
    ]),
    tiles: [
      [6, 5, 88, 28, "light"],
      [6, 35, 43, 28, "base"],
      [51, 35, 43, 28, "light"],
      [7, 65, 39, 31, "shade"],
      [48, 65, 45, 31, "base"],
    ],
    accents: [0, 3, 4],
  },
  swallow: {
    label: "Swallow",
    eyes: [37, 63, 50],
    outline: outline([
      [7, 19], [5, 18], [4, 19], [5, 23], [16, 60], [19, 64], [24, 67], [36, 66],
      [36, 86], [37, 88], [39, 87], [50, 76], [61, 87], [63, 88], [64, 86], [64, 66],
      [76, 67], [81, 64], [84, 60], [95, 23], [96, 19], [95, 18], [93, 19], [70, 32],
      [65, 34], [60, 33], [51, 29], [49, 29], [40, 33], [35, 34], [30, 32],
    ]),
    tiles: [
      [4, 16, 23, 54, "shade"],
      [29, 27, 20, 39, "light"],
      [51, 27, 20, 39, "base"],
      [73, 16, 23, 54, "light"],
      [33, 68, 16, 22, "base"],
      [51, 68, 16, 22, "shade"],
    ],
    accents: [0, 3],
  },
};

export function avatarPhase(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % 997 / 997;
}
