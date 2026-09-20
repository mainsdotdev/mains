import { getTableName, type Table } from "drizzle-orm";
import { addDatabaseChangeListener } from "expo-sqlite";
import { useEffect, useState, type DependencyList } from "react";

import { createChangeRefreshCoalescer } from "./change-refresh-coalescer";

type ArrayQuery = PromiseLike<readonly unknown[]>;

/**
 * A live query for large, bulk-synced tables. Expo emits one database-change
 * event per changed row, so waiting for the burst to settle avoids rerunning
 * and rematerializing the full query once for every row in the transaction.
 */
export function useCoalescedLiveQuery<TQuery extends ArrayQuery>(
  query: TQuery,
  table: Table,
  deps: DependencyList = [],
) {
  type Result = Awaited<TQuery>;
  const [data, setData] = useState<Result>(() => [] as unknown as Result);
  const [error, setError] = useState<Error>();
  const [updatedAt, setUpdatedAt] = useState<Date>();

  useEffect(() => {
    let active = true;
    let requestVersion = 0;

    const refresh = () => {
      const version = ++requestVersion;
      void Promise.resolve(query).then(
        (result) => {
          if (!active || version !== requestVersion) return;
          setData(result);
          setError(undefined);
          setUpdatedAt(new Date());
        },
        (reason: unknown) => {
          if (!active || version !== requestVersion) return;
          setError(reason instanceof Error ? reason : new Error(String(reason)));
        },
      );
    };

    const coalescer = createChangeRefreshCoalescer(refresh);
    const tableName = getTableName(table);
    const subscription = addDatabaseChangeListener((event) => {
      if (event.tableName === tableName) coalescer.request();
    });
    refresh();

    return () => {
      active = false;
      coalescer.dispose();
      subscription.remove();
    };
    // The query object is recreated on render; callers provide its stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, updatedAt } as const;
}
