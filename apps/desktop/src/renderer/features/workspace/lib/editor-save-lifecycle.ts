export interface EditorBaseline { content: string; mtimeMs?: number; version?: string }
export interface EditorWriteResult { size: number; mtimeMs: number; version?: string }
export interface EditorSaveSnapshot {
  phase: "idle" | "dirty" | "saving" | "saved" | "error" | "reloading" | "closed";
  draft: string; baseline: EditorBaseline; error: string | null; conflict: boolean; editSession: number;
}
interface Options extends EditorBaseline {
  draft?: string; error?: string | null;
  read?(): Promise<EditorBaseline & { size: number }>;
  write(input: { content: string; expectedMtimeMs?: number; expectedVersion?: string }): Promise<EditorWriteResult>;
  publish?(content: string, result: { size: number; mtimeMs?: number; version?: string }): void;
  remember?(snapshot: EditorSaveSnapshot | undefined): void;
}

/** A file's draft and acknowledged baseline have separate revisions. Saving
 * one revision never marks later edits saved or changes their target. */
export function createEditorSaveLifecycle(options: Options) {
  let state: EditorSaveSnapshot = { phase: options.error ? "error" : options.draft === undefined ? "idle" : "dirty", draft: options.draft ?? options.content,
    baseline: { content: options.content, mtimeMs: options.mtimeMs, version: options.version }, error: options.error ?? null, conflict: options.error === "File changed on disk", editSession: 0 };
  let revision = 0, attachment = 0, reloading: Promise<void> | undefined;
  let pending: Promise<void> | undefined, wanted = false, forceNext = false;
  let attached = true, retired = false, timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const emit = () => {
    options.remember?.(state.draft !== state.baseline.content ? state : undefined);
    if (attached) for (const listener of listeners) listener();
  };
  const update = (patch: Partial<EditorSaveSnapshot>) => { state = { ...state, ...patch }; emit(); };
  const cancelTimer = () => { if (timer) clearTimeout(timer); timer = undefined; };
  const flush = (force = false): Promise<void> => {
    cancelTimer();
    if (reloading) return reloading.then(() => flush(force));
    if (retired || state.error && !force) return pending ?? Promise.resolve();
    wanted = true; forceNext ||= force;
    if (pending) return pending;
    const result = Promise.resolve().then(async () => {
      try { while (wanted && !retired) {
        wanted = false; const overwrite = forceNext; forceNext = false;
        const content = state.draft, baseline = state.baseline;
        if (content === baseline.content && !overwrite) continue;
        update({ phase: "saving", error: null, conflict: false });
        try {
          const saved = await options.write({ content, expectedMtimeMs: overwrite ? undefined : baseline.mtimeMs, expectedVersion: overwrite ? undefined : baseline.version });
          update({ baseline: { content, mtimeMs: saved.mtimeMs, version: saved.version }, phase: attached ? (state.draft === content ? "saved" : "dirty") : "closed" });
          if (attached && !retired) {
            try { options.publish?.(content, saved); } catch (error) { console.error("[Editor] Saved file projection failed:", error); }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          wanted = false; forceNext = false;
          update({ phase: attached ? "error" : "closed", error: message, conflict: message === "File changed on disk" });
        }
      } } finally { if (pending === result) pending = undefined; }
    });
    pending = result;
    return result;
  };
  return {
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    edit(draft: string) {
      if (retired || !attached) return;
      revision++;
      update({ draft, phase: state.error ? "error" : pending ? "saving" : "dirty" });
      if (!state.error) { cancelTimer(); timer = setTimeout(() => { timer = undefined; void flush(); }, 750); }
    },
    flush,
    attach() { if (retired) return; attachment++; attached = true; update({ phase: state.error ? "error" : pending ? "saving" : state.draft === state.baseline.content ? "idle" : "dirty" }); },
    retire() { attachment++; retired = true; attached = false; wanted = false; forceNext = false; cancelTimer(); update({ phase: "closed" }); },
    reload(): Promise<void> {
      if (retired || !attached || !options.read) return Promise.resolve();
      if (reloading) return reloading;
      cancelTimer(); const accepted = revision;
      const result = (async () => {
        await pending;
        if (retired || !attached) return;
        update({ phase: "reloading" });
        try {
          const loaded = await options.read!();
          if (retired || !attached || revision !== accepted) return;
          update({ draft: loaded.content, baseline: loaded, error: null, conflict: false, phase: "idle", editSession: state.editSession + 1 });
          options.publish?.(loaded.content, { size: loaded.size, mtimeMs: loaded.mtimeMs, version: loaded.version });
        } catch (error) {
          if (!retired && attached) update({ phase: "error", error: error instanceof Error ? error.message : String(error) });
        } finally {
          if (attached && state.phase === "reloading") update({ phase: state.error ? "error" : "dirty" });
        }
      })().finally(() => { if (reloading === result) reloading = undefined; });
      reloading = result; return result;
    },
    retry() { update({ phase: "dirty", error: null, conflict: false }); return flush(); },
    overwrite() { update({ phase: "dirty", error: null, conflict: false }); return flush(true); },
    async close() { attached = false; const accepted = ++attachment; await flush(); if (!attached && attachment === accepted) update({ phase: "closed" }); },
  };
}
