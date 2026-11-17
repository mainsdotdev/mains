import { useEffect, useRef, type CSSProperties, type PointerEvent } from "react";
import { normalizeAssistantAvatar, type AssistantAvatar as Avatar } from "@mains/contracts/assistants";
import { cn } from "@/lib/cn";
import { SquareCell, squareCellStyle, SQUARE_PULSE_DURATION_MS } from "@/components/ui";
import { MOSAIC_SHAPES, avatarPhase, type MosaicTile } from "../lib/assistant-mosaic";
import "./assistant-avatar.css";

export const AVATAR_COLORS = {
  coral: { label: "Coral", fill: "#EE7567", light: "#F5A08F", ink: "#B34E42" },
  amber: { label: "Amber", fill: "#DDA13B", light: "#F1C46B", ink: "#936110" },
  lime: { label: "Lime", fill: "#95BD51", light: "#C0DE85", ink: "#5A7D23" },
  mint: { label: "Mint", fill: "#42AE95", light: "#81CFB4", ink: "#237D66" },
  cyan: { label: "Cyan", fill: "#36ABC5", light: "#86D7E7", ink: "#147B92" },
  blue: { label: "Blue", fill: "#569ADB", light: "#94C2EF", ink: "#3575B4" },
  violet: { label: "Violet", fill: "#9274D3", light: "#B7A0E7", ink: "#7753AD" },
  rose: { label: "Rose", fill: "#D96CA4", light: "#ECA4C9", ink: "#AD417B" },
} as const;
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

export function AssistantAvatar({ avatar, working = false, seed = "assistant", animated = true, className }: {
  avatar?: Avatar; working?: boolean; seed?: string; animated?: boolean; className?: string;
}) {
  const selected = normalizeAssistantAvatar(avatar);
  const shape = MOSAIC_SHAPES[selected.shape];
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
  return <span ref={root} aria-hidden="true" data-avatar-shape={selected.shape} data-working={working} data-animated={animated} data-paused={!animated}
    className={cn("mosaic-avatar inline-flex shrink-0", className)}
    onPointerMove={look} onPointerLeave={event => { delete event.currentTarget.dataset.gaze; }}
    style={{
      "--avatar-base": color.fill, "--avatar-light": color.light, "--avatar-ink": color.ink,
      "--tsq-duration": `${SQUARE_PULSE_DURATION_MS}ms`, "--tsq-phase": phase, "--avatar-eye-delay": `${-phase * 10.4}s`,
    } as CSSProperties}>
    <span className="mosaic-avatar__body" style={{ clipPath: shape.outline }}>
      {shape.tiles.map((tile, index) => <SquareCell key={index} data-cell-id={String(index)}
        className={cn("mosaic-avatar__tile", shape.accents.includes(index) && "mosaic-avatar__tile--accent")}
        style={tileStyle(tile)} />)}
      <span className="mosaic-avatar__face">
        <span className="mosaic-avatar__eye" data-eye="left" style={{ left: `${leftEye}%`, top: `${eyeY}%` }} />
        <span className="mosaic-avatar__eye" data-eye="right" style={{ left: `${rightEye}%`, top: `${eyeY}%` }} />
      </span>
    </span>
  </span>;
}
