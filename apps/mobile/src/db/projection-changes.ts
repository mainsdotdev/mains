/** Projection writes publish one table-set after commit, never one native event per row. */
export function createProjectionChanges() {
  const listeners = new Set<(tables: ReadonlySet<string>) => void>();
  let pending = new Set<string>();
  let depth = 0;
  const flush = () => {
    if (depth || !pending.size) return;
    const changed = pending;
    pending = new Set();
    for (const listener of listeners) listener(changed);
  };
  return {
    subscribe(listener: (tables: ReadonlySet<string>) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    mark(table: string) { pending.add(table); flush(); },
    batch<T>(write: () => T): T {
      const before = new Set(pending);
      depth++;
      try { return write(); }
      catch (error) { pending = before; throw error; }
      finally { depth--; flush(); }
    },
  };
}

export const projectionChanges = createProjectionChanges();
