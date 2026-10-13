import { drizzle } from "drizzle-orm/expo-sqlite";
import { getTableName, type Table } from "drizzle-orm";
import { openDatabaseSync } from "expo-sqlite";

import { migrateDatabase } from "./migrations";
import * as schema from "./schema";
import { projectionChanges } from "./projection-changes";

// Bulk sync and cache cleanup must not enqueue a native event for every row.
const projection = openDatabaseSync("mains.db", { enableChangeListener: false, useNewConnection: true });

// Migrating at import time means every importer sees a ready database; the
// schema is tiny, so this costs a few milliseconds on first launch only.
migrateDatabase(projection);

// Phone-owned settings still use the native update hook. Both connections read
// the same committed database; projection readers observe the explicit feed.
const expo = openDatabaseSync("mains.db", { enableChangeListener: true, useNewConnection: true });

export const db = drizzle(expo, { schema });
export const projectionDb = drizzle(projection, { schema });
export type Db = typeof db;

export function runProjectionWrite<T>(table: Table, write: () => T): T {
  const result = write();
  projectionChanges.mark(getTableName(table));
  return result;
}

type ProjectionTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export function projectionTransaction<T>(write: (tx: ProjectionTransaction) => T): T {
  return projectionChanges.batch(() => projectionDb.transaction(write));
}
