import type { AssistantRobotShape } from "@mains/contracts/assistants";
import { ellipse, plate, rectangle, roundedProfile, type Point, type RobotFinish, type RobotPart,
  type RobotPartGesture, type Vector } from "./assistant-robot-mesh";

type SpecialistShape = Extract<AssistantRobotShape, `specialist-${string}`>;
type Model = () => RobotPart[];

const brass = "#b48955";
const ivory = "#f0dfc8";
const warmLight = "#ffe4a8";
const dark = "#26232a";

function box(width: number, height: number, position: Vector, depth: number, bevel: number, color: string,
  finish: RobotFinish = "matte"): RobotPart {
  return plate(rectangle(width, height, bevel * 2), position, depth, bevel, color, finish);
}

function disk(width: number, height: number, position: Vector, depth: number, bevel: number, color: string,
  finish: RobotFinish = "matte"): RobotPart {
  return plate(ellipse(width, height, 32), position, depth, bevel, color, finish);
}

function casePart(outline: readonly Point[], position: Vector, depth: number, round: number, bevel: number,
  color: string, finish: RobotFinish = "matte"): RobotPart {
  return plate(roundedProfile(outline, round), position, depth, bevel, color, finish);
}

function rotate(part: RobotPart, angle: number, plane: "xy" | "yz" = "xy"): RobotPart {
  const { vertices } = part;
  const first = plane === "xy" ? 0 : 1;
  const sin = Math.sin(angle), cos = Math.cos(angle);
  for (let index = first; index < vertices.length; index += 3) {
    const a = vertices[index], b = vertices[index + 1];
    vertices[index] = a * cos - b * sin;
    vertices[index + 1] = a * sin + b * cos;
  }
  return part;
}

function stroke([x1, y1]: Point, [x2, y2]: Point, z: number, width: number, color: string,
  depth = .024, finish: RobotFinish = "matte"): RobotPart {
  const halfLength = Math.hypot(x2 - x1, y2 - y1) / 2;
  const bar = box(halfLength + width / 2, width, [(x1 + x2) / 2, (y1 + y2) / 2, z],
    depth, Math.min(width * .74, depth * .46), color, finish);
  return rotate(bar, Math.atan2(y2 - y1, x2 - x1));
}

function cap(width: number, depth: number, position: Vector, height: number, bevel: number, color: string,
  finish: RobotFinish = "matte"): RobotPart {
  return rotate(disk(width, depth, position, height, bevel, color, finish), Math.PI / 2, "yz");
}

function move(part: RobotPart, gesture: RobotPartGesture): RobotPart {
  return { ...part, gesture };
}

function joinRings(rings: readonly number[][][], closed: boolean): Float32Array {
  const segments = closed ? rings.length : rings.length - 1;
  const vertices: number[] = [];
  for (let index = 0; index < segments; index++) {
    const before = rings[index], after = rings[(index + 1) % rings.length];
    for (let side = 0; side < before.length; side++) {
      const next = (side + 1) % before.length;
      vertices.push(...before[side], ...after[side], ...after[next], ...before[side], ...after[next], ...before[next]);
    }
  }
  return new Float32Array(vertices);
}

/** Sweep a round tube along a flat curve for open handles, frames and arms. */
function tube(path: readonly Point[], radius: number, position: Vector, color: string,
  finish: RobotFinish = "matte", closed = true): RobotPart {
  const sides = 12;
  const segments = closed ? path.length : path.length - 1;
  const rings = path.map(([x, y], index) => {
    const [px, py] = path[closed ? (index - 1 + path.length) % path.length : Math.max(0, index - 1)];
    const [qx, qy] = path[closed ? (index + 1) % path.length : Math.min(segments, index + 1)];
    const dx = qx - px, dy = qy - py;
    const length = Math.hypot(dx, dy);
    return Array.from({ length: sides }, (_, side) => {
      const angle = 2 * Math.PI * side / sides;
      const nx = dy / length * Math.cos(angle), ny = -dx / length * Math.cos(angle), nz = Math.sin(angle);
      return [x + radius * nx, y + radius * ny, radius * nz, nx, ny, nz];
    });
  });
  return { vertices: joinRings(rings, closed), position, color, finish, motion: "fixed" };
}

