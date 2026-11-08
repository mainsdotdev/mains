/** The SDK owns the subprocess; this module owns permission to use/release it. */
export interface ClaudeQueryHandle { close(): void | Promise<void> }
class ClaudeQueryCleanupError extends Error {
  constructor(readonly errors: unknown[]) {
    super("Failed to close Claude queries; retry shutdown");
    this.name = "ClaudeQueryCleanupError";
  }
}
export interface ClaudeQueryScope {
  readonly active: boolean;
  readonly signal: AbortSignal;
  assertActive(): void;
  acquire<Q extends ClaudeQueryHandle>(factory: () => Q): Q;
  run<T>(work: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
  cancel(reason?: Error): Promise<void>;
}

/** Per-driver ownership, including prepared sessions and short control queries.
 * preparing -> running -> closing -> closed; close failures retain ownership.
 * Shutdown retires the generation immediately, joins every release, and only
 * permits another generation after all releases succeed. */
export function createClaudeQueryLifecycle<SDK>() {
  let generation = 0;
  let stopping = false;
  let closing: Promise<void> | undefined;
  let loading: Promise<SDK> | undefined;
  const scopes = new Set<ClaudeQueryScope>();
  function checkpoint() {
    if (stopping) throw new Error("Claude runtime is shutting down");
    const revision = generation;
    return () => {
      if (stopping || generation !== revision) throw new Error("Claude operation canceled by shutdown");
    };
  }
  return {
    checkpoint,
    load(loader: () => Promise<SDK>): Promise<SDK> {
      const assert = checkpoint();
      if (!loading) {
        const pending = Promise.resolve().then(loader).then((sdk) => { assert(); return sdk; });
        loading = pending;
        void pending.catch(() => { if (loading === pending) loading = undefined; });
      }
      return loading.then((sdk) => { assert(); return sdk; });
    },
    open(options: { cancel?: () => void; retire?: () => void; release?: () => void | Promise<void> } = {}): ClaudeQueryScope {
      const assert = checkpoint();
      const controller = new AbortController();
      let phase: "preparing" | "running" | "closing" | "closed" = "preparing";
      let query: ClaudeQueryHandle | undefined;
      let release: Promise<void> | undefined;
      let retired = false, canceled = false, queryClosed = false;
      const scope: ClaudeQueryScope = {
        get signal() { return controller.signal; },
        get active() {
          try { assert(); return phase === "preparing" || phase === "running"; }
          catch { return false; }
        },
        assertActive() {
          assert();
          if (phase === "closing" || phase === "closed") throw controller.signal.reason ?? new Error("Claude query closed");
        },
        acquire(factory) {
          scope.assertActive();
          if (phase !== "preparing") throw new Error("Claude query already acquired");
          const value = factory();
          query = value; phase = "running";
          return value;
        },
        async run(work) {
          scope.assertActive();
          let abort!: () => void;
          const canceled = new Promise<never>((_, reject) => {
            abort = () => reject(controller.signal.reason);
            controller.signal.addEventListener("abort", abort, { once: true });
          });
          try {
            const result = await Promise.race([Promise.resolve().then(() => { scope.assertActive(); return work(); }), canceled]);
            scope.assertActive();
            return result;
          } finally { controller.signal.removeEventListener("abort", abort); }
        },
        close() {
          if (release) return release;
          if (phase === "closed") return Promise.resolve();
          phase = "closing";
          controller.abort(new Error("Claude query closed"));
          const pending = Promise.resolve().then(async () => {
            if (!retired) { options.retire?.(); retired = true; }
            if (!queryClosed) { await query?.close(); queryClosed = true; }
            await options.release?.();
            phase = "closed"; scopes.delete(scope);
          });
          release = pending;
          void pending.catch(() => { if (release === pending) release = undefined; });
          return pending;
        },
        cancel(reason = new Error("Claude query canceled")) {
          if (!canceled && phase !== "closed") {
            canceled = true;
            controller.abort(reason);
            try { options.cancel?.(); }
            catch { /* A failed interrupt must still close the SDK query. */ }
          }
          return scope.close();
        },
      };
      scopes.add(scope);
      return scope;
    },
    shutdown(): Promise<void> {
      if (closing) return closing;
      stopping = true; generation++; loading = undefined;
      const pending = Promise.resolve().then(async () => {
        const results = await Promise.allSettled([...scopes].map((scope) => scope.cancel(new Error("Claude runtime shutdown"))));
        const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
        if (errors.length) throw new ClaudeQueryCleanupError(errors);
        stopping = false;
      });
      closing = pending;
      void pending.then(() => { if (closing === pending) closing = undefined; }, () => { if (closing === pending) closing = undefined; });
      return pending;
    },
  };
}

/** Directory-keyed idle queries. Pending opens share ownership; active readers
 * pin the query against both idle expiry and capacity eviction. */
export function createClaudeQueryPool<Q extends ClaudeQueryHandle>(options: {
  open: (hooks: { retire: () => void; release: () => void }) => ClaudeQueryScope;
  acquire: (key: string, owner: ClaudeQueryScope) => Promise<Q>;
  capacity: number;
  idleMs: number;
}) {
  interface Entry {
    owner: ClaudeQueryScope;
    query: Promise<Q>;
    busy: number;
    timer?: ReturnType<typeof setTimeout>;
  }
  const entries = new Map<string, Entry>();
  const occupied = new Set<Entry>();
  let opening: Promise<unknown> = Promise.resolve();
  function get(key: string): Entry {
    const existing = entries.get(key);
    if (existing) return existing;
    const owner = options.open({
      retire: () => clearTimeout(entry.timer),
      release: () => {
        occupied.delete(entry);
        if (entries.get(key) === entry) entries.delete(key);
      },
    });
    const query = opening.then(async () => {
      owner.assertActive();
      while (occupied.size >= options.capacity) {
        const idle = [...occupied].find((candidate) => candidate.busy === 0);
        if (!idle) throw new Error("Claude MCP hosts are busy; retry this request");
        await idle.owner.close();
        owner.assertActive();
      }
      occupied.add(entry);
      const query = await options.acquire(key, owner);
      owner.assertActive();
      return query;
    }).catch(async (error: unknown) => { await owner.close(); throw error; });
    opening = query.then(() => {}, () => {});
    const entry: Entry = { owner, query, busy: 0 };
    entries.set(key, entry);
    return entry;
  }
  return {
    async use<T>(key: string, work: (query: Q, owner: ClaudeQueryScope) => Promise<T>): Promise<T> {
      const entry = get(key);
      clearTimeout(entry.timer);
      entry.busy++;
      // Reinsert for LRU eviction, but never evict a pinned reader.
      entries.delete(key); entries.set(key, entry);
      try {
        const query = await entry.query;
        entry.owner.assertActive();
        occupied.delete(entry); occupied.add(entry);
        return await entry.owner.run(() => work(query, entry.owner));
      } catch (error) {
        if (/closed/i.test(error instanceof Error ? error.message : String(error))) await entry.owner.close();
        throw error;
      } finally {
        entry.busy--;
        if (!entry.busy && entry.owner.active) {
          entry.timer = setTimeout(() => { void entry.owner.close().catch(() => {}); }, options.idleMs);
          entry.timer.unref?.();
        }
      }
    },
  };
}
