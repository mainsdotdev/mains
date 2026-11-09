import {
  findKeyboardShortcutConflict, isReservedKeyboardShortcut, keyboardShortcutFromInput,
  type KeyboardShortcutId, type KeyboardShortcutInput, type KeyboardShortcutOverrides,
} from "./keyboard-shortcuts";

/** Shared ownership rules for Lens capture and shortcut recording. */
export function createLensCaptureLifecycle() {
  let stopped = false;
  let pending: Promise<unknown> | null = null;
  const assertCurrent = () => { if (stopped) throw new Error("Lens is stopping"); };
  return {
    assertCurrent,
    active: () => !stopped,
    busy: () => pending !== null,
    run<T>(effect: (assertCurrent: () => void) => Promise<T>): Promise<T> {
      assertCurrent();
      if (pending) return Promise.reject(new Error("A Lens capture is already in progress"));
      const job = Promise.resolve().then(() => { assertCurrent(); return effect(assertCurrent); });
      pending = job;
      void job.finally(() => { if (pending === job) pending = null; }).catch(() => {});
      return job;
    },
    stop(): Promise<void> {
      stopped = true;
      return pending ? pending.then(() => {}, () => {}) : Promise.resolve();
    },
  };
}

/** Settings mutations and their native effects share one admission order. */
export function createShortcutWriteQueue() {
  let active = true;
  let tail = Promise.resolve();
  let intent = 0;
  const assertCurrent = () => { if (!active) throw new Error("Shortcut service is stopping"); };
  return {
    async restore<T>(read: () => Promise<T>, apply: (value: T) => void | Promise<void>): Promise<void> {
      if (!active || intent !== 0) return;
      const ticket = intent;
      let value: T;
      try { value = await read(); }
      catch (error) { if (active && intent === ticket) throw error; return; }
      if (!active || intent !== ticket) return;
      const job = tail.then(async () => { if (active && intent === ticket) await apply(value); });
      tail = job.then(() => {}, () => {});
      await job;
    },
    run<T>(effect: (current: () => boolean) => Promise<T>): Promise<T> {
      if (!active) return Promise.reject(new Error("Shortcut service is stopping"));
      intent++;
      const job = tail.then(() => { assertCurrent(); return effect(() => active); });
      tail = job.then(() => {}, () => {});
      return job;
    },
    stop() { active = false; return tail; },
  };
}

/** Reads are snapshots; only explicit matching acknowledgement consumes delivery. */
export function createLensDeliveryQueue<Capture extends { id: string; screenshotCaptureName: string }>(limit = 8) {
  let pending: Capture[] = [];
  return {
    add(capture: Capture) { pending = [...pending.filter((item) => item.id !== capture.id), capture].slice(-limit); },
    read: () => [...pending],
    acknowledge(id: string) { pending = pending.filter((item) => item.id !== id); },
    remove(name: string) { pending = pending.filter((item) => item.screenshotCaptureName !== name); },
    clear() { pending = []; },
  };
}

/** One mounted receiver may attach and acknowledge; retired reads consume nothing. */
export function createLensReceiver<Capture extends { id: string }>(seen: Set<string>, effects: {
  attach(capture: Capture): void;
  acknowledge(id: string): Promise<unknown>;
  present(capture: Capture): void;
}) {
  let active = true;
  return {
    active: () => active,
    close() { active = false; },
    receive(capture: Capture) {
      if (!active) return;
      const fresh = !seen.has(capture.id);
      if (fresh) {
        seen.add(capture.id);
        try { effects.attach(capture); }
        catch { seen.delete(capture.id); return; }
      }
      if (!active) return;
      try { void effects.acknowledge(capture.id).catch(() => {}); }
      catch { /* A later event/catch-up read can retry acknowledgement. */ }
      if (fresh && active) effects.present(capture);
    },
  };
}

export interface ShortcutRecorderState {
  phase: "idle" | "recording" | "saving";
  recordingId: KeyboardShortcutId | null;
  error: string | null;
}
export const idleShortcutRecorder: ShortcutRecorderState = { phase: "idle", recordingId: null, error: null };

/** A recorder claims saving synchronously; accepted writes survive view disposal. */
export function createShortcutRecorder(effects: {
  update(id: KeyboardShortcutId, binding: string | null): Promise<void>;
  resetAll(): Promise<void>;
  overrides(): KeyboardShortcutOverrides;
  change(state: ShortcutRecorderState): void;
  error(message: string): void;
  reset(): void;
}) {
  let active = true;
  let state = idleShortcutRecorder;
  const publish = (next: ShortcutRecorderState) => { state = next; if (active) effects.change(next); };
  const save = async (effect: () => Promise<void>, reset = false) => {
    if (!active || state.phase === "saving") return;
    const previous = state;
    publish({ ...state, phase: "saving", error: null });
    try {
      await effect();
      if (!active) return;
      publish(idleShortcutRecorder);
      if (reset) effects.reset();
    } catch (error) {
      if (!active) return;
      const message = error instanceof Error ? error.message : String(error);
      publish({ ...previous, error: message });
      effects.error(message);
    }
  };
  const commit = (id: KeyboardShortcutId, binding: string | null) => save(() => effects.update(id, binding));
  return {
    close() { active = false; },
    start(id: KeyboardShortcutId) { if (active && state.phase !== "saving") publish({ phase: "recording", recordingId: id, error: null }); },
    cancel() { if (active && state.phase !== "saving") publish(idleShortcutRecorder); },
    commit,
    resetAll: () => save(() => effects.resetAll(), true),
    record(id: KeyboardShortcutId, input: KeyboardShortcutInput & { repeat?: boolean; isComposing?: boolean }) {
      if (!active || state.phase !== "recording" || state.recordingId !== id || input.repeat || input.isComposing) return;
      if (input.key === "Escape") { publish(idleShortcutRecorder); return; }
      if ((input.key === "Backspace" || input.key === "Delete") && !input.metaKey && !input.ctrlKey && !input.altKey && !input.shiftKey) { void commit(id, null); return; }
      const binding = keyboardShortcutFromInput(input);
      let error: string | null = null;
      if (!binding) error = "Include a primary modifier in the shortcut";
      else if (isReservedKeyboardShortcut(binding)) error = "This shortcut is reserved by the operating system";
      else {
        const conflict = findKeyboardShortcutConflict(id, binding, effects.overrides());
        if (conflict) error = `Already used by ${conflict.title}`;
      }
      if (error) publish({ ...state, error });
      else void commit(id, binding);
    },
  };
}

/** Native callbacks retain the registration instance, even after an ABA rebind. */
export function createShortcutInvocationOwner() {
  let owner: object | null = null;
  return {
    retire() { owner = null; },
    claim() { const ticket = {}; owner = ticket; return () => owner === ticket; },
  };
}

/** Focus reads yield to accepted controls; only the newest live read can paint. */
export function createCaptureSettingsView() {
  let active = true, revision = 0;
  let action: object | null = null;
  return {
    read() {
      if (!active || action) return null;
      const ticket = ++revision;
      return () => active && !action && revision === ticket;
    },
    begin() {
      if (!active || action) return null;
      const ticket = {}; action = ticket; revision++;
      return {
        current: () => active && action === ticket,
        finish() { if (action === ticket) action = null; },
      };
    },
    close() { active = false; revision++; action = null; },
  };
}
