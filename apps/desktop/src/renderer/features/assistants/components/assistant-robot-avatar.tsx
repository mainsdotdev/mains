import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { AssistantRobotShape } from "@mains/contracts/assistants";
import { cn } from "@/lib/cn";
import { isAvatarWorking, type AssistantAvatarState } from "../lib/assistant-avatar-activity";
import { nextRobotAmbientGesture, robotEntryGesture, robotRestingPose, sampleRobotGesture, type RobotGesture } from "../lib/assistant-robot-motion";
import { ROBOT_PRESETS } from "../lib/assistant-robot-presets";

// These front views are baked from the preview meshes at yaw .12 and pitch .09.
const thumbnails = import.meta.glob<string>("../assets/robots/*.webp", {
  eager: true, import: "default", query: "?no-inline",
});

export function AssistantRobotAvatar({ shape, working, state = working ? "thinking" : "idle", animateState = false, className }: {
  shape: AssistantRobotShape; working?: boolean; state?: AssistantAvatarState; animateState?: boolean; className?: string;
}) {
  return <span aria-hidden="true" data-avatar-shape={shape} data-avatar-family="robot" data-working={isAvatarWorking(state)}
    data-avatar-state={state} data-avatar-motion={animateState || undefined}
    className={cn("assistant-robot-avatar relative inline-flex shrink-0", className)}>
    <img src={thumbnails[`../assets/robots/${shape}.webp`]} alt="" draggable={false} className="assistant-robot-avatar__image size-full object-contain" />
    {(isAvatarWorking(state) || state === "waiting") && <span className="assistant-robot-avatar__activity" />}
  </span>;
}

const HOME = { yaw: .28, pitch: .14, lookX: 0, lookY: 0 };
const clampPitch = (pitch: number) => Math.max(-.57, Math.min(.72, pitch));
const motionQuery = "(prefers-reduced-motion: reduce)";

export function AssistantRobotPreview({ shape, state = "idle", presentation = "interactive", className }: {
  shape: AssistantRobotShape; state?: AssistantAvatarState; presentation?: "interactive" | "welcome" | "status"; className?: string;
}) {
  const interactive = presentation === "interactive";
  const root = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const target = useRef({ ...HOME });
  const activity = useRef(state);
  const wake = useRef<() => void>(() => undefined);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const pointerActive = useRef(false);
  useEffect(() => {
    activity.current = state;
    wake.current();
  }, [state]);

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
    let ambientTimer: number | undefined;
    let ambientTick = 0;
    let shownState = activity.current;
    let introduced = false;
    let gesture: { kind: RobotGesture; start: number; direction: number } | undefined;
    const pose = { ...target.current };

    function clearAmbientTimer() {
      window.clearTimeout(ambientTimer);
      ambientTimer = undefined;
    }

    function stop() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearAmbientTimer();
      frame = undefined;
      gesture = undefined;
      ambientTick = 0;
      shownState = activity.current;
    }

    const canDraw = () => !!scene && visible && !document.hidden;
    function request() {
      if (!canDraw()) return stop();
      if (frame === undefined) frame = requestAnimationFrame(draw);
    }

    function startGesture(kind: RobotGesture, now: number) {
      gesture = { kind, start: now, direction: Math.random() < .5 ? -1 : 1 };
    }

    function draw(now: number) {
      frame = undefined;
      if (!surface || !scene || !canDraw()) return;
      const size = Math.round(surface.clientWidth * Math.min(window.devicePixelRatio || 1, 2.5));
      if (!size) return;
      if (surface.width !== size) surface.width = surface.height = size;

      const reduce = motion.matches;
      const nextState = activity.current;
      const interacting = pointerActive.current || !!drag.current;
      const autonomousGaze = reduce || !interacting;
      if (nextState !== shownState) {
        const ended = nextState === "done" || nextState === "failed";
        const entry = ended && !isAvatarWorking(shownState) && shownState !== "waiting" ? undefined : robotEntryGesture(nextState);
        shownState = nextState;
        clearAmbientTimer();
        ambientTick = 0;
        gesture = undefined;
        if (entry && !reduce && !drag.current) startGesture(entry, now);
      }
      if (!introduced) {
        introduced = true;
        const intro = presentation === "welcome" ? "greet" : presentation === "status" ? robotEntryGesture(nextState) : undefined;
        if (intro && !reduce) startGesture(intro, now);
      }
      if (reduce || drag.current) gesture = undefined;
      if (reduce || interacting) clearAmbientTimer();

      let moving = false;
      for (const key of ["yaw", "pitch", "lookX", "lookY"] as const) {
        const end = reduce && (key === "lookX" || key === "lookY") ? 0 : target.current[key];
        const difference = end - pose[key];
        const interpolate = !reduce && Math.abs(difference) > .003;
        pose[key] = interpolate ? pose[key] + difference * .22 : end;
        moving ||= interpolate;
      }
      const sample = gesture && sampleRobotGesture(gesture.kind, now - gesture.start, gesture.direction);
      if (!sample) gesture = undefined;
      const rest = robotRestingPose(shownState);
      scene.draw({
        yaw: pose.yaw + (sample?.yaw ?? 0),
        pitch: pose.pitch + (sample?.pitch ?? 0),
        roll: sample?.roll,
        lookX: pose.lookX + (autonomousGaze ? sample?.lookX ?? 0 : 0),
        lookY: pose.lookY + (autonomousGaze ? rest.lookY + (sample?.lookY ?? 0) : 0),
        blink: sample?.blink,
        focus: rest.focus,
      });
      if (!ready && element) {
        ready = true;
        element.dataset.robotRendered = "true";
        if (interactive) element.tabIndex = 0;
      }
      if (moving || gesture) request();
      if (!reduce && !interacting && !gesture && ambientTimer === undefined) {
        const next = nextRobotAmbientGesture(shownState, ambientTick, presentation === "welcome");
        ambientTimer = window.setTimeout(() => {
          ambientTimer = undefined;
          ambientTick++;
          startGesture(next.gesture, performance.now());
          request();
        }, next.delay);
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
  }, [shape, interactive, presentation]);

  function press(event: PointerEvent<HTMLSpanElement>) {
    if (event.button !== 0 || drag.current || !event.currentTarget.dataset.robotRendered) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragging = "true";
    wake.current();
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
      pointerActive.current = true;
      target.current.lookX = (event.clientX - bounds.left) / bounds.width * 2 - 1;
      target.current.lookY = 1 - (event.clientY - bounds.top) / bounds.height * 2;
    }
    wake.current();
  }

  function centerGaze() {
    pointerActive.current = false;
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

  return <span ref={root} role={interactive ? "group" : undefined} aria-hidden={!interactive || undefined}
    aria-label={interactive ? `${ROBOT_PRESETS[shape].label} robot preview` : undefined}
    data-avatar-state={state} data-avatar-interactive={interactive || undefined}
    aria-description={interactive ? "Drag or use the arrow keys to rotate. Press Home to reset the view." : undefined}
    className={cn("assistant-robot-preview relative inline-flex shrink-0 rounded-2xl outline-accent focus-visible:outline-2", className)}
    onPointerDown={interactive ? press : undefined} onPointerMove={move} onPointerLeave={centerGaze}
    onPointerUp={interactive ? release : undefined} onPointerCancel={release} onLostPointerCapture={release}
    onKeyDown={interactive ? key : undefined}>
    <AssistantRobotAvatar shape={shape} state={state} className="assistant-robot-preview__fallback size-full" />
    <canvas ref={canvas} aria-hidden="true" className="assistant-robot-preview__canvas absolute inset-0 size-full" />
  </span>;
}