function handle(width: number, height: number, thickness: number, position: Vector, color: string,
  finish: RobotFinish = "matte"): RobotPart {
  return tube(ellipse(width, height, 32), thickness, position, color, finish);
}

function eyes([x, y, z]: Vector, light = warmLight, separation = .40, scale = 1,
  recess = dark): RobotPart[] {
  return [-separation / 2, separation / 2].flatMap(offset => {
    const horizontal = x + offset;
    return [
      disk(.064 * scale + .057, .094 * scale + .049, [horizontal, y, z], .028, .013, recess, "glass"),
      plate(ellipse(.065 * scale, .094 * scale, 24), [horizontal, y, z + .021], .016, .006, light, "light", "specialistEyes"),
    ];
  });
}

function travel(): RobotPart[] {
  const teal = "#2f7b82", seam = "#1d4c52", trim = "#b6a79a";
  const tag: RobotPartGesture = { roll: .27, pivot: [.48, .36] };
  return [
    box(.80, .49, [0, -.20, 0], .65, .155, teal),
    box(.765, .453, [0, -.19, .25], .21, .095, "#40959a", "metal"),
    handle(.34, .158, .065, [-.065, .47, -.02], seam),
    box(.09, .048, [-.36, .305, -.015], .22, .039, trim, "metal"),
    box(.09, .048, [.23, .305, -.015], .22, .039, trim, "metal"),
    ...[-.63, .63].map(x => box(.098, .065, [x, -.664, .03], .27, .042, dark)),
    ...[-.53, -.34, .015, .17].map(y => box(.59, .016, [0, y, .356], .027, .012, seam)),
    ...[-.64, .64].flatMap(x => [-.55, .19].map(y =>
      box(.082, .05, [x, y, .314], .073, .027, trim, "metal"))),
    move(rotate(box(.116, .183, [.53, .105, .410], .069, .032, "#df8f4a"), .27), tag),
    move(disk(.042, .033, [.49, .245, .446], .024, .010, "#704525"), tag),
    ...eyes([-.11, -.162, .36], "#fff2bd", .39, .88, seam),
  ];
}

function kitchen(): RobotPart[] {
  const enamel = "#b94033";
  const lid: RobotPartGesture = { translate: [0, .066, 0], roll: .08, oneWay: true };
  return [
    casePart([[-.43, -.62], [.43, -.62], [.63, -.39], [.66, .12], [-.66, .12], [-.63, -.39]],
      [0, 0, 0], .86, .26, .20, enamel, "glass"),
    cap(.64, .432, [0, .098, 0], .124, .06, "#632822", "metal"),
    ...[-1, 1].map(side => handle(.164, .12, .06, [side * .69, .01, -.012], "#aa372b", "glass")),
    move(cap(.66, .465, [0, .19, 0], .142, .067, "#c84d39", "glass"), lid),
    move(cap(.49, .382, [0, .273, 0], .096, .045, "#b64232", "glass"), lid),
    move(cap(.081, .072, [0, .36, 0], .123, .026, "#352931"), lid),
    move(cap(.147, .112, [0, .444, 0], .076, .031, "#51424a", "metal"), lid),
    ...eyes([0, -.22, .433], "#fff2d1", .40, .94, "#662923"),
  ];
}

function cloud(): RobotPart[] {
  const body: Point[] = [[-.58, -.44], [.57, -.44], [.78, -.29], [.86, -.05], [.83, .15], [.70, .29],
    [.51, .34], [.43, .60], [.22, .77], [-.06, .78], [-.26, .68], [-.40, .46], [-.45, .33], [-.66, .32],
    [-.83, .19], [-.87, -.03], [-.80, -.28]];
  return [
    casePart(body, [0, 0, 0], .68, .22, .193, "#80b5df"),
    box(.66, .112, [0, -.445, -.005], .61, .057, "#5183ac", "metal"),
    ...[-.40, -.16, .08, .32].map(x => box(.075, .021, [x, -.46, .31], .026, .01, "#273c56")),
    move(plate(ellipse(.027, .024), [.50, -.46, .328], .014, .005, "#7bf1fe", "light"),
      { translate: [0, .023, -.035], oneWay: true }),
    ...eyes([.015, -.048, .34], "#8ef4ff", .40, .95, "#47799c"),
  ];
}

