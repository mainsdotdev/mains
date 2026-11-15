import type { AssistantAvatar } from "@mains/contracts/assistants";

export interface AvatarParticle {
  id: string;
  x: number;
  y: number;
  halfSize: number;
  opacity: number;
  waveForward: number;
  waveReturn: number;
  eye?: "left" | "right";
}
export type AvatarDetail = "compact" | "full";

/** Separated square grains fill a soft icon silhouette, including its center. */
function silhouette(shape: AssistantAvatar["shape"], detail: AvatarDetail): AvatarParticle[] {
  const side = detail === "full" ? 13 : 9;
  const step = detail === "full" ? 3.75 : 5.5;
  const diagonal = (side - 1) * 2;
  const points: AvatarParticle[] = [];
  for (let row = 0; row < side; row++) for (let col = 0; col < side; col++) {
    const x = (col - (side - 1) / 2) * step;
    const y = (row - (side - 1) / 2) * step;
    const inside = shape === "sphere" ? x * x + y * y <= 24 * 24 : (x / 23.4) ** 4 + (y / 23.4) ** 4 <= 1;
    if (!inside) continue;
    const grain = (row * 17 + col * 11) % 7;
    points.push({ id: `${shape}-${row}-${col}`, x: 32 + x, y: 32 + y,
      halfSize: (detail === "full" ? 1.3 : 1.98) + grain * 0.02, opacity: 0.96 + grain * 0.006,
      // SquareSpinner's alternating diagonal sweeps, normalized to the cycle.
      // Each pulse peaks at 24%; the return pass starts half a cycle later.
      waveForward: (row + col) / diagonal * 0.25 - 0.24,
      waveReturn: 0.5 + (side - 1 - row + col) / diagonal * 0.25 - 0.24 });
  }
  // Two existing grains become eyes, with room around them for gaze and blinking.
  for (const eye of ["left", "right"] as const) {
    const x = eye === "left" ? 25 : 39, y = 27;
    const nearest = points.filter(p => !p.eye).reduce((a, b) => Math.hypot(a.x - x, a.y - y) < Math.hypot(b.x - x, b.y - y) ? a : b);
    Object.assign(nearest, { id: `${shape}-eye-${eye}`, x, y, halfSize: detail === "full" ? 3.3 : 3.6, opacity: 1, eye });
  }
  const eyes = points.filter(p => p.eye).sort((a, b) => a.eye!.localeCompare(b.eye!));
  const body = points.filter(p => !p.eye && eyes.every(eye =>
    Math.hypot((p.x - eye.x) / (6.4 + p.halfSize), (p.y - eye.y) / (7.6 + p.halfSize)) > 1));
  return [...body, ...eyes];
}

const densities = (shape: AssistantAvatar["shape"]) => ({ compact: silhouette(shape, "compact"), full: silhouette(shape, "full") });
export const AVATAR_PARTICLES = { sphere: densities("sphere"), cube: densities("cube") };

export function avatarPhase(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % 997 / 997;
}
