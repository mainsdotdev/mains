import type { AssistantRobotShape } from "@mains/contracts/assistants";
import { ellipse, plate, rectangle, roundedProfile, type Point, type RobotPart } from "./assistant-robot-mesh";
import { SPECIALIST_MODELS } from "./assistant-specialist-models";

type TerminalPreset = {
  outline: readonly Point[];
  shell: string;
  panel: string;
  caseWidth: number;
  panelSize: Point;
  depth: number;
  screenX?: number;
};

const TERMINALS = {
  "terminal-amber": {
    outline: [[-.86, -.63], [.86, -.63], [.83, -.32], [.56, .63], [-.56, .63], [-.83, -.32]],
    shell: "#c76929", panel: "#ead2a4", caseWidth: .85, panelSize: [.64, .44], depth: .72,
  },
  "terminal-teal": {
    outline: [[-.9, -.52], [.9, -.52], [.91, .31], [.71, .55], [-.72, .55], [-.91, .31]],
    shell: "#398b80", panel: "#d4ded2", caseWidth: .9, panelSize: [.7, .38], depth: .58,
  },
  "terminal-cherry": {
    outline: [[-.7, -.76], [.7, -.76], [.73, .45], [.53, .73], [-.55, .73], [-.73, .52]],
    shell: "#ad4747", panel: "#e3c5b0", caseWidth: .7, panelSize: [.54, .51], depth: .7,
  },
  "terminal-indigo": {
    outline: [[-.84, -.61], [.84, -.61], [.81, .25], [.65, .56], [-.5, .64], [-.83, .25]],
    shell: "#4967a6", panel: "#c2d0e7", caseWidth: .83, panelSize: [.65, .43], depth: .77,
  },
  "terminal-plum": {
    outline: [[-.51, -.71], [.51, -.71], [.74, -.28], [.79, .4], [.57, .72], [-.57, .72], [-.79, .43], [-.74, -.27]],
    shell: "#78466d", panel: "#dec1d7", caseWidth: .56, panelSize: [.56, .46], depth: .78,
  },
  "terminal-olive": {
    outline: [[-.73, -.59], [.73, -.59], [.89, -.2], [.77, .22], [.44, .6], [-.47, .6], [-.78, .27], [-.89, -.16]],
    shell: "#798439", panel: "#d9d8a8", caseWidth: .75, panelSize: [.55, .39], depth: .83,
  },
  "terminal-frost": {
    outline: [[-.9, -.56], [.89, -.56], [.9, -.31], [.8, -.04], [.5, .49], [.33, .55], [-.61, .55], [-.9, .27]],
    shell: "#75b3c8", panel: "#d7eeec", caseWidth: .9, panelSize: [.5, .36], depth: .65, screenX: -.18,
  },
} as const satisfies Record<string, TerminalPreset>;

function terminal(preset: TerminalPreset): RobotPart[] {
  const { outline, shell, panel, caseWidth, panelSize: [width, height], depth, screenX = 0 } = preset;
  const bottom = Math.min(...outline.map(([, y]) => y));
  const front = depth / 2;
  const screenY = .07;
  const upperCase = outline.map(([x, y], index): Point => [x, index < 2 ? y + .18 : y]);
  const parts = [
    plate(roundedProfile(upperCase, .14), [0, .032, 0], depth, .096, shell),
    plate(rectangle(caseWidth, .12, .1), [0, bottom + .113, 0], depth + .014, .06, "#2e2828"),
    plate(rectangle(width, height, .19), [screenX, screenY, front - .014], .14, .064, panel),
    plate(rectangle(width - .102, height - .108, .098), [screenX, screenY, front + .063], .056, .027, "#382d2a", "metal"),
    plate(rectangle(width - .123, height - .129, .086), [screenX, screenY, front + .086], .028, .012, "#221914", "glass"),
    plate(ellipse(.113), [-caseWidth + .061, -.15, -.005], .07, .024, "#322829", "matte", "fixed", -Math.PI / 2),
    plate(rectangle(.24, .12, .045), [0, -.22, -front + .01], .05, .02, "#423333"),
  ];
  if (screenX) {
    for (const y of [-.13, -.045, .04]) {
      parts.push(plate(rectangle(.10, .018, .018), [.53, y, front + .002], .02, .007, "#2b444d"));
    }
  }
  for (const x of [-.228, .228]) {
    // One mesh for the dot matrix in each eye. Its center remains stable when the eye squints.
    const eye: number[] = [];
    for (const row of [-1, 0, 1]) {
      for (const column of [-1.5, -.5, .5, 1.5]) {
        const dot = plate(ellipse(.022, .022, 10), [0, 0, 0], .006, .002, "#ffbd6b");
        for (let index = 0; index < dot.vertices.length; index += 6) {
          eye.push(dot.vertices[index] + column * .048, dot.vertices[index + 1] + row * .048,
            dot.vertices[index + 2], dot.vertices[index + 3], dot.vertices[index + 4], dot.vertices[index + 5]);
        }
      }
    }
    parts.push({ vertices: new Float32Array(eye), position: [screenX + x, screenY, front + .105],
      color: "#ffbd6b", finish: "light", motion: "terminalEyes" });
  }
  return parts;
}