function lawyer(): RobotPart[] {
  const cover = "#62405d", spine = "#493045";
  const balance: RobotPartGesture = { roll: .21, pivot: [0, .43] };
  return [
    box(.53, .704, [.031, .005, -.015], .56, .070, "#d6bc94"),
    box(.57, .744, [0, .005, -.295], .12, .053, cover),
    box(.57, .744, [0, .005, .296], .14, .05, cover),
    box(.106, .734, [-.497, .005, 0], .72, .091, spine),
    ...[-.53, -.25, .25, .53].map(y => box(.110, .022, [-.50, y, -.003], .735, .019, "#795370")),
    ...[-.59, .59].map(y => box(.079, .068, [.472, y, .369], .043, .018, brass, "metal")),
    stroke([0, .10], [0, .48], .38, .018, brass),
    stroke([-.092, .106], [.092, .106], .383, .014, brass),
    move(stroke([-.23, .37], [.23, .37], .395, .018, brass), balance),
    ...[-.185, .185].flatMap(x => [
      move(stroke([x, .36], [x - .07, .20], .392, .008, brass), balance),
      move(stroke([x, .36], [x + .07, .20], .392, .008, brass), balance),
      move(disk(.090, .036, [x, .181, .399], .033, .013, brass, "metal"), balance),
    ]),
    ...eyes([.025, -.235, .372], "#ffbc68", .38, .76, "#4c2b3d"),
  ];
}

function sports(): RobotPart[] {
  const lime = "#9ca63c";
  return [
    disk(.656, .667, [0, -.117, 0], .57, .116, lime, "metal"),
    disk(.560, .569, [0, -.117, .294], .070, .030, "#454945", "metal"),
    disk(.520, .53, [0, -.117, .335], .044, .018, "#292e30", "glass"),
    handle(.120, .102, .032, [0, .744, -.004], lime, "metal"),
    move(box(.123, .072, [0, .60, 0], .203, .041, brass, "metal"),
      { translate: [0, -.073, 0], oneWay: true }),
    move(rotate(box(.077, .102, [.483, .450, 0], .178, .042, lime, "metal"), -.65),
      { translate: [-.035, -.043, 0], oneWay: true }),
    ...Array.from({ length: 16 }, (_, index) => {
      const angle = 2 * Math.PI * index / 16;
      const x = Math.cos(angle), y = Math.sin(angle);
      return stroke([x * .426, y * .426 - .117], [x * .465, y * .465 - .117], .36, .009, ivory);
    }),
    move(stroke([0, -.38], [.18, -.27], .373, .013, "#d8da7e"),
      { roll: .45, pivot: [0, -.38] }),
    ...eyes([0, -.101, .36], "#fff5d0", .40, .92, "#232627"),
  ];
}

function writer(): RobotPart[] {
  const nib: RobotPartGesture = { roll: .14, pivot: [0, .155] };
  return [
    casePart([[-.55, -.64], [.56, -.64], [.66, -.47], [.58, -.09], [.42, .02], [-.42, .02], [-.59, -.10], [-.66, -.47]],
      [0, 0, 0], .79, .22, .14, "#243b8f", "glass"),
    box(.572, .081, [0, -.565, .015], .78, .07, "#3c57a6", "glass"),
    cap(.276, .235, [0, .054, 0], .108, .047, "#292b37", "metal"),
    cap(.281, .238, [0, .117, 0], .048, .021, "#4e5261", "metal"),
    move(casePart([[-.116, .14], [.116, .14], [.163, .322], [.267, .458], [.125, .632], [0, .855],
      [-.125, .632], [-.267, .458], [-.163, .322]], [0, 0, .027], .195, .044, .055, "#b9b9c1", "metal"), nib),
    move(stroke([0, .50], [0, .806], .126, .012, "#2b2a38"), nib),
    move(disk(.048, .053, [0, .481, .132], .024, .011, "#262735"), nib),
    ...eyes([0, -.315, .4], "#a6dcff", .40, .96, "#202858"),
  ];
}

