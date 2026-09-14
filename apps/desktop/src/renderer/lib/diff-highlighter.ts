import { useEffect, useState } from "react";
import { preloadHighlighter } from "@pierre/diffs";

/**
 * Readiness gate for every `@pierre/diffs` surface (`PatchDiff`, `File`).
 *
 * The shiki highlighter behind them loads async, and a surface mounted before it
 * lands paints *nothing*: `DiffHunksRenderer.renderDiff` returns undefined while
 * the renderer holds no highlighter, and `FileDiff.render` bails on that with no
 * repaint of its own unless a worker pool is attached — the app attaches none.
 * What the user sees is a blank pane that only fills in once something else
 * re-renders it: clicking a second file, switching a tab.
 *
 * Warming the shared highlighter once turns that cold start into a microtask for
 * every surface afterwards, so gating on it costs a frame at most and never
 * strands a pane blank.
 */
let warmup: Promise<void> | null = null;

export function warmDiffHighlighter(): Promise<void> {
  warmup ??= preloadHighlighter({
    themes: ["pierre-dark", "pierre-light"],
    langs: ["text"],
  }).catch(() => {
    // A failed warmup shouldn't wedge a surface blank forever — allow a retry
    // on the next mount.
    warmup = null;
  }) as Promise<void>;
  return warmup;
}

/**
 * Warms the highlighter on mount and reports when the surface can be rendered.
 * Render a placeholder until it returns true — never a `PatchDiff` / `File`.
 */
export function useDiffHighlighterReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    warmDiffHighlighter().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}
