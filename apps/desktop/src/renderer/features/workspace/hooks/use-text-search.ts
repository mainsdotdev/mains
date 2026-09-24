import { useEffect, useReducer, useRef, useState } from "react";
import { appApi } from "@/lib/transport";
import type { ServiceResponse } from "@/features/workspace/types/file-explorer";
import type { TextSearchResult } from "@mains/contracts/text-search";

const TEXT_SEARCH_DEBOUNCE_MS = 250;

export interface TextSearchFlags {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

type State = {
  result: TextSearchResult | null;
  loading: boolean;
  error: string | null;
};

type Action =
  | { type: "start" }
  | { type: "success"; result: TextSearchResult }
  | { type: "error"; error: string }
  | { type: "reset" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "start":
      // Earlier results stay up while the next search runs — no flicker.
      return { ...state, loading: true, error: null };
    case "success":
      return { result: action.result, loading: false, error: null };
    case "error":
      return { result: null, loading: false, error: action.error };
    case "reset":
      return { result: null, loading: false, error: null };
  }
}

/**
 * Debounced content search under `rootPath`. Each new query (or a cleared
 * one) cancels the ripgrep process of the query before it through a
 * per-hook `cancelKey`, so typing never stacks searches in the backend.
 */
export function useTextSearch({
  rootPath,
  query,
  flags,
  includeHidden,
  maxResults,
  enabled,
}: {
  rootPath: string;
  query: string;
  flags: TextSearchFlags;
  includeHidden: boolean;
  maxResults: number;
  enabled: boolean;
}): State {
  const [state, dispatch] = useReducer(reducer, {
    result: null,
    loading: false,
    error: null,
  });
  // Unique across every client of the backend, not just this window — a
  // shared key would let one client's typing cancel another's search.
  // (crypto.randomUUID is missing on a plain-http web client.)
  const [cancelKey] = useState(
    () => `text-search:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
  );
  // A request the backend may still be running — worth cancelling.
  const pendingRef = useRef(false);
  const { caseSensitive, wholeWord, regex } = flags;
  const active = enabled && query.trim().length > 0;

  useEffect(() => {
    if (!active) {
      dispatch({ type: "reset" });
      if (pendingRef.current) {
        pendingRef.current = false;
        // An empty query under the same key stops the running search.
        void appApi.fileExplorer
          .searchText({ rootPath, query: "", cancelKey })
          .catch(() => {});
      }
      return;
    }

    let cancelled = false;
    dispatch({ type: "start" });
    const timeoutId = window.setTimeout(() => {
      pendingRef.current = true;
      appApi.fileExplorer
        .searchText({
          rootPath,
          query,
          caseSensitive,
          wholeWord,
          regex,
          includeHidden,
          maxResults,
          cancelKey,
        })
        .then((response: ServiceResponse<TextSearchResult>) => {
          if (cancelled) return;
          pendingRef.current = false;
          if (response.success) {
            dispatch({ type: "success", result: response.data });
          } else {
            dispatch({ type: "error", error: response.error });
          }
        })
        .catch((err: Error) => {
          if (cancelled) return;
          pendingRef.current = false;
          dispatch({ type: "error", error: err.message });
        });
    }, TEXT_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    active,
    rootPath,
    query,
    caseSensitive,
    wholeWord,
    regex,
    includeHidden,
    maxResults,
    cancelKey,
  ]);

  // Leaving the explorer mid-search stops the search too.
  useEffect(
    () => () => {
      if (!pendingRef.current) return;
      void appApi.fileExplorer
        .searchText({ rootPath, query: "", cancelKey })
        .catch(() => {});
    },
    [rootPath, cancelKey],
  );

  return state;
}
