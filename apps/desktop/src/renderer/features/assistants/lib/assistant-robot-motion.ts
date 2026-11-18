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
