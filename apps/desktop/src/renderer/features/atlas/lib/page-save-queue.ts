import type { AtlasPage } from "@mains/contracts/atlas";

export interface PageDraft { title: string; blocks: unknown[] }
/** Serial saves keep typing during an in-flight write from losing the newer draft. */
export function createPageSaveQueue(options: {
  page: AtlasPage;
  save: (draft: PageDraft, expectedVersion: number) => Promise<AtlasPage>;
  persist: (draft: PageDraft | null, version: number) => void;
  onState: (state: { saving: boolean; dirty: boolean; error: unknown | null }) => void;
}) {
  let version = options.page.item.version;
  let draft: PageDraft = { title: options.page.item.title, blocks: options.page.revision.blocks };
  let dirty = false;
  let error: unknown | null = null;
  let locked = false;
  let running: Promise<boolean> | null = null;
  const state = () => options.onState({ saving: !!running, dirty, error });
  const queue = {
    get version() { return version; },
    get blocked() { return locked; },
    get draft() { return draft; },
    edit(next: PageDraft) {
      draft = JSON.parse(JSON.stringify(next));
      dirty = true;
      options.persist(draft, version);
      state();
    },
    flush(): Promise<boolean> {
      if (running) return running;
      if (error) return Promise.resolve(false);
      if (!dirty) return Promise.resolve(true);
      running = (async () => {
        while (dirty && !error) {
          const snapshot = draft;
          const key = JSON.stringify(snapshot);
          try {
            const saved = await options.save(snapshot, version);
            version = saved.item.version;
            dirty = JSON.stringify(draft) !== key;
            options.persist(dirty ? draft : null, version);
          } catch (failure) { error = failure; }
        }
        return !error;
      })().finally(() => { running = null; state(); });
      state();
      return running;
    },
    retry() { if (locked) return Promise.resolve(false); error = null; return queue.flush(); },
    block(failure: unknown) { error = failure; locked = true; state(); },
    /** Return true only when it is safe to apply a newer backend revision. */
    sync(page: AtlasPage) {
      if (page.item.version <= version) return false;
      if (dirty || running) {
        error = "This page changed elsewhere. Export your draft or reload the latest version.";
        locked = true;
        state();
        return false;
      }
      version = page.item.version;
      draft = { title: page.item.title, blocks: page.revision.blocks };
      return true;
    },
    reset(page: AtlasPage) {
      if (running) throw new Error("Wait for the current save to finish");
      version = page.item.version;
      draft = { title: page.item.title, blocks: page.revision.blocks };
      dirty = false; error = null; locked = false;
      options.persist(null, version); state();
    },
  };
  return queue;
}
