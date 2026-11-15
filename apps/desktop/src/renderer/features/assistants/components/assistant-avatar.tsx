import { useEffect, useRef, type CSSProperties, type PointerEvent } from "react";
import { normalizeAssistantAvatar, type AssistantAvatar as Avatar } from "@mains/contracts/assistants";
import { cn } from "@/lib/cn";
import { AVATAR_PARTICLES, avatarPhase, type AvatarDetail } from "../lib/assistant-particles";
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
    const clamp = (n: number) => Math.max(-1, Math.min(1, n));
    event.currentTarget.style.setProperty("--avatar-look-x", `${clamp((event.clientX - bounds.left) / bounds.width * 2 - 1) * 2}px`);
    event.currentTarget.style.setProperty("--avatar-look-y", `${clamp((event.clientY - bounds.top) / bounds.height * 2 - 1) * 1.5}px`);
  };
  return <span ref={root} aria-hidden="true" data-avatar-shape={selected.shape} data-working={working} data-animated={animated} data-paused={!animated}
    className={cn("particle-avatar inline-flex shrink-0 items-center justify-center", className)}
    onPointerMove={look} onPointerLeave={event => { event.currentTarget.style.removeProperty("--avatar-look-x"); event.currentTarget.style.removeProperty("--avatar-look-y"); }}
    style={{ "--avatar-fill": color.fill, "--avatar-light": color.light, "--avatar-ink": color.ink, "--avatar-delay": `${-phase * 8}s`, "--avatar-eye-delay": `${-phase * 7.6}s` } as CSSProperties}>
    <svg viewBox="0 0 64 64" className="h-full w-full overflow-visible" fill="currentColor" focusable="false">
      <g className="particle-avatar__body">
        {AVATAR_PARTICLES[selected.shape][detail].map(particle => <g key={particle.id} data-particle-id={particle.id} transform={`translate(${particle.x} ${particle.y})`}
          style={{ "--particle-opacity": particle.opacity, "--particle-wave-forward": particle.waveForward - phase, "--particle-wave-return": particle.waveReturn - phase } as CSSProperties}>
          {particle.eye ? <g className="particle-avatar__look"><rect data-eye={particle.eye} className="particle-avatar__eye" x={-particle.halfSize} y={-particle.halfSize} width={particle.halfSize * 2} height={particle.halfSize * 2} rx={0.8} /></g>
            : <>
              <rect className="particle-avatar__particle" x={-particle.halfSize} y={-particle.halfSize} width={particle.halfSize * 2} height={particle.halfSize * 2} rx={0.35} />
              <rect className="particle-avatar__wave particle-avatar__wave--forward" x={-particle.halfSize} y={-particle.halfSize} width={particle.halfSize * 2} height={particle.halfSize * 2} rx={0.35} />
              <rect className="particle-avatar__wave particle-avatar__wave--return" x={-particle.halfSize} y={-particle.halfSize} width={particle.halfSize * 2} height={particle.halfSize * 2} rx={0.35} />
            </>}
        </g>)}
      </g>
    </svg>
  </span>;
}
