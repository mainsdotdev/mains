import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";

const Context = createContext({
  register: (_id: string, _prepare: () => Promise<void>) => () => {},
  prepareClose: async (_id: string) => {},
});

export function PreviewTabLifecycleProvider({ children }: { children: ReactNode }) {
  const preparations = useRef(new Map<string, () => Promise<void>>());
  const register = useCallback((id: string, prepare: () => Promise<void>) => {
    preparations.current.set(id, prepare);
    return () => { if (preparations.current.get(id) === prepare) preparations.current.delete(id); };
  }, []);
  const prepareClose = useCallback(async (id: string) => { await preparations.current.get(id)?.(); }, []);
  return <Context.Provider value={{ register, prepareClose }}>{children}</Context.Provider>;
}

export function usePreviewTabLifecycle() { return useContext(Context); }
