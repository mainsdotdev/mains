import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";
import { createTabResourceLifecycle } from "../../shared/tab-resource-lifecycle";

interface Preparation {
  prepare: () => Promise<void>;
  lifecycle: ReturnType<typeof createTabResourceLifecycle<void>>;
}

const Context = createContext({
  register: (_id: string, _prepare: () => Promise<void>) => () => {},
  prepareClose: async (_id: string) => {},
});

export function PreviewTabLifecycleProvider({ children }: { children: ReactNode }) {
  const preparations = useRef(new Map<string, Preparation>());
  const register = useCallback((id: string, prepare: () => Promise<void>) => {
    preparations.current.get(id)?.lifecycle.release();
    // The resource owns successful saves. This registry only joins pending
    // closes and retires them when the registered resource changes.
    const entry = { prepare, lifecycle: createTabResourceLifecycle<void>(() => false) };
    preparations.current.set(id, entry);
    return () => {
      entry.lifecycle.release();
      if (preparations.current.get(id) === entry) preparations.current.delete(id);
    };
  }, []);
  const prepareClose = useCallback(async (id: string) => {
    const entry = preparations.current.get(id);
    if (!entry) return;
    const request = entry.lifecycle.prepare(entry, entry.prepare);
    await request.result;
    if (!request.current()) throw new Error("App changed while saving; retry closing this tab");
  }, []);
  return <Context.Provider value={{ register, prepareClose }}>{children}</Context.Provider>;
}

export function usePreviewTabLifecycle() { return useContext(Context); }
