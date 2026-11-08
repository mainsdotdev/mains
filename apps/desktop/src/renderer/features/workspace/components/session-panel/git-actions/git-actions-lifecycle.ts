export type PendingAction = "commit" | "commitPush" | "push" | "pull" | "pr" | "publish" | "newBranch" | "discard" | "switchBranch" | "generateCommit" | "generatePr" | null;

/** One panel view owns one action at a time. Failed equal drafts reuse the
 * logical backend ID; every attempt has its own completion authority. */
export function createGitActionsLifecycle() {
  let generation = 0;
  let live = true, pending: PendingAction = null;
  let draft: { key: string; operationId: string; controller: AbortController } | undefined;
  let attempt: object | undefined;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    snapshot: () => pending,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate() { live = true; },
    capture() { const accepted = generation; return () => live && accepted === generation; },
    retire() { generation++; live = false; attempt = undefined; draft?.controller.abort(); draft = undefined; pending = null; emit(); },
    begin(action: Exclude<PendingAction, null>, input: string) {
      if (!live || pending) return null;
      const key = JSON.stringify([action, input]);
      if (draft?.key !== key) {
        draft?.controller.abort();
        draft = { key, operationId: crypto.randomUUID(), controller: new AbortController() };
      }
      const identity = {}, accepted = draft;
      attempt = identity; pending = action; emit();
      const current = () => live && attempt === identity;
      return { operationId: accepted.operationId, signal: accepted.controller.signal, current,
        finish(success: boolean) {
          if (!current() || pending !== action) return;
          pending = null;
          if (success) draft = undefined;
          emit();
        },
      };
    },
  };
}