function researcher(): RobotPart[] {
  const olive = "#818256", labSand = "#bfa98a";
  const focus: RobotPartGesture = { translate: [.025, -.072, 0], oneWay: true };
  const limb = Array.from({ length: 25 }, (_, index): Point => {
    const angle = (74 + index * 220 / 24) * Math.PI / 180;
    return [.40 * Math.cos(angle), .47 * Math.sin(angle)];
  });
  return [
    casePart([[-.57, -.69], [.60, -.69], [.65, -.51], [.53, -.34], [-.48, -.34], [-.67, -.51]],
      [0, 0, 0], .73, .15, .084, olive),
    tube(limb, .126, [-.11, -.014, -.054], labSand, "matte", false),
    box(.34, .066, [.155, -.271, .022], .52, .052, "#33333b", "metal"),
    disk(.149, .149, [-.395, -.309, .217], .125, .054, olive, "metal"),
    move(rotate(box(.171, .261, [.218, .43, .043], .36, .062, olive), -.33), focus),
    move(rotate(box(.116, .076, [.311, .692, .043], .263, .043, "#39343b", "metal"), -.33), focus),
    move(rotate(box(.095, .108, [.13, .170, .07], .203, .038, labSand, "metal"), -.33), focus),
    move(rotate(box(.059, .071, [.079, .038, .07], .151, .03, "#676157", "metal"), -.33), focus),
    ...eyes([.09, -.518, .37], "#fff0c5", .374, .75, "#626543"),
  ];
}

function finance(): RobotPart[] {
  const copper = "#b77755", rod = "#9d754e", gold = "#d3a54c";
  const parts = [
    tube(rectangle(.655, .567, .23), .092, [0, .055, 0], copper, "metal"),
    box(.722, .172, [0, -.465, 0], .50, .075, copper, "metal"),
    ...eyes([0, -.472, .252], "#fff1c2", .38, .73, "#754839"),
  ];
  for (const [row, y] of [.292, -.044].entries()) {
    parts.push(stroke([-.64, y], [.64, y], .004, .033, rod, .105, "metal"));
    const shift: RobotPartGesture = { translate: [row ? -.14 : .14, 0, 0], oneWay: true };
    const staticBead = row ? -.525 : .455;
    parts.push(disk(.104, .13, [staticBead, y, .006], .261, .101, row ? dark : gold, "metal"));
    for (const x of (row ? [-.145, .067, .279] : [-.381, -.169, .043])) {
      parts.push(move(disk(.100, .13, [x, y, .006], .252, .097, row ? gold : "#555052", "metal"), shift));
    }
  }
  return parts;
}

function designer(): RobotPart[] {
  const pivot: Point = [-.39, -.50];
  const cards = [
    { angle: -.99, z: -.24, color: "#e7a09d", motion: -.23 },
    { angle: -.51, z: -.081, color: "#b584c2", motion: -.13 },
    { angle: .055, z: .118, color: "#8654a5", motion: 0 },
  ];
  return [
    ...cards.map(({ angle, z, color, motion }) => {
      const [x, y] = pivot;
      const position: Vector = [x - .48 * Math.sin(angle), y + .48 * Math.cos(angle), z];
      const card = rotate(box(.401, .707, position, .22, .091, color), angle);
      return motion ? move(card, { pivot, roll: motion }) : card;
    }),
    disk(.089, .089, [pivot[0], pivot[1], .234], .057, .024, brass, "metal"),
    ...eyes([-.407, .121, .231], "#f9d4ff", .338, .90, "#653980"),
  ];
}

