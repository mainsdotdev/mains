export type Point = readonly [number, number];
export type Vector = readonly [number, number, number];

export type RobotFinish = "matte" | "metal" | "glass" | "light" | "shell";
export type RobotMotion = "fixed" | "terminalEyes" | "clearFace" | "clearEyes" | "iris" | "lid";

export interface RobotPart {
  vertices: Float32Array;
  position: Vector;
  color: string;
  finish: RobotFinish;
  motion: RobotMotion;
}

/** All profiles run counterclockwise when seen from the front. */
export function roundedProfile(points: readonly Point[], radius: number): Point[] {
  return points.flatMap(([x, y], index) => {
    const [px, py] = points[(index + points.length - 1) % points.length];
    const [nx, ny] = points[(index + 1) % points.length];
    const start = Math.min(0.45, radius / Math.hypot(px - x, py - y));
    const end = Math.min(0.45, radius / Math.hypot(nx - x, ny - y));
    return Array.from({ length: 6 }, (_, step): Point => {
      const t = step / 5;
      return [
        x + (px - x) * start * (1 - t) ** 2 + (nx - x) * end * t ** 2,
        y + (py - y) * start * (1 - t) ** 2 + (ny - y) * end * t ** 2,
      ];
    });
  });
}

export function rectangle(halfWidth: number, halfHeight: number, radius: number): Point[] {
  return roundedProfile([
    [-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight],
  ], radius);
}

export function ellipse(x: number, y = x, sides = 36): Point[] {
  return Array.from({ length: sides }, (_, index): Point => {
    const angle = index * Math.PI * 2 / sides;
    return [x * Math.cos(angle), y * Math.sin(angle)];
  });
}

type Vertex = readonly [Vector, Vector];

function extrusion(profile: readonly Point[], depth: number, bevel: number, turn: number): Float32Array {
  const vertices: number[] = [];
  const sin = Math.sin(turn), cos = Math.cos(turn);
  const halfDepth = depth / 2;
  const edge = Math.min(bevel, halfDepth * 0.99);
  const push = ([[x, y, z], [nx, ny, nz]]: Vertex) => {
    vertices.push(x * cos + z * sin, y, z * cos - x * sin, nx * cos + nz * sin, ny, nz * cos - nx * sin);
  };
  const normal = profile.map((_, index) => {
    const previous = profile[(index + profile.length - 1) % profile.length];
    const next = profile[(index + 1) % profile.length];
    const dx = next[0] - previous[0], dy = next[1] - previous[1];
    const length = Math.hypot(dx, dy);
    return [dy / length, -dx / length];
  });
  const ring = (angle: number, side: number): Vertex[] => {
    const radial = Math.sin(angle), facing = Math.cos(angle) * side;
    return profile.map(([x, y], index) => {
      const [nx, ny] = normal[index];
      return [
        [x - nx * (1 - radial) * edge, y - ny * (1 - radial) * edge, side * (halfDepth - edge) + facing * edge],
        [nx * radial, ny * radial, facing],
      ];
    });
  };
  const rings = [0, 1, 2, 3].map(step => ring(step * Math.PI / 6, 1));
  rings.push(...[3, 2, 1, 0].map(step => ring(step * Math.PI / 6, -1)));
  // The cap center must stay inside each convex profile, even for offset parts.
  const center = profile.reduce(([x, y], point) => [x + point[0], y + point[1]], [0, 0]).map(value => value / profile.length);
  const front: Vertex = [[center[0], center[1], halfDepth], [0, 0, 1]];
  const back: Vertex = [[center[0], center[1], -halfDepth], [0, 0, -1]];
  const last = rings[rings.length - 1];
  profile.forEach((_, index) => {
    const next = (index + 1) % profile.length;
    push(front); push(rings[0][index]); push(rings[0][next]);
    push(back); push(last[next]); push(last[index]);
    for (let row = 0; row < rings.length - 1; row++) {
      const a = rings[row][index], b = rings[row + 1][index];
      const c = rings[row + 1][next], d = rings[row][next];
      push(a); push(b); push(c);
      push(a); push(c); push(d);
    }
  });
  return new Float32Array(vertices);
}

export function plate(profile: readonly Point[], position: Vector, depth: number, bevel: number, color: string,
  finish: RobotFinish = "matte", motion: RobotMotion = "fixed", turn = 0): RobotPart {
  return { vertices: extrusion(profile, depth, bevel, turn), position, color, finish, motion };
}
