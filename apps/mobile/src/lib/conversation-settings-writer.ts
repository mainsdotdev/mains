import type { ConversationSettings } from "@mains/contracts/run-settings";

/** A sheet and its composer share one optimistic selection and one ordered write queue. */
export function createConversationSettingsWriter() {
  const writes = new Map<string, Promise<void>>();
  const pending = new Map<string, ConversationSettings>();
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getPending: (key: string) => pending.get(key) ?? null,
    write(key: string, settings: ConversationSettings, save: (settings: ConversationSettings) => Promise<void>): Promise<void> {
      const write = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(() => save(settings));
      writes.set(key, write);
      pending.set(key, settings);
      publish();
      const settle = () => {
        if (writes.get(key) !== write) return;
        writes.delete(key);
        pending.delete(key);
        publish();
      };
      void write.then(settle, settle);
      return write;
    },
    async wait(key: string): Promise<void> {
      for (;;) {
        const write = writes.get(key);
        if (!write) return;
        await write;
        if (writes.get(key) === write) return;
      }
    },
  };
}

/** Accept successful choices in intent order, even if another composer replies first. */
export function createSettingsIntents() {
  const revisions = new Map<string, number>();
  const accepted = new Map<string, number>();
  return {
    begin(key: string): number {
      const revision = (revisions.get(key) ?? 0) + 1;
      revisions.set(key, revision);
      return revision;
    },
    accept(key: string, revision: number): boolean {
      if (revision < (accepted.get(key) ?? 0)) return false;
      accepted.set(key, revision);
      return true;
    },
  };
}
