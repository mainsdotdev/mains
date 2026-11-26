import { useEffect, useRef, type CSSProperties, type PointerEvent } from "react";
import { normalizeAssistantAvatar, type AssistantAvatar as Avatar } from "@mains/contracts/assistants";
import { cn } from "@/lib/cn";
import { SquareCell, squareCellStyle, SQUARE_PULSE_DURATION_MS } from "@/components/ui";
import { assistantAvatarDesign } from "../lib/assistant-avatar-design";
import { avatarPhase, type MosaicTile } from "../lib/assistant-mosaic";
import type { AssistantAvatarState } from "../lib/assistant-avatar-activity";
import { AssistantRobotAvatar } from "./assistant-robot-avatar";
import "./assistant-avatar.css";

export const AVATAR_COLORS = {
  coral: { label: "Coral", fill: "#C86257", light: "#E19384", ink: "#A8493E" },
  amber: { label: "Amber", fill: "#BA8732", light: "#DEB462", ink: "#8A5B0F" },
  lime: { label: "Lime", fill: "#7D9F44", light: "#B1CC7A", ink: "#557621" },
  mint: { label: "Mint", fill: "#37927D", light: "#77BEA6", ink: "#217660" },
  cyan: { label: "Cyan", fill: "#2D90A5", light: "#7BC6D5", ink: "#137489" },
  blue: { label: "Blue", fill: "#4881B8", light: "#88B2DC", ink: "#326EA9" },
  violet: { label: "Violet", fill: "#8268B8", light: "#A893D5", ink: "#704EA3" },
  rose: { label: "Rose", fill: "#B65B8A", light: "#D997B9", ink: "#A33D74" },
} as const;

export function assistantMentionTextColor(avatar?: Avatar): string {
  const { ink, light } = AVATAR_COLORS[normalizeAssistantAvatar(avatar).color];
  const tone = `color-mix(in srgb, ${ink} var(--assistant-mention-ink), ${light})`;
  return `color-mix(in srgb, ${tone} var(--assistant-mention-tint), var(--assistant-mention-foreground))`;
}

function tileStyle([x, y, width, height, tone, corners = 3]: MosaicTile): CSSProperties {
  const radii = typeof corners === "number" ? [corners] : corners;
  const horizontal = radii.map(radius => `${radius / width * 100}%`).join(" ");
  const vertical = radii.map(radius => `${radius / height * 100}%`).join(" ");
  return {
    ...squareCellStyle(y, x, 101),
    left: `${x}%`, top: `${y}%`, width: `${width}%`, height: `${height}%`,
    "--tsq-base": `var(--avatar-${tone})`,
    "--tsq-radius": `${horizontal} / ${vertical}`,
  } as CSSProperties;
}

type AvatarProps = {
  avatar?: Avatar; working?: boolean; seed?: string; animated?: boolean; className?: string;
};

export function AssistantAvatar({ avatar, robotState, animateRobotState, ...props }: AvatarProps & {
  robotState?: AssistantAvatarState; animateRobotState?: boolean;
}) {
  const selected = normalizeAssistantAvatar(avatar);
  const shape = assistantAvatarDesign(selected.shape);
  if (shape.family === "robot") {
    return <AssistantRobotAvatar shape={shape.shape} working={props.working} state={robotState}
      animateState={animateRobotState} className={props.className} />;
  }
  return <ClassicAssistantAvatar {...props} selected={selected} shape={shape} />;
}

function ClassicAssistantAvatar({ selected, shape, working = false, seed = "assistant", animated = true, className }: Omit<AvatarProps, "avatar"> & {
  selected: Avatar;
  shape: Exclude<ReturnType<typeof assistantAvatarDesign>, { family: "robot" }>;
}) {
  const color = AVATAR_COLORS[selected.color];
  const root = useRef<HTMLSpanElement>(null);
  const phase = avatarPhase(seed);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    if (!animated) {
      delete element.dataset.gaze;
      element.dataset.paused = "true";
      return;
    }
    let visible = true;
    const update = () => { element.dataset.paused = String(!animated || !visible || document.hidden); };
    const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
    observer?.observe(element);
    document.addEventListener("visibilitychange", update);
    update();
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, [animated]);
  const look = (event: PointerEvent<HTMLSpanElement>) => {
    if (!animated || event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = (event.clientX - bounds.left) / bounds.width * 2 - 1;
    const y = (event.clientY - bounds.top) / bounds.height * 2 - 1;
    event.currentTarget.dataset.gaze = Math.max(Math.abs(x), Math.abs(y)) < 0.3 ? "center"
      : Math.abs(x) > Math.abs(y) ? x < 0 ? "left" : "right" : y < 0 ? "up" : "down";
  };
  const [leftEye, rightEye, eyeY] = shape.eyes;
  return <span ref={root} aria-hidden="true" data-avatar-shape={selected.shape} data-avatar-family={shape.family}
    data-working={working} data-animated={animated} data-paused={!animated}
    className={cn("mosaic-avatar inline-flex shrink-0", className)}
    onPointerMove={look} onPointerLeave={event => { delete event.currentTarget.dataset.gaze; }}
    style={{
      "--avatar-base": color.fill, "--avatar-light": color.light, "--avatar-ink": color.ink,
      "--tsq-duration": `${SQUARE_PULSE_DURATION_MS}ms`, "--tsq-phase": phase, "--avatar-eye-delay": `${-phase * 10.4}s`,
    } as CSSProperties}>
    <span className="mosaic-avatar__body" style={{ clipPath: shape.outline }}>
      {shape.family === "mosaic" ? shape.tiles.map((tile, index) => <SquareCell key={index} data-cell-id={String(index)}
        className={cn("mosaic-avatar__tile", shape.accents.includes(index) && "mosaic-avatar__tile--accent")}
        style={tileStyle(tile)} />) : (
        <span className="material-avatar__surface">
          <span className="material-avatar__finish" />
          <span className="material-avatar__glint" />
        </span>
      )}
      <span className="mosaic-avatar__face">
        <span className="mosaic-avatar__eye" data-eye="left" style={{ left: `${leftEye}%`, top: `${eyeY}%` }} />
        <span className="mosaic-avatar__eye" data-eye="right" style={{ left: `${rightEye}%`, top: `${eyeY}%` }} />
      </span>
    </span>
  </span>;
}
