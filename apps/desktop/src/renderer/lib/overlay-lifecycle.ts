export type OverlayPhase = "closed" | "waiting" | "opening" | "open" | "closing";
export function overlayView(phase: OverlayPhase) {
  return { phase, isVisible: phase === "opening" || phase === "open" || phase === "closing", isAnimatedIn: phase === "open" };
}
export interface OverlayOpenOptions { delay?: number; immediate?: boolean; autoHideAfter?: number }

/** Restore only an unclaimed focus position; a new editor/dialog keeps its focus. */
export function canRestoreOverlayFocus(target: HTMLElement | null, surface?: HTMLElement | null): target is HTMLElement {
  if (!target?.isConnected || target.matches(":disabled") || target.closest("[inert]")) return false;
  const document = target.ownerDocument;
  const active = document.activeElement;
  return !active || active === document.body || active === target || !!surface?.contains(active);
}
export function restoreOverlayFocus(target: HTMLElement | null, surface?: HTMLElement | null) {
  if (canRestoreOverlayFocus(target, surface)) target.focus();
}

/** One owner for mount/enter/exit and all callbacks belonging to that opening. */
export function createOverlayLifecycle(options: {
  initialOpen?: boolean;
  frames: number;
  exitMs: number;
  publish(view: ReturnType<typeof overlayView>): void;
  beforeOpen(): void;
}) {
  let phase: OverlayPhase = options.initialOpen ? "open" : "closed";
  let active = true;
  let generation = 0;
  const jobs = new Set<() => void>();
  const interactions = new Set<string>();
  const current = (ticket: number) => active && generation === ticket;
  const set = (next: OverlayPhase) => { if (active && phase !== next) { phase = next; options.publish(overlayView(phase)); } };
  function retire() { generation++; for (const cancel of jobs) cancel(); jobs.clear(); }
  function frame(effect: () => void) {
    const ticket = generation;
    let completed = false;
    let canceled = false;
    const cancel = () => { canceled = true; cancelAnimationFrame(id); };
    const id = requestAnimationFrame(() => { completed = true; jobs.delete(cancel); if (!canceled && current(ticket)) effect(); });
    if (!completed) jobs.add(cancel);
    return () => { cancel(); jobs.delete(cancel); };
  }
  function after(ms: number, effect: () => void) {
    const ticket = generation;
    const id = setTimeout(() => { jobs.delete(cancel); if (current(ticket)) effect(); }, ms);
    const cancel = () => clearTimeout(id); jobs.add(cancel);
  }
  function close(delay = 0) {
    if (!active) return;
    interactions.clear();
    retire();
    const hide = () => {
      if (phase === "closed" || phase === "waiting" || !options.exitMs) { set("closed"); return; }
      set("closing"); after(options.exitMs, () => set("closed"));
    };
    if (delay > 0) after(delay, hide); else hide();
  }
  function open({ delay = 0, immediate = false, autoHideAfter }: OverlayOpenOptions = {}) {
    if (!active) return;
    const mounted = overlayView(phase).isVisible;
    retire();
    const ticket = generation;
    const show = () => {
      options.beforeOpen();
      if (!current(ticket)) return;
      if (immediate || mounted || options.frames <= 0) set("open");
      else {
        set("opening");
        const enter = (remaining: number) => frame(() => { if (remaining <= 1) set("open"); else enter(remaining - 1); });
        enter(options.frames);
      }
      if (autoHideAfter !== undefined) after(autoHideAfter, () => close());
    };
    if (delay > 0 && !mounted) { set("waiting"); after(delay, show); } else show();
  }
  return {
    open, close,
    engage(source: string, intent?: OverlayOpenOptions) { if (active) { interactions.add(source); open(intent); } },
    release(source: string) { interactions.delete(source); if (!interactions.size) close(); },
    frame(effect: () => void) { return active ? frame(effect) : () => {}; },
    dispose() { active = false; interactions.clear(); retire(); },
  };
}

/** A closing focus lease may restore once after unmount; re-entry retires it. */
export function createOverlayFocusLifecycle() {
  let owner: ReturnType<typeof createOverlayLifecycle> | undefined;
  return {
    acquire({ enter, restore, deferred = false }: { enter(): void; restore(): void; deferred?: boolean }) {
      owner?.dispose();
      const lease = createOverlayLifecycle({ frames: 0, exitMs: 0, publish() {}, beforeOpen() {} });
      owner = lease;
      if (deferred) lease.frame(enter); else enter();
      let released = false;
      return () => {
        if (released || owner !== lease) return;
        released = true; lease.close();
        lease.frame(() => {
          try { restore(); }
          finally { lease.dispose(); if (owner === lease) owner = undefined; }
        });
      };
    },
  };
}