function developer(): RobotPart[] {
  const shell = "#276357", inset = "#20453d";
  const press: RobotPartGesture = { translate: [0, 0, -.085], oneWay: true };
  const keys = [
    { x: -.477, y: .133, pressed: false },
    { x: -.469, y: -.253, pressed: true },
    { x: -.003, y: -.253, pressed: false },
    { x: .464, y: -.253, pressed: true },
  ];
  return [
    casePart([[-.87, -.56], [.88, -.56], [.77, .277], [.647, .43], [-.63, .43], [-.77, .29]],
      [0, 0, 0], .73, .183, .118, shell),
    box(.705, .372, [0, -.07, .337], .13, .056, inset),
    box(.397, .165, [.219, .127, .433], .18, .059, "#488879"),
    ...keys.map(({ x, y, pressed }) => {
      const key = box(.171, .145, [x, y, .434], .19, .055, ivory);
      return pressed ? move(key, press) : key;
    }),
    ...eyes([.219, .127, .526], "#a5ffdb", .318, .81, "#285448"),
  ];
}

function photographer(): RobotPart[] {
  const gold = "#dca34c", silver = "#b1abad";
  const click: RobotPartGesture = { translate: [0, -.071, 0], oneWay: true };
  return [
    box(.80, .54, [0, -.108, 0], .67, .133, gold),
    box(.778, .145, [0, .317, .008], .681, .071, silver, "metal"),
    box(.343, .112, [.324, .315, .355], .070, .032, "#343039"),
    move(cap(.136, .106, [-.476, .47, .032], .101, .031, brass, "metal"), click),
    ...[-.762, .762].map(x => handle(.076, .095, .027, [x, .112, -.026], "#8d7357", "metal")),
    disk(.418, .419, [-.034, -.264, .343], .165, .075, silver, "metal"),
    disk(.343, .346, [-.034, -.264, .454], .129, .054, "#3e3942", "metal"),
    disk(.275, .274, [-.034, -.264, .524], .071, .032, "#291f31", "glass"),
    disk(.164, .157, [-.047, -.257, .567], .055, .026, "#442e5f", "glass"),
    disk(.036, .029, [-.13, -.182, .597], .014, .006, "#9980b3", "glass"),
    ...eyes([.324, .316, .392], "#fff4cf", .324, .75, "#211f27"),
  ];
}

function gardener(): RobotPart[] {
  const aqua = "#76ac94", deep = "#3c6859";
  const pour: RobotPartGesture = { roll: .15, pivot: [.40, -.27] };
  return [
    handle(.322, .470, .061, [-.333, .214, -.033], aqua, "metal"),
    casePart([[-.45, -.63], [.46, -.63], [.60, -.46], [.44, .21], [.31, .31], [-.30, .31], [-.46, .23], [-.61, -.47]],
      [-.055, 0, 0], .69, .20, .135, aqua),
    cap(.428, .36, [-.06, .299, 0], .074, .035, "#89b99f", "metal"),
    cap(.302, .236, [-.06, .336, 0], .023, .009, deep),
    box(.55, .065, [-.048, -.596, .001], .700, .050, "#679d85", "metal"),
    move(stroke([.376, -.29], [.715, .167], .022, .079, aqua, .216, "metal"), pour),
    move(rotate(disk(.135, .160, [.752, .218, .021], .248, .073, "#81b29a", "metal"), -.54), pour),
    move(disk(.090, .109, [.752, .222, .151], .035, .014, "#4b7768"), pour),
    ...[[.729, .255], [.778, .208], [.719, .188], [.778, .275]].map(([x, y]) =>
      move(disk(.013, .013, [x, y, .174], .011, .004, "#273f3a"), pour)),
    ...eyes([-.081, -.139, .348], "#fff5c2", .369, .91, "#466e5a"),
  ];
}

