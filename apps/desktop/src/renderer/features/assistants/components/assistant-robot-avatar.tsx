import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { AssistantRobotShape } from "@mains/contracts/assistants";
import { cn } from "@/lib/cn";
import { ROBOT_PRESETS } from "../lib/assistant-robot-presets";

// These front views are baked from the preview meshes at yaw .12 and pitch .09.
const thumbnails = import.meta.glob<string>("../assets/robots/*.webp", {
  eager: true, import: "default", query: "?no-inline",
});

export function AssistantRobotAvatar({ shape, working, className }: {
  shape: AssistantRobotShape; working?: boolean; className?: string;
}) {
  return <span aria-hidden="true" data-avatar-shape={shape} data-avatar-family="robot" data-working={!!working}
    className={cn("assistant-robot-avatar relative inline-flex shrink-0", className)}>
    <img src={thumbnails[`../assets/robots/${shape}.webp`]} alt="" draggable={false} className="size-full object-contain" />
    {working && <span className="assistant-robot-avatar__activity" />}
  </span>;
}

const HOME = { yaw: .28, pitch: .14, lookX: 0, lookY: 0 };
const clampPitch = (pitch: number) => Math.max(-.57, Math.min(.72, pitch));
const motionQuery = "(prefers-reduced-motion: reduce)";

export function AssistantRobotPreview({ shape, working = false, className }: {
  shape: AssistantRobotShape; working?: boolean; className?: string;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const target = useRef({ ...HOME });
  const activity = useRef(working);
  const wake = useRef<() => void>(() => undefined);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  useEffect(() => {
    activity.current = working;
    wake.current();
  }, [working]);

  useEffect(() => {
    const element = root.current;
    const surface = canvas.current;
    if (!element || !surface) return;
    const motion = window.matchMedia(motionQuery);
    let scene: ReturnType<typeof import("../lib/assistant-robot-renderer").createRobotRenderer> = null;
    let disposed = false;
    let visible = typeof IntersectionObserver === "undefined";
    let ready = false;
    let frame: number | undefined;
    let blinkTimer: number | undefined;
    let blinkStart = -Infinity;
    const pose = { ...target.current };

    function stop() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.clearTimeout(blinkTimer);
      frame = blinkTimer = undefined;
      blinkStart = -Infinity;
    }

    const canDraw = () => !!scene && visible && !document.hidden;
    function request() {
      if (canDraw() && frame === undefined) frame = requestAnimationFrame(draw);
    }

    function draw(now: number) {
      frame = undefined;
      if (!surface || !scene || !canDraw()) return;
      const size = Math.round(surface.clientWidth * Math.min(window.devicePixelRatio || 1, 2.5));
      if (!size) return;
      if (surface.width !== size) surface.width = surface.height = size;

      const reduce = motion.matches;
      let moving = false;
      for (const key of ["yaw", "pitch", "lookX", "lookY"] as const) {
        const end = reduce && (key === "lookX" || key === "lookY") ? 0 : target.current[key];
        const difference = end - pose[key];
        const interpolate = !reduce && Math.abs(difference) > .003;
        pose[key] = interpolate ? pose[key] + difference * .22 : end;
        moving ||= interpolate;
      }
      const blinking = !reduce && now - blinkStart < 180;
      const blink = blinking ? Math.sin((now - blinkStart) / 180 * Math.PI) : 0;
      scene.draw({ ...pose, blink, working: activity.current, time: reduce ? 0 : now });
      if (!ready && element) {
        ready = true;
        element.dataset.robotRendered = "true";
        element.tabIndex = 0;
      }
      if (moving || blinking || (!reduce && activity.current)) request();
      if (!reduce && blinkTimer === undefined) {
        blinkTimer = window.setTimeout(() => {
          blinkTimer = undefined;
          blinkStart = performance.now();
          request();
        }, 5800);
      }
    }

    function sync() {
      if (canDraw()) request();
      else stop();
    }

    function hideCanvas() {
      ready = false;
      if (element) {
        delete element.dataset.robotRendered;
        element.removeAttribute("tabindex");
      }
    }

    async function load() {
      try {
        const { createRobotRenderer } = await import("../lib/assistant-robot-renderer");
        if (disposed || !surface) return;
        scene = createRobotRenderer(surface, shape);
        sync();
      } catch {
        // A static front render is available when the GPU cannot provide a preview.
        hideCanvas();
      }
    }

    const intersection = typeof IntersectionObserver === "undefined" ? undefined
      : new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(request);
    intersection?.observe(element);
    resize?.observe(element);
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", request);
    function lost(event: Event) {
      event.preventDefault();
      stop();
      scene?.dispose();
      scene = null;
      hideCanvas();
    }
    surface.addEventListener("webglcontextlost", lost);
    surface.addEventListener("webglcontextrestored", load);
    wake.current = request;
    void load();
    return () => {
      disposed = true;
      stop();
      hideCanvas();
      intersection?.disconnect();
      resize?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", request);
      surface.removeEventListener("webglcontextlost", lost);
      surface.removeEventListener("webglcontextrestored", load);
      scene?.dispose();
      wake.current = () => undefined;
    };
  }, [shape]);

  function press(event: PointerEvent<HTMLSpanElement>) {
    if (event.button !== 0 || drag.current || !event.currentTarget.dataset.robotRendered) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragging = "true";
  }

  function move(event: PointerEvent<HTMLSpanElement>) {
    const active = drag.current;
    if (active) {
      if (event.pointerId !== active.id) return;
      target.current.yaw += (event.clientX - active.x) * .027;
      target.current.pitch = clampPitch(target.current.pitch + (event.clientY - active.y) * .015);
      active.x = event.clientX;
      active.y = event.clientY;
    } else {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (!bounds.width || !bounds.height || event.pointerType === "touch") return;
      target.current.lookX = (event.clientX - bounds.left) / bounds.width * 2 - 1;
      target.current.lookY = 1 - (event.clientY - bounds.top) / bounds.height * 2;
    }
    wake.current();
  }

  function centerGaze() {
    target.current.lookX = target.current.lookY = 0;
    wake.current();
  }

  function release(event: PointerEvent<HTMLSpanElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    delete event.currentTarget.dataset.dragging;
    centerGaze();
  }

  function key(event: KeyboardEvent<HTMLSpanElement>) {
    switch (event.key) {
      case "ArrowLeft": target.current.yaw -= .24; break;
      case "ArrowRight": target.current.yaw += .24; break;
      case "ArrowUp": target.current.pitch = clampPitch(target.current.pitch - .16); break;
      case "ArrowDown": target.current.pitch = clampPitch(target.current.pitch + .16); break;
      case "Home": target.current = { ...HOME }; break;
      default: return;
    }
    event.preventDefault();
    wake.current();
  }

  return <span ref={root} role="group" aria-label={`${ROBOT_PRESETS[shape].label} robot preview`}
    aria-description="Drag or use the arrow keys to rotate. Press Home to reset the view."
    className={cn("assistant-robot-preview relative inline-flex shrink-0 rounded-2xl outline-accent focus-visible:outline-2", className)}
    onPointerDown={press} onPointerMove={move} onPointerLeave={centerGaze} onPointerUp={release}
    onPointerCancel={release} onLostPointerCapture={release} onKeyDown={key}>
    <AssistantRobotAvatar shape={shape} working={working} className="assistant-robot-preview__fallback size-full" />
    <canvas ref={canvas} aria-hidden="true" className="assistant-robot-preview__canvas absolute inset-0 size-full" />
  </span>;
}
