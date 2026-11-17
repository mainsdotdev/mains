import { ASSISTANT_AVATAR_SHAPES, type AssistantAvatar } from "@mains/contracts/assistants";

export type AvatarDetail = "compact" | "full";
export type AvatarGaze = "center" | "left" | "right" | "up" | "down";
export interface AvatarParticle {
  id: string;
  row: number;
  col: number;
  radius: string;
  eye?: "left" | "right";
  gaze: Record<AvatarGaze, 0 | 1>;
}

export const AVATAR_SHAPE_LABELS: Record<AssistantAvatar["shape"], string> = {
  sphere: "Sphere", cube: "Cube", flower: "Flower", cross: "Cross", steps: "Steps", weave: "Weave",
};
export const AVATAR_GRID_SIDES: Record<AvatarDetail, number> = { compact: 7, full: 9 };
function flowerRadius(angle: number): number {
  const axis = Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
  // The union of four round petals, with a filled center between them.
  return Math.max(0.45, 0.6 * axis + Math.sqrt(Math.max(0, 0.4 ** 2 - 0.6 ** 2 * (1 - axis ** 2))));
}
// Clip only the outermost flower cells; interior cell edges stay square.
export const AVATAR_FLOWER_CLIP = `polygon(${Array.from({ length: 96 }, (_, i) => {
  const angle = i / 96 * Math.PI * 2;
  const radius = flowerRadius(angle);
  return `${50 + Math.cos(angle) * radius * 50}% ${50 + Math.sin(angle) * radius * 50}%`;
}).join(", ")})`;

function inside(shape: AssistantAvatar["shape"], x: number, y: number): boolean {
  switch (shape) {
    case "sphere": return x * x + y * y <= 1.08;
    case "cube": return Math.abs(x) ** 6 + Math.abs(y) ** 6 <= 1.45;
    case "flower": return Math.hypot(x, y) <= flowerRadius(Math.atan2(y, x));
    case "cross": return Math.abs(x) <= 0.38 || Math.abs(y) <= 0.38;
    case "steps": return y >= 0.45 || (y >= -0.2 && x >= -0.38) || x >= 0.45;
    case "weave": return Math.abs(x) >= 0.45 || Math.abs(y) <= 0.38;
  }
}

/** A fixed grid: gaze changes the color of existing cells, never their geometry. */
function silhouette(shape: AssistantAvatar["shape"], detail: AvatarDetail): AvatarParticle[] {
  const side = AVATAR_GRID_SIDES[detail];
  const middle = (side - 1) / 2;
  const occupied = (row: number, col: number) => row >= 0 && row < side && col >= 0 && col < side
    && inside(shape, (col - middle) / middle, (row - middle) / middle);
  const eyeRow = middle + (shape === "steps" ? 1 : shape === "flower" ? 0 : -1);
  const eyes = [middle - 1, middle + 1];
  const cellWidth = (1 - 0.015 * (side - 1)) / side;
  const eyeFits = (row: number, col: number) => occupied(row, col) && (shape !== "flower"
    || [0, cellWidth].every(dy => [0, cellWidth].every(dx => inside(shape,
      (col * (cellWidth + 0.015) + dx) * 2 - 1, (row * (cellWidth + 0.015) + dy) * 2 - 1))));
  const offsets: Record<AvatarGaze, [number, number]> = { center: [0, 0], left: [0, -1], right: [0, 1], up: [-1, 0], down: [1, 0] };
  // A narrow lobe or step may not fit a whole gaze; keep both eyes together.
  for (const gaze of Object.keys(offsets) as AvatarGaze[]) {
    const [dy, dx] = offsets[gaze];
    if (!eyes.every(col => eyeFits(eyeRow + dy, col + dx))) offsets[gaze] = [0, 0];
  }
  const points: AvatarParticle[] = [];
  for (let row = 0; row < side; row++) for (let col = 0; col < side; col++) {
    if (shape !== "flower" && !occupied(row, col)) continue;
    const top = !occupied(row - 1, col), bottom = !occupied(row + 1, col);
    const left = !occupied(row, col - 1), right = !occupied(row, col + 1);
    const outer = shape === "sphere" ? "75%" : "35%";
    const corner = (exposed: boolean) => exposed && shape !== "flower" ? outer : "8%";
    const gaze = Object.fromEntries(Object.entries(offsets).map(([pose, [dy, dx]]) =>
      [pose, row === eyeRow + dy && eyes.some(eyeCol => col === eyeCol + dx) ? 1 : 0])) as AvatarParticle["gaze"];
    points.push({ id: `${shape}-${row}-${col}`, row, col,
      radius: [corner(top && left), corner(top && right), corner(bottom && right), corner(bottom && left)].join(" "),
      eye: row === eyeRow && col === eyes[0] ? "left" : row === eyeRow && col === eyes[1] ? "right" : undefined,
      gaze });
  }
  return points;
}

export const AVATAR_PARTICLES = Object.fromEntries(ASSISTANT_AVATAR_SHAPES.map(shape =>
  [shape, { compact: silhouette(shape, "compact"), full: silhouette(shape, "full") }])) as Record<AssistantAvatar["shape"], Record<AvatarDetail, AvatarParticle[]>>;

export function avatarPhase(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % 997 / 997;
}