function musician(): RobotPart[] {
  const wood = "#994a43", gold = "#d4a854";
  const pendulum: RobotPartGesture = { roll: .27, pivot: [0, -.343] };
  return [
    casePart([[-.621, -.720], [.621, -.720], [.235, .721], [-.226, .721]],
      [0, 0, 0], .65, .109, .097, wood),
    casePart([[-.294, -.329], [.294, -.329], [.133, .525], [-.133, .525]],
      [0, 0, .333], .074, .059, .030, "#322c34", "glass"),
    ...[-.21, -.06, .08, .217, .359].map(y => {
      const x = .19 - (y + .21) * .14;
      return stroke([-x, y], [x, y], .375, .0085, "#977b60");
    }),
    move(stroke([0, -.331], [0, .442], .397, .016, gold, .042, "metal"), pendulum),
    move(box(.090, .048, [0, .137, .408], .072, .031, gold, "metal"), pendulum),
    disk(.045, .045, [0, -.331, .413], .043, .017, brass, "metal"),
    ...[-.41, .41].map(x => box(.089, .036, [x, -.722, -.013], .34, .024, "#472c2d")),
    ...eyes([0, -.522, .33], "#ffdc9e", .356, .79, "#693835"),
  ];
}

function language(): RobotPart[] {
  const bubble: Point[] = [[-.51, -.51], [-.25, -.338], [.02, -.355], [.34, -.305], [.56, -.15],
    [.60, .122], [.47, .311], [.18, .424], [-.228, .407], [-.47, .289], [-.59, .085], [-.55, -.17], [-.415, -.291]];
  const backBubble = bubble.map(([x, y]): Point => [-x * .90, y * .88]).reverse();
  return [
    move(casePart(backBubble, [.31, .189, -.193], .40, .103, .058, "#41658c"),
      { translate: [.047, .049, 0], roll: -.12 }),
    casePart(bubble, [-.172, -.055, .077], .491, .115, .063, "#eadfc6"),
    ...eyes([-.172, -.029, .324], "#adf3ff", .39, .99, "#37556c"),
  ];
}

function projects(): RobotPart[] {
  const clip: RobotPartGesture = { translate: [0, .038, .014], roll: .11, oneWay: true, pivot: [0, .55] };
  return [
    box(.584, .735, [0, -.046, 0], .499, .086, "#c27745"),
    box(.505, .599, [0, -.072, .252], .083, .038, "#e9d2b2"),
    move(handle(.079, .095, .032, [0, .690, .277], brass, "metal"), clip),
    move(box(.235, .119, [0, .558, .311], .137, .060, "#bd9558", "metal"), clip),
    move(box(.175, .032, [0, .502, .378], .048, .021, "#dcc495", "metal"), clip),
    ...[-.231, -.458].flatMap(y => [
      stroke([-.327, y], [-.283, y - .052], .304, .020, "#98795e", .032),
      stroke([-.283, y - .052], [-.172, y + .043], .304, .020, "#98795e", .032),
      stroke([-.093, y - .009], [.329, y - .009], .304, .017, "#a8896c", .032),
    ]),
    ...eyes([0, .175, .296], "#60473c", .377, .96, "#b7977e"),
  ];
}

type FrondSection = readonly [x: number, y: number, width: number, notch?: number];

function palmFrond(spine: readonly FrondSection[], position: Vector, color: string, sway: number): RobotPart {
  // Round the curve between the control sections while keeping the leaf's notches.
  const sections = spine.slice(0, -1).flatMap((start, index) => {
    const previous = spine[Math.max(0, index - 1)];
    const end = spine[index + 1];
    const next = spine[Math.min(spine.length - 1, index + 2)];
    return Array.from({ length: 4 }, (_, step): FrondSection => {
      const t = step / 4, squared = t * t, cubed = squared * t;
      const at = (axis: 0 | 1 | 2 | 3) => {
        const a = previous[axis] ?? 1, b = start[axis] ?? 1, c = end[axis] ?? 1, d = next[axis] ?? 1;
        return b + .5 * ((c - a) * t + (2 * a - 5 * b + 4 * c - d) * squared + (3 * b - a - 3 * c + d) * cubed);
      };
      return [at(0), at(1), Math.max(.003, at(2)), Math.min(1, at(3))];
    });
  });
  sections.push(spine[spine.length - 1]);
  const last = sections.length - 1;
  const sides = 16;
  const rings = sections.map(([x, y, width, notch = 1], index) => {
    const [px, py] = sections[Math.max(0, index - 1)];
    const [qx, qy] = sections[Math.min(last, index + 1)];
    const length = Math.hypot(qx - px, qy - py);
    const sideX = (qy - py) / length, sideY = (px - qx) / length;
    const thickness = Math.min(width, .016 + width * .31);
    const rise = Math.sin(Math.PI * index / last) * .058;
    return Array.from({ length: sides }, (_, side) => {
      const angle = side * Math.PI * 2 / sides;
      const across = Math.cos(angle), forward = Math.sin(angle);
      const span = width * (across * sideY < 0 ? notch : 1);
      return [
        x + sideX * across * span, y + sideY * across * span, rise + forward * thickness,
        sideX * across * thickness, sideY * across * thickness, forward * span,
      ];
    });
  });
  return {
    vertices: joinRings(rings, false), position, color, finish: "matte", motion: "fixed", gesture: { roll: sway },
  };
}

