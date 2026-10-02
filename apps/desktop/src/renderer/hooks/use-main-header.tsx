import { createContext, useContext, useState, useLayoutEffect, useCallback, type ReactNode } from "react";

interface MainHeaderState {
  header: ReactNode | null;
  firstTabActive: boolean;
}

const DEFAULT_STATE: MainHeaderState = { header: null, firstTabActive: false };

interface MainHeaderContextType extends MainHeaderState {
  setMainHeader: (state: MainHeaderState) => void;
  browserTabsHost: HTMLDivElement | null;
  setBrowserTabsHost: (host: HTMLDivElement | null) => void;
}

const MainHeaderContext = createContext<MainHeaderContextType>({
  ...DEFAULT_STATE,
  setMainHeader: () => {},
  browserTabsHost: null,
  setBrowserTabsHost: () => {},
});

export function MainHeaderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MainHeaderState>(DEFAULT_STATE);
  const [browserTabsHost, setBrowserTabsHost] = useState<HTMLDivElement | null>(null);
  const setMainHeader = useCallback((s: MainHeaderState) => setState(s), []);
  return (
    <MainHeaderContext.Provider value={{ ...state, setMainHeader, browserTabsHost, setBrowserTabsHost }}>
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
  // Layout effect: the header lands in the same frame as the content it
  // belongs to, never one frame behind it.
  useLayoutEffect(() => {
    setMainHeader({ header, firstTabActive });
    return () => setMainHeader(DEFAULT_STATE);
  }, [header, firstTabActive, setMainHeader]);
}
