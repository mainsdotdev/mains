import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createOverlayLifecycle, overlayView, type OverlayOpenOptions } from "@/lib/overlay-lifecycle";

export function useOverlayLifecycle({ frames = 1, exitMs = 0, initialOpen = false, disabled = false, scope, beforeOpen }: {
  frames?: number;
  exitMs?: number;
  initialOpen?: boolean;
  disabled?: boolean;
  scope?: unknown;
  beforeOpen?: () => void;
} = {}) {
  const [state, setState] = useState(() => ({ scope, disabled, frames, exitMs, initialOpen,
    view: overlayView(initialOpen && !disabled ? "open" : "closed") }));
  if (!Object.is(state.scope, scope) || state.disabled !== disabled || state.frames !== frames || state.exitMs !== exitMs || state.initialOpen !== initialOpen) {
    setState({ scope, disabled, frames, exitMs, initialOpen, view: overlayView(initialOpen && !disabled ? "open" : "closed") });
  }
  const latest = useRef(beforeOpen);
  const owner = useRef<ReturnType<typeof createOverlayLifecycle> | null>(null);
  useLayoutEffect(() => { latest.current = beforeOpen; });
  useLayoutEffect(() => {
    if (disabled) return undefined;
    const lifecycle = createOverlayLifecycle({ initialOpen, frames, exitMs, publish: (view) => setState((current) => ({ ...current, view })), beforeOpen: () => latest.current?.() });
    owner.current = lifecycle;
    return () => { lifecycle.dispose(); if (owner.current === lifecycle) owner.current = null; };
  }, [disabled, scope, frames, exitMs, initialOpen]);
  const open = useCallback((options?: OverlayOpenOptions) => owner.current?.open(options), []);
  const close = useCallback((delay?: number) => owner.current?.close(delay), []);
  const engage = useCallback((source: string, options?: OverlayOpenOptions) => owner.current?.engage(source, options), []);
  const release = useCallback((source: string) => owner.current?.release(source), []);
  const frame = useCallback((effect: () => void) => owner.current?.frame(effect) ?? (() => {}), []);
  return { ...state.view, open, close, engage, release, frame };
}

export function useOverlayAnimation(isOpen: boolean, { frames = 1, exitMs = 0, immediate = false }: {
  frames?: number; exitMs?: number; immediate?: boolean;
} = {}) {
  // Retain the panel hook's already-open first render without replaying entry.
  const [initiallyOpen] = useState(() => isOpen && exitMs > 0);
  const overlay = useOverlayLifecycle({ frames, exitMs, initialOpen: initiallyOpen });
  const { open, close } = overlay;
  useLayoutEffect(() => { if (isOpen) open({ immediate }); else close(); }, [isOpen, immediate, open, close]);
  return overlay;
}
