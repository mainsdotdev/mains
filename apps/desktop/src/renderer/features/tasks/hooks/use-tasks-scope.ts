import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  readTasksLocation,
  scopeForTab,
  tasksLocationParams,
  type TasksScope,
  type TasksTab,
} from "../lib/scope";

/**
 * The /tasks tab and sidebar selection, kept in the URL
 * (`?tab=&provider=&resource=`) so the page and the sidebar read one source
 * of truth and a view is linkable. Switching tabs drops a scope the new tab
 * cannot show. `replace` is for corrections (a revoked connection) that must
 * not add a history entry of their own.
 */
export function useTasksScope() {
  const [params, setParams] = useSearchParams();
  const { tab, scope } = useMemo(() => readTasksLocation(params), [params]);

  const setTab = useCallback(
    (next: TasksTab) => setParams(tasksLocationParams(next, scopeForTab(scope, next))),
    [scope, setParams],
  );

  const setScope = useCallback(
    (next: TasksScope, options?: { replace?: boolean }) =>
      setParams(tasksLocationParams(tab, next), options),
    [tab, setParams],
  );

  return { tab, scope, setTab, setScope };
}
