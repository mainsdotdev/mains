import { useEffect, useRef } from "react";
import type { VoiceOrbColor, VoiceOrbStyle } from "@mains/contracts/realtime";
import { cn } from "@/lib/cn";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import type { VoiceAudioLevels } from "../lib/realtime-voice-audio";
import { createVoiceOrbRenderer, readVoiceOrbPalette } from "../lib/voice-orb-renderer";
import { voiceOrbColorStyle } from "../lib/voice-orb-colors";
import { resolveVoiceOrbStyle } from "../lib/voice-orb-styles";

interface VoiceOrbProps {
  active: boolean;
  getAudioLevels(timeMs: number): VoiceAudioLevels;
  color?: VoiceOrbColor;
  orbStyle?: VoiceOrbStyle;
  className?: string;
}

const ORB_FLOW_SPEED: Record<VoiceOrbStyle, number> = { cloud: 1, sphere: 2, aurora: 2.4 };

export function VoiceOrb({ active, getAudioLevels, color = "theme", orbStyle = "cloud", className }: VoiceOrbProps) {
  const orbRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const orb = orbRef.current;
    const canvas = canvasRef.current;
    if (!orb || !canvas || !active || reducedMotion) return;

    let renderer: ReturnType<typeof createVoiceOrbRenderer>;
    let frame: number | undefined;
    let previousTime: number | undefined;
    let flow = 0;
    let visible = true;
    let lost = false;
    let disposed = false;

    function pause() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      previousTime = undefined;
    }
    function draw(time: number) {
      frame = undefined;
      if (disposed || lost || !visible || document.hidden || !renderer) return;
      const elapsed = previousTime === undefined ? 0 : Math.min(0.05, (time - previousTime) / 1000);
      previousTime = time;
      const levels = getAudioLevels(time);
      // Integrate speed so changing volume cannot jump the surface's position.
      const speed = ORB_FLOW_SPEED[resolveVoiceOrbStyle(orb!.dataset.orbStyle)];
      flow += elapsed * (0.4 + Math.max(levels.input, levels.output) * 4.2) * speed;
      renderer.draw(flow, levels);
      canvas!.style.opacity = "1";
      frame = requestAnimationFrame(draw);
    }
    function resume() {
      if (disposed || lost || !visible || document.hidden || !renderer || frame !== undefined) return;
      frame = requestAnimationFrame(draw);
    }
    function resize() {
      const size = orb!.getBoundingClientRect().width;
      const pixels = Math.min(256, Math.max(1, Math.round(size * Math.min(window.devicePixelRatio || 1, 2))));
      canvas!.width = canvas!.height = pixels;
    }
    function initialize() {
      const palette = readVoiceOrbPalette(orb!);
      if (!palette) return;
      renderer = createVoiceOrbRenderer(canvas!, palette, resolveVoiceOrbStyle(orb!.dataset.orbStyle));
      resize();
      resume();
    }
    function updateAppearance() {
      if (!renderer || document.hidden) return;
      const palette = readVoiceOrbPalette(orb!);
      if (palette) renderer.setPalette(palette);
      renderer.setStyle(resolveVoiceOrbStyle(orb!.dataset.orbStyle));
    }
    function onVisibility() {
      if (document.hidden) pause();
      else { updateAppearance(); resume(); }
    }
    function onContextLost(event: Event) {
      event.preventDefault();
      lost = true;
      pause();
      renderer?.dispose();
      renderer = undefined;
      canvas!.style.opacity = "0";
    }
    function onContextRestored() { lost = false; initialize(); }

    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    document.addEventListener("visibilitychange", onVisibility);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(orb);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) resume(); else pause();
    });
    intersectionObserver.observe(orb);
    const themeObserver = new MutationObserver(updateAppearance);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    themeObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
    // Both preferences update uniforms without replacing the shader or flow.
    themeObserver.observe(orb, { attributes: true, attributeFilter: ["style", "data-orb-style"] });
    initialize();

    return () => {
      disposed = true;
      pause();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      renderer?.dispose();
      canvas.style.opacity = "0";
    };
  }, [active, getAudioLevels, reducedMotion]);

  return (
    <span ref={orbRef} aria-hidden="true" data-active={active}
      data-color={color} data-orb-style={orbStyle} style={voiceOrbColorStyle(color)}
      className={cn("voice-orb relative block size-24 shrink-0 overflow-hidden rounded-full sm:size-40", className)}>
      <canvas ref={canvasRef} className="relative block size-full" style={{ opacity: 0 }} />
    </span>
  );
}
