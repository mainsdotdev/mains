import { createContext, useCallback, useContext, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";

function createToolPresence() {
  const counts = new Map<string, number>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    has(id: string | undefined) { return id !== undefined && counts.has(id); },
    retain(ids: readonly string[]) {
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
      if (ids.length) notify();
      return () => {
        for (const id of ids) {
          const count = counts.get(id) ?? 0;
          if (count <= 1) counts.delete(id); else counts.set(id, count - 1);
        }
        if (ids.length) notify();
      };
    },
  };
}

const Context = createContext<ReturnType<typeof createToolPresence> | null>(null);

/** Mounted transcript rows own presence; closing either accordion releases it. */
export function ToolActivityPresenceProvider({ children }: { children: ReactNode }) {
  const [presence] = useState(createToolPresence);
  return <Context.Provider value={presence}>{children}</Context.Provider>;
}

export function useVisibleToolCalls(ids: readonly string[]) {
  const presence = useContext(Context);
  useLayoutEffect(() => presence?.retain(ids), [presence, ids]);
}

export function useIsToolVisible(id: string | undefined): boolean {
  const presence = useContext(Context);
  const subscribe = useCallback((listener: () => void) => presence?.subscribe(listener) ?? (() => {}), [presence]);
  const snapshot = useCallback(() => presence?.has(id) ?? false, [presence, id]);
  return useSyncExternalStore(subscribe, snapshot);
}
