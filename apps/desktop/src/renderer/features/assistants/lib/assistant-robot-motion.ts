import type { AssistantAvatarState } from "./assistant-avatar-activity";

const GESTURE_MS = {
  blink: 190,
  glance: 1260,
  think: 1240,
  reply: 520,
  shake: 480,
  nod: 580,
  dip: 680,
  greet: 940,
} as const;
export type RobotGesture = keyof typeof GESTURE_MS;

const ENTRY_GESTURES: Partial<Record<AssistantAvatarState, RobotGesture>> = {
  thinking: "think", replying: "reply", waiting: "shake", done: "nod", failed: "dip",
};

export function robotEntryGesture(state: AssistantAvatarState): RobotGesture | undefined {
  return ENTRY_GESTURES[state];
}

export function nextRobotAmbientGesture(state: AssistantAvatarState, tick: number, welcome = false) {
  if (welcome && state === "idle") {
    return { delay: 7600 + Math.random() * 3500, gesture: tick % 2 ? "blink" as const : "glance" as const };
  }
  if (state === "thinking") return { delay: 5200 + Math.random() * 2400, gesture: "think" as const };
  const canGlance = state === "idle" || state === "done" || state === "failed";
  return {
    delay: 9800 + Math.random() * 4600,
    gesture: canGlance && tick % 3 === 2 ? "glance" as const : "blink" as const,
  };
}

export function robotRestingPose(state: AssistantAvatarState) {
  return {
    focus: state === "thinking" ? .42 : state === "replying" ? .15 : 0,
    lookY: state === "waiting" ? .42 : 0,
  };
}

type GesturePose = Partial<Record<"yaw" | "pitch" | "roll" | "lookX" | "lookY" | "blink", number>>;

const REACTION_MS = { blink: 320, doubleBlink: 650, spin: 1080, sway: 890, shiver: 560, glance: 1120, nod: 750 } as const;
export type RobotSelectionReaction = keyof typeof REACTION_MS;

const SELECTION_REACTIONS = Object.keys(REACTION_MS) as RobotSelectionReaction[];
const IDLE_REACTIONS = ["blink", "doubleBlink", "glance", "sway", "nod"] as const;

function chooseReaction(reactions: readonly RobotSelectionReaction[], previous?: RobotSelectionReaction): RobotSelectionReaction {
  const choices = reactions.filter(reaction => reaction !== previous);
  return choices[Math.floor(Math.random() * choices.length)];
}

export function nextRobotSelectionReaction(previous?: RobotSelectionReaction): RobotSelectionReaction {
  return chooseReaction(SELECTION_REACTIONS, previous);
}

export function createRobotSelectionReactions(entry: string) {
  const selected = SELECTION_REACTIONS.find(reaction => reaction === entry) ?? nextRobotSelectionReaction();
  const followups = (["blink", "glance"] as const).filter(reaction => reaction !== (selected === "doubleBlink" ? "blink" : selected));
  if (Math.random() < .5) followups.reverse();
  let previous = selected;
  let played = 0;
  return {
    entry: selected,
    delay() {
      const [minimum, spread] = played === 0 ? [450, 250] : followups.length ? [1450, 500] : [2600, 1800];
      return minimum + Math.random() * spread;
    },
    next() {
      played++;
      previous = followups.shift() ?? chooseReaction(IDLE_REACTIONS, previous);
      return previous;
    },
  };
}

function smooth(progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t);
}

function blinkAt(progress: number) {
  return smooth(progress / .36) * smooth((1 - progress) / .43);
}

export function sampleWorkingPose(elapsed: number): GesturePose {
  const time = elapsed / 1000;
  const easeIn = smooth(time / .35);
  return {
    yaw: .32 * Math.sin(2.6 * time) * easeIn,
    pitch: -.12 * Math.sin(3.4 * time) * easeIn,
    roll: .11 * Math.sin(2.6 * time + .5) * easeIn,
    lookX: .67 * Math.sin(1.9 * time) * easeIn,
    blink: blinkAt(((time + 2.5) % 3.2) / .32),
  };
}

export function sampleAvatarReaction(kind: RobotSelectionReaction, elapsed: number, direction: number, subtle = false): GesturePose | undefined {
  const progress = Math.max(0, elapsed) / REACTION_MS[kind];
  if (progress >= 1) return undefined;
  const arc = Math.sin(Math.PI * progress) ** 2;
  switch (kind) {
    case "blink":
      return { blink: blinkAt(progress) };
    case "doubleBlink":
      return { blink: blinkAt(progress / .42) + blinkAt((progress - .52) / .48) };
    case "spin":
      return { yaw: direction * Math.PI * 2 * smooth(progress), pitch: -.10 * arc };
    case "sway": {
      const shake = direction * Math.sin(4 * Math.PI * progress) * arc;
      return { yaw: .38 * shake, roll: .22 * shake };
    }
    case "shiver": {
      const shake = Math.sin(14 * Math.PI * progress) * arc;
      return { yaw: direction * .17 * shake, roll: .10 * shake, pitch: .05 * shake };
    }
    case "glance": {
      const look = direction * smooth(progress / .18) * smooth((1 - progress) / .26) * (subtle ? .8 : 1);
      return { lookX: look, lookY: .05 * Math.abs(look) };
    }
    case "nod": {
      const amount = arc * (subtle ? .44 : 1);
      return { pitch: .31 * amount, roll: direction * .12 * amount, lookY: .52 * amount };
    }
  }
}

export function sampleRobotGesture(gesture: RobotGesture, elapsed: number, direction: number): GesturePose | undefined {
  const progress = Math.max(0, elapsed) / GESTURE_MS[gesture];
  if (progress >= 1) return undefined;
  const ease = Math.sin(Math.PI * progress) ** 2;
  const side = direction * Math.sin(2 * Math.PI * progress) * ease;
  switch (gesture) {
    case "blink":
      return { blink: ease };
    case "glance":
      return { yaw: .12 * side, roll: .09 * side, lookX: .75 * side };
    case "think":
      return { yaw: .13 * side, pitch: -.09 * ease, roll: direction * .12 * ease, lookX: .95 * side, lookY: .54 * ease };
    case "reply":
      return { pitch: .05 * ease, lookY: .19 * ease };
    case "shake": {
      const shake = Math.sin(4 * Math.PI * progress) * Math.sin(Math.PI * progress);
      return { yaw: .18 * shake, roll: .075 * shake, lookX: -.34 * shake };
    }
    case "nod":
      return { pitch: .18 * ease, blink: ease * .68 };
    case "dip":
      return { pitch: .115 * ease, roll: direction * .055 * ease };
    case "greet": {
      const nod = Math.sin(Math.PI * Math.min(1, Math.max(0, (progress - .15) / .7))) ** 2;
      const blink = Math.sin(Math.PI * Math.min(1, Math.max(0, (progress - .42) / .22))) ** 2;
      return { yaw: .22 * side, pitch: .23 * nod, roll: direction * .12 * ease, lookY: .65 * ease, blink };
    }
  }
}
