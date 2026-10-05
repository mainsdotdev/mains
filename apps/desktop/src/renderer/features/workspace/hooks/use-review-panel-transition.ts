import { useLayoutEffect, useMemo, useRef } from "react";
import { animate, useMotionValue, useReducedMotion } from "motion/react";
import { LAYOUT_PANEL_ANIM_MS } from "@/lib/layout";

/** Animate geometry rather than scaling/reparenting the diff and its live comment editors. */
export function useReviewPanelTransition(expanded: boolean) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const expandedBoundsRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const left = useMotionValue(0);
  const top = useMotionValue(0);
  const width = useMotionValue(0);
  const height = useMotionValue(0);
  const padding = useMotionValue(0);
  const headerInset = useMotionValue(0);
  const headerHeight = useMotionValue(55);
  const bodyCorner = useMotionValue(0);
  const opacity = useMotionValue(0);
  const zIndex = useMotionValue(expanded ? 9999 : 0);
  const values = useMemo(() => ({ left, top, width, height, padding, headerInset, headerHeight, bodyCorner }),
    [left, top, width, height, padding, headerInset, headerHeight, bodyCorner]);
  type Geometry = { [K in keyof typeof values]: number };
  const lastTarget = useRef<(Geometry & { expanded: boolean; reduceMotion: boolean | null }) | null>(null);
  const animation = useRef<ReturnType<typeof animate> | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const bounds = expandedBoundsRef.current;
    if (!anchor || !bounds) return;
    const measure = () => {
      const rect = (expanded ? bounds : anchor).getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const chrome = getComputedStyle(bounds);
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const inset = expanded ? Number.parseFloat(chrome.scrollMarginLeft) || 0 : 0;
      const target: Geometry & { expanded: boolean; reduceMotion: boolean | null } = {
        expanded, reduceMotion, left: rect.left, top: rect.top, width: rect.width, height: rect.height,
        padding: expanded ? Number.parseFloat(chrome.paddingTop) || 0 : 0,
        headerInset: inset,
        headerHeight: expanded ? Number.parseFloat(chrome.minHeight) || 40 : 55 / 16 * rem,
        bodyCorner: Math.min(rem, inset),
      };
      const previous = lastTarget.current;
      const keys = Object.keys(values) as Array<keyof Geometry>;
      if (previous?.expanded === expanded && previous.reduceMotion === reduceMotion && keys.every((key) => previous[key] === target[key])) return;
      lastTarget.current = target;
      const chromeChanged = previous?.expanded === expanded && previous.headerInset !== target.headerInset;
      const moving = previous && (previous.expanded !== expanded || animation.current || chromeChanged);
      animation.current?.stop();
      animation.current = null;
      const from = Object.fromEntries(keys.map((key) => [key, values[key].get()])) as Geometry;
      const apply = (progress: number) => {
        for (const key of keys) values[key].set(from[key] + (target[key] - from[key]) * progress);
      };
      opacity.set(1);
      // Keep the surface above the docked composer until the collapse completes.
      zIndex.set(expanded || moving ? 9999 : 0);
      if (!moving || reduceMotion) {
        apply(1);
        zIndex.set(expanded ? 9999 : 0);
        return;
      }
      // One clock for the bounds and titlebar; reversals start at the visible geometry.
      animation.current = animate(0, 1, {
        duration: chromeChanged ? LAYOUT_PANEL_ANIM_MS / 1000 : 0.32,
        ease: [0.22, 1, 0.36, 1],
        onUpdate: apply,
        onComplete: () => { animation.current = null; zIndex.set(expanded ? 9999 : 0); },
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    observer.observe(bounds);
    window.addEventListener("resize", measure);
    // Scroll can move the docked anchor without resizing it.
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      animation.current?.stop();
      animation.current = null;
    };
  }, [expanded, reduceMotion, values, opacity, zIndex]);

  return {
    anchorRef, expandedBoundsRef,
    panelStyle: { left, top, width, height, padding, opacity, zIndex },
    headerStyle: { marginLeft: headerInset, height: headerHeight },
    bodyStyle: { borderTopLeftRadius: bodyCorner },
  };
}
