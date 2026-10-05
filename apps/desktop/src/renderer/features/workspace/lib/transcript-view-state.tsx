import { createContext, useCallback, useContext, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";

/** UI-only state. Never retain events, output strings, DOM nodes or React trees. */
export interface TranscriptViewState {
  scrollOffset: number | null;
  followTail: boolean;
  latestRevision: number;
  heights: Map<string, number>;
  values: Map<string, unknown>;
  listeners: Set<() => void>;
}

const VIEW_LIMIT = 4;
const VALUE_LIMIT = 512;
const HEIGHT_LIMIT = 128;

export function createTranscriptViewCache() {
  const views = new Map<string, TranscriptViewState>();
  return {
    get(runId: string): TranscriptViewState {
      const view = views.get(runId) ?? { scrollOffset: null, followTail: true, latestRevision: 0,
        heights: new Map(), values: new Map(), listeners: new Set() };
      views.delete(runId);
      views.set(runId, view);
      while (views.size > VIEW_LIMIT) views.delete(views.keys().next().value!);
      return view;
    },
  };
}

export function rememberRowHeight(view: TranscriptViewState, id: string, height: number) {
  view.heights.delete(id);
  view.heights.set(id, height);
  while (view.heights.size > HEIGHT_LIMIT) view.heights.delete(view.heights.keys().next().value!);
}

export function rememberTranscriptPosition(view: TranscriptViewState, update: Partial<Pick<TranscriptViewState, "scrollOffset" | "followTail" | "latestRevision">>) {
  Object.assign(view, update);
}

const Context = createContext<{ view: TranscriptViewState; scope: string } | null>(null);
export function TranscriptViewProvider({ view, children }: { view: TranscriptViewState | null; children: ReactNode }) {
  return <Context.Provider value={view ? { view, scope: "" } : null}>{children}</Context.Provider>;
}

export function TranscriptItemScope({ id, children }: { id: string; children: ReactNode }) {
  const parent = useContext(Context);
  return <Context.Provider value={parent ? { view: parent.view, scope: id } : null}>{children}</Context.Provider>;
}

/** Persist small interaction values across virtual row unmounts. */
export function useTranscriptValue<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const context = useContext(Context);
  const view = context?.view;
  const scopedKey = `${context?.scope ?? ""}/${key}`;
  const [local, setLocal] = useState(initial);
  const subscribe = useCallback((listener: () => void) => {
    view?.listeners.add(listener);
    return () => { view?.listeners.delete(listener); };
  }, [view]);
  const snapshot = useCallback(() => view?.values.has(scopedKey) ? view.values.get(scopedKey) as T : local, [view, scopedKey, local]);
  const value = useSyncExternalStore(subscribe, snapshot);
  const set = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    if (!view) { setLocal(next); return; }
    const previous = view.values.has(scopedKey) ? view.values.get(scopedKey) as T : initial;
    const result = typeof next === "function" ? (next as (value: T) => T)(previous) : next;
    if (Object.is(previous, result)) return;
    view.values.delete(scopedKey);
    view.values.set(scopedKey, result);
    while (view.values.size > VALUE_LIMIT) view.values.delete(view.values.keys().next().value!);
    for (const listener of view.listeners) listener();
  }, [view, scopedKey, initial]);
  return [value, set];
}

export function useToolExpansion(initial = false) { return useTranscriptValue("expanded", initial); }