function beachPalm(): RobotPart[] {
  const trunk: Point[] = [[-.567, -.621], [-.079, -.621], [-.127, -.465], [-.147, -.327], [-.108, -.164],
    [-.03, .018], [.058, .173], [.162, .322], [.084, .427], [-.02, .367], [-.169, .218], [-.312, .039],
    [-.439, -.146], [-.507, -.296], [-.552, -.452]];
  return [
    cap(.746, .458, [.018, -.670, .028], .247, .121, "#e9c58b"),
    casePart(trunk, [0, 0, -.007], .462, .148, .091, "#c89050"),
    tube([[-.435, -.254], [-.373, -.269], [-.301, -.276], [-.222, -.266], [-.169, -.251]],
      .010, [0, 0, .224], "#ad7446", "matte", false),
    tube([[-.324, -.053], [-.268, -.075], [-.209, -.082], [-.151, -.078], [-.104, -.062]],
      .009, [0, 0, .224], "#ad7446", "matte", false),
    tube([[-.23, .113], [-.19, .088], [-.137, .07], [-.081, .067], [-.047, .076]],
      .008, [0, 0, .224], "#ad7446", "matte", false),
    ...eyes([-.344, -.424, .215], "#fff1b0", .184, .60, "#b47c42"),
    palmFrond([[0, 0, .039], [-.093, .155, .081], [-.225, .305, .124], [-.367, .365, .139],
      [-.446, .362, .128, .60], [-.536, .34, .119], [-.627, .299, .099, .63], [-.701, .235, .070], [-.774, .149, .003]],
    [.070, .343, -.111], "#8ea351", -.13),
    palmFrond([[0, 0, .038], [.13, .134, .088], [.295, .239, .114], [.433, .26, .126],
      [.52, .244, .112, .64], [.612, .202, .087], [.677, .144, .060], [.73, .067, .004]],
    [.077, .365, -.063], "#9aac59", .12),
    palmFrond([[0, 0, .041], [-.167, .104, .084], [-.325, .145, .119], [-.455, .132, .133],
      [-.53, .103, .124, .54], [-.612, .065, .112], [-.687, .027, .090, .65], [-.780, -.065, .072], [-.891, -.189, .004]],
    [.040, .328, .104], "#a7b85f", -.15),
    palmFrond([[0, 0, .041], [.145, .088, .090], [.284, .110, .127], [.410, .080, .147],
      [.481, .042, .138, .59], [.551, -.022, .126], [.607, -.107, .105, .54], [.657, -.195, .101],
      [.687, -.278, .072], [.687, -.393, .004]],
    [.092, .331, .139], "#849a4b", .16),
  ];
}

export const SPECIALIST_MODELS = {
  "specialist-travel": travel,
  "specialist-kitchen": kitchen,
  "specialist-cloud": cloud,
  "specialist-law": lawyer,
  "specialist-sports": sports,
  "specialist-writer": writer,
  "specialist-research": researcher,
  "specialist-finance": finance,
  "specialist-design": designer,
  "specialist-developer": developer,
  "specialist-photo": photographer,
  "specialist-garden": gardener,
  "specialist-music": musician,
  "specialist-language": language,
  "specialist-projects": projects,
  "specialist-beach-palm": beachPalm,
} satisfies Record<SpecialistShape, Model>;