const CLEAR_SHELLS = {
  "clear-violet": {
    outline: [[-.54, -.65], [.54, -.65], [.79, -.46], [.77, -.06], [.64, .33], [.45, .67], [.32, .86],
      [.12, .81], [-.23, .59], [-.57, .28], [-.8, -.08], [-.8, -.43]],
    shell: "#7657ef", core: "#afa1ec", light: "#f6eaff", width: .48, depth: .74,
  },
  "clear-glacier": {
    outline: [[-.61, -.63], [.61, -.63], [.85, -.38], [.77, .12], [.56, .52], [.23, .67],
      [-.23, .67], [-.56, .52], [-.77, .12], [-.85, -.38]],
    shell: "#308fae", core: "#8bcbdc", light: "#e4fcff", width: .53, depth: .72,
  },
  "clear-jade": {
    outline: [[-.58, -.64], [.63, -.64], [.8, -.44], [.78, .43], [.6, .64], [-.43, .7], [-.79, .32], [-.82, -.44]],
    shell: "#29a883", core: "#87cfb0", light: "#dfffef", width: .48, depth: .68,
  },
  "clear-rose": {
    outline: [[-.47, -.72], [.45, -.72], [.75, -.41], [.83, .2], [.54, .57], [-.04, .73], [-.61, .51], [-.82, .17], [-.75, -.41]],
    shell: "#c74e97", core: "#e6a0c5", light: "#ffe3f8", width: .49, depth: .76,
  },
  "clear-honey": {
    outline: [[-.35, -.79], [.35, -.79], [.64, -.54], [.67, .43], [.44, .78], [-.42, .78], [-.65, .5], [-.66, -.52]],
    shell: "#d78f24", core: "#edbf67", light: "#fff1bf", width: .44, depth: .75,
  },
  "clear-lime": {
    outline: [[-.58, -.58], [.57, -.58], [.82, -.47], [.94, -.25], [.94, .22], [.75, .49], [.48, .59],
      [-.55, .59], [-.81, .5], [-.94, .25], [-.94, -.25], [-.82, -.48]],
    shell: "#8caf27", core: "#c3da66", light: "#f9ffd8", width: .57, depth: .71,
  },
  "clear-coral": {
    outline: [[-.48, -.65], [.48, -.65], [.84, -.23], [.84, .12], [.19, .82], [-.07, .85], [-.8, .28], [-.87, -.07]],
    shell: "#ee6354", core: "#f6a489", light: "#fff0e6", width: .48, depth: .82,
  },
} as const;

function clearShell(preset: typeof CLEAR_SHELLS[keyof typeof CLEAR_SHELLS]): RobotPart[] {
  const { outline, shell, core, light, width, depth } = preset;
  const parts = [
    plate(roundedProfile(outline, .24), [0, 0, 0], depth, .18, shell, "shell"),
    plate(rectangle(width + .025, .48, .15), [.045, -.012, -.13], .04, .018, "#273041"),
    plate(rectangle(width + .06, .09, .07), [0, -.5, -.08], .38, .05, "#495367"),
    plate(rectangle(width * .89, .366, .28), [-.045, -.105, .075], .24, .104, core, "matte", "clearFace"),
    plate(rectangle(.18, .051, .038), [0, -.36, -.21], .055, .025, "#252939", "metal"),
  ];
  for (const [x, y] of [[.07, .27], [.313, .23], [.44, -.092]]) {
    parts.push(plate(rectangle(.062, .063, .022), [x, y, -.088], .039, .016, "#656a82", "metal"));
  }
  for (const x of [-.228, .138]) {
    parts.push(
      plate(ellipse(.108, .116), [x, -.11, .194], .03, .012, "#241e39", "glass", "clearFace"),
      plate(ellipse(.041, .05), [x, -.11, .213], .018, .007, light, "light", "clearEyes"),
    );
  }
  return parts;
}

