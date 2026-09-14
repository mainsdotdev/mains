import { useEffect, useRef } from "react";
import type { Space } from "@/lib/redux/api";

interface UseSidebarSpaceSwipeArgs {
  spaces: Space[];
  activeSpaceId: string;
  onSpaceChange: (spaceId: string) => void;
}

const THRESHOLD = 50;
const GESTURE_GAP_MS = 220;
const RAMP_UP_RATIO = 1.3;
const RAMP_UP_FLOOR = 15;
const POST_FIRE_COOLDOWN_MS = 300;

type Mode = "idle" | "horizontal" | "vertical";

export function useSidebarSpaceSwipe({
  spaces,
  activeSpaceId,
  onSpaceChange,
}: UseSidebarSpaceSwipeArgs) {
  const ref = useRef<HTMLElement | null>(null);
  const mode = useRef<Mode>("idle");
  const accumulated = useRef(0);
  const locked = useRef(false);
  const lastEventAt = useRef(0);
  const lastAbsDeltaX = useRef(0);
  const firedAt = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || spaces.length < 2) return;

    const onWheel = (e: WheelEvent) => {
      const now = performance.now();
      const dt = now - lastEventAt.current;
      lastEventAt.current = now;
      const absX = Math.abs(e.deltaX);

      if (dt > GESTURE_GAP_MS) {
        mode.current = "idle";
        accumulated.current = 0;
        locked.current = false;
        lastAbsDeltaX.current = 0;
      }

      if (locked.current) {
        if (now - firedAt.current < POST_FIRE_COOLDOWN_MS) {
          lastAbsDeltaX.current = absX;
          return;
        }
        const isRampUp =
          absX > Math.max(lastAbsDeltaX.current * RAMP_UP_RATIO, RAMP_UP_FLOOR);
        lastAbsDeltaX.current = absX;
        if (!isRampUp) return;
        locked.current = false;
        accumulated.current = 0;
        mode.current = "idle";
      } else {
        lastAbsDeltaX.current = absX;
      }

      if (mode.current === "idle") {
        const absY = Math.abs(e.deltaY);
        if (absX === 0 && absY === 0) return;
        mode.current = absX > absY ? "horizontal" : "vertical";
      }

      if (mode.current === "vertical") return;

      e.preventDefault();

      accumulated.current += e.deltaX;

      if (Math.abs(accumulated.current) < THRESHOLD) return;

      const direction = accumulated.current > 0 ? 1 : -1;
      const currentIndex = spaces.findIndex((s) => s.id === activeSpaceId);
      locked.current = true;
      firedAt.current = now;
      accumulated.current = 0;

      if (currentIndex === -1) return;
      const nextIndex = Math.min(
        Math.max(currentIndex + direction, 0),
        spaces.length - 1,
      );
      const next = spaces[nextIndex];
      if (next && next.id !== activeSpaceId) {
        onSpaceChange(next.id);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [spaces, activeSpaceId, onSpaceChange]);

  return ref;
}
