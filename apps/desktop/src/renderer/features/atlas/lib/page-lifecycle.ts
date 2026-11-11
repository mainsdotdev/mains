export type AtlasPagePhase = "idle" | "saving" | "acting" | "trashed";
export interface AtlasPageOperation { current: () => boolean }
export type AtlasPageIntent = "navigate" | "read" | "edit" | "trash" | "restore" | "revision" | "recover" | "send";

const ACTION_RULES: Record<AtlasPageIntent, {
  save: boolean; lockEditing: boolean; requireActive: boolean; trashed?: boolean;
}> = {
  navigate: { save: true, lockEditing: false, requireActive: false },
  read: { save: false, lockEditing: false, requireActive: false },
  edit: { save: false, lockEditing: false, requireActive: true },
  trash: { save: true, lockEditing: true, requireActive: true, trashed: true },
  restore: { save: false, lockEditing: true, requireActive: false, trashed: false },
  revision: { save: true, lockEditing: true, requireActive: true },
  recover: { save: false, lockEditing: true, requireActive: false },
  send: { save: true, lockEditing: false, requireActive: true },
};

/** Save -> recheck ownership -> act. Only one action owns a surface at a time.
 * Flush waits for the whole action, not just its save. Destructive actions
 * lock editing until failure or confirmed completion; Trash remains read-only.
 * Draft/error/conflict state stays in the save queue, whose false barrier
 * prevents any dependent action without discarding the draft.
 * Invalidating a surface retires its continuations without canceling a write
 * already accepted by its original backend or unlocking a replacement owner.
 */
export function createAtlasPageLifecycle(options: {
  isCurrent: () => boolean;
  save: () => Promise<boolean>;
  trashed?: boolean;
  onState: (state: { phase: AtlasPagePhase; busy: boolean; editable: boolean }) => void;
}) {
  let active = true;
  let generation = 0;
  let pending: Promise<boolean> | undefined;
  let trashed = options.trashed ?? false;
  let editingLocked = false;
  let phase: AtlasPagePhase = trashed ? "trashed" : "idle";
  const consumed = new Set<string>();
  const owned = () => active && options.isCurrent();
  const editable = () => owned() && !trashed && !editingLocked;
  const publish = () => options.onState({ phase, busy: !!pending, editable: editable() });
  async function flush(current = owned) {
    if (!current()) return false;
    if (trashed) return true;
    return await options.save() && current();
  }
  return {
    get owned() { return owned(); },
    get canEdit() { return editable(); },
    consume(token: string) {
      if (!owned() || consumed.has(token)) return false;
      consumed.add(token);
      if (consumed.size > 256) consumed.delete(consumed.values().next().value!);
      return true;
    },
    setTrashed(value: boolean) {
      trashed = value;
      if (!pending) phase = trashed ? "trashed" : "idle";
      publish();
    },
    activate() { active = true; publish(); },
    deactivate() { active = false; generation++; pending = undefined; editingLocked = false; phase = trashed ? "trashed" : "idle"; },
    flush() {
      const epoch = generation;
      const current = () => owned() && epoch === generation;
      return pending ? pending.then((done) => done && flush(current), () => false) : flush(current);
    },
    run(action: (operation: AtlasPageOperation) => Promise<void> | void, intent: AtlasPageIntent = "navigate"): Promise<boolean> {
      const settings = ACTION_RULES[intent];
      if (pending || !owned() || (settings.requireActive && trashed)) return Promise.resolve(false);
      const save = settings.save;
      const epoch = generation;
      const current = () => owned() && epoch === generation && !(settings.requireActive && trashed);
      let resolve!: (done: boolean) => void;
      let reject!: (error: unknown) => void;
      const operation = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; }).finally(() => {
        if (pending !== operation) return;
        pending = undefined; editingLocked = false; phase = trashed ? "trashed" : "idle"; publish();
      });
      pending = operation;
      editingLocked = settings.lockEditing;
      phase = save ? "saving" : "acting"; publish();
      // Install ownership before publishing state or invoking an effect, while
      // still starting the save synchronously (including beforeunload).
      void (async () => {
        if (save && !(await flush(current))) return false;
        if (!current()) return false;
        phase = "acting"; publish();
        await action({ current });
        if (!current()) return false;
        if (settings.trashed !== undefined) trashed = settings.trashed;
        return true;
      })().then(resolve, (error: unknown) => { if (current()) reject(error); else resolve(false); });
      return operation;
    },
  };
}