const METAL_SHELLS = {
  "metal-silver": {
    outline: [[-.72, -.7], [.72, -.7], [.72, .31], [.34, .71], [-.72, .71]],
    shell: "#aeb2b5", iris: "#91dfae", depth: .69,
  },
  "metal-bronze": {
    outline: [[-.46, -.69], [.5, -.69], [.77, -.38], [.73, .49], [.53, .68], [-.52, .68], [-.75, .43], [-.76, -.41]],
    shell: "#b37f62", iris: "#ffcf86", depth: .78,
  },
  "metal-graphite": {
    outline: [[-.78, -.61], [.78, -.61], [.82, -.27], [.55, .65], [-.55, .65], [-.82, -.27]],
    shell: "#555d6a", iris: "#9edcfc", depth: .74,
  },
  "metal-titanium": {
    outline: [[-.69, -.7], [.4, -.7], [.69, -.43], [.69, .73], [-.36, .73], [-.69, .4]],
    shell: "#8f879f", iris: "#d1b2ff", depth: .66,
  },
  "metal-copper": {
    outline: [[-.62, -.54], [.63, -.54], [.88, -.33], [.89, .25], [.58, .55], [-.56, .55], [-.89, .28], [-.89, -.31]],
    shell: "#b65e48", iris: "#ffad9c", depth: .69,
  },
  "metal-ice": {
    outline: [[-.33, -.7], [.33, -.7], [.61, -.5], [.76, -.25], [.8, .03], [.72, .38], [.54, .63],
      [.27, .78], [0, .82], [-.28, .78], [-.55, .62], [-.73, .36], [-.8, .03], [-.75, -.28], [-.59, -.52]],
    shell: "#7497b5", iris: "#8ceeea", depth: .58,
  },
  "metal-moss": {
    outline: [[-.26, -.78], [.26, -.78], [.65, -.46], [.83, .27], [.62, .68], [-.62, .68], [-.83, .27], [-.65, -.46]],
    shell: "#5c7354", iris: "#d6f38b", depth: .77,
  },
} as const;

function metalShell(preset: typeof METAL_SHELLS[keyof typeof METAL_SHELLS]): RobotPart[] {
  const { outline, shell, iris, depth } = preset;
  const profile = roundedProfile(outline, .18);
  const gasket = profile.map(([x, y]): Point => [x * .968, y * .968]);
  const front = depth / 2;
  return [
    plate(profile, [0, 0, -depth * .365], depth * .27, .046, shell, "metal"),
    plate(gasket, [0, 0, -depth * .205], depth * .11, .028, "#24262e"),
    plate(profile, [0, 0, depth * .16], depth * .68, .087, shell, "metal"),
    plate(ellipse(.438), [0, -.025, front + .002], .109, .05, "#49494e", "metal"),
    plate(ellipse(.376), [0, -.025, front + .061], .039, .018, "#1b2028", "glass"),
    plate(ellipse(.226), [0, -.027, front + .086], .02, .009, iris, "light", "iris"),
    plate(ellipse(.131), [0, -.027, front + .1], .023, .01, "#15191e", "glass", "iris"),
    plate(ellipse(.348, .342, 52), [0, -.025, front + .106], .027, .012, "#2f3036", "metal", "lid"),
    plate(rectangle(.225, .057, .046), [0, -.28, -front - .011], .04, .018, "#23252a"),
  ];
}

type RobotFactory = () => RobotPart[];
const MODELS: Record<AssistantRobotShape, RobotFactory> = {
  ...SPECIALIST_MODELS,
  "terminal-amber": () => terminal(TERMINALS["terminal-amber"]),
  "terminal-teal": () => terminal(TERMINALS["terminal-teal"]),
  "terminal-cherry": () => terminal(TERMINALS["terminal-cherry"]),
  "terminal-indigo": () => terminal(TERMINALS["terminal-indigo"]),
  "terminal-plum": () => terminal(TERMINALS["terminal-plum"]),
  "terminal-olive": () => terminal(TERMINALS["terminal-olive"]),
  "terminal-frost": () => terminal(TERMINALS["terminal-frost"]),
  "clear-violet": () => clearShell(CLEAR_SHELLS["clear-violet"]),
  "clear-glacier": () => clearShell(CLEAR_SHELLS["clear-glacier"]),
  "clear-jade": () => clearShell(CLEAR_SHELLS["clear-jade"]),
  "clear-rose": () => clearShell(CLEAR_SHELLS["clear-rose"]),
  "clear-honey": () => clearShell(CLEAR_SHELLS["clear-honey"]),
  "clear-lime": () => clearShell(CLEAR_SHELLS["clear-lime"]),
  "clear-coral": () => clearShell(CLEAR_SHELLS["clear-coral"]),
  "metal-silver": () => metalShell(METAL_SHELLS["metal-silver"]),
  "metal-bronze": () => metalShell(METAL_SHELLS["metal-bronze"]),
  "metal-graphite": () => metalShell(METAL_SHELLS["metal-graphite"]),
  "metal-titanium": () => metalShell(METAL_SHELLS["metal-titanium"]),
  "metal-copper": () => metalShell(METAL_SHELLS["metal-copper"]),
  "metal-ice": () => metalShell(METAL_SHELLS["metal-ice"]),
  "metal-moss": () => metalShell(METAL_SHELLS["metal-moss"]),
};

export function createRobotModel(shape: AssistantRobotShape): RobotPart[] {
  return MODELS[shape]();
}
