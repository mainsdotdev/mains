import { useEffect, useRef, type CSSProperties, type PointerEvent } from "react";
import { normalizeAssistantAvatar, type AssistantAvatar as Avatar } from "@mains/contracts/assistants";
import { cn } from "@/lib/cn";
import { SquareCell, squareCellStyle, SQUARE_PULSE_DURATION_MS } from "@/components/ui";
import { AVATAR_PARTICLES, AVATAR_GRID_SIDES, AVATAR_FLOWER_CLIP, avatarPhase, type AvatarDetail } from "../lib/assistant-particles";
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
export function AssistantAvatar({ avatar, working = false, seed = "assistant", detail = "compact", animated = true, className }: {
  avatar?: Avatar; working?: boolean; seed?: string; detail?: AvatarDetail; animated?: boolean; className?: string;
}) {
  const selected = normalizeAssistantAvatar(avatar);
  const color = AVATAR_COLORS[selected.color];
  const root = useRef<HTMLSpanElement>(null);
  const phase = avatarPhase(seed);
  const side = AVATAR_GRID_SIDES[detail];
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    if (!animated) { element.dataset.paused = "true"; return; }
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
  return <span ref={root} aria-hidden="true" data-avatar-shape={selected.shape} data-working={working} data-animated={animated} data-paused={!animated}
    className={cn("particle-avatar inline-flex shrink-0 items-center justify-center", className)}
    onPointerMove={look} onPointerLeave={event => { delete event.currentTarget.dataset.gaze; }}
    style={{ "--avatar-fill": color.fill, "--avatar-light": color.light, "--avatar-ink": color.ink, "--tsq-duration": `${working ? SQUARE_PULSE_DURATION_MS : 3600}ms`, "--tsq-phase": phase, "--avatar-eye-delay": `${-phase * 10.4}s` } as CSSProperties}>
    <span className="particle-avatar__grid" style={{ gridTemplateColumns: `repeat(${side}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${side}, minmax(0, 1fr))`, clipPath: selected.shape === "flower" ? AVATAR_FLOWER_CLIP : undefined }}>
      {AVATAR_PARTICLES[selected.shape][detail].map(particle => <SquareCell key={particle.id} data-cell-id={particle.id} data-eye={particle.eye}
        className="particle-avatar__cell"
        style={{ ...squareCellStyle(particle.row, particle.col, side), gridRow: particle.row + 1, gridColumn: particle.col + 1, "--tsq-radius": particle.radius,
          ...Object.fromEntries(Object.entries(particle.gaze).map(([gaze, value]) => [`--eye-${gaze}`, value])) } as CSSProperties}>
        {Object.values(particle.gaze).some(Boolean) && <span className="particle-avatar__eye" />}
      </SquareCell>)}
    </span>
  </span>;
}
