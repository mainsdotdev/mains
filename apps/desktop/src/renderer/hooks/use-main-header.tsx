import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

interface MainHeaderState {
  header: ReactNode | null;
  firstTabActive: boolean;
}

const DEFAULT_STATE: MainHeaderState = { header: null, firstTabActive: false };

interface MainHeaderContextType extends MainHeaderState {
  setMainHeader: (state: MainHeaderState) => void;
}

const MainHeaderContext = createContext<MainHeaderContextType>({
  ...DEFAULT_STATE,
  setMainHeader: () => {},
});

export function MainHeaderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MainHeaderState>(DEFAULT_STATE);
  const setMainHeader = useCallback((s: MainHeaderState) => setState(s), []);
  return (
    <MainHeaderContext.Provider value={{ ...state, setMainHeader }}>
      {children}
    </MainHeaderContext.Provider>
  );
}

export function useMainHeader() {
  return useContext(MainHeaderContext);
}

/** Set a header element that renders in the transparent area above MainContent's opaque container. */
export function useSetMainHeader(header: ReactNode | null, firstTabActive = false) {
  const { setMainHeader } = useMainHeader();
  useEffect(() => {
    setMainHeader({ header, firstTabActive });
    return () => setMainHeader(DEFAULT_STATE);
  }, [header, firstTabActive, setMainHeader]);
}
