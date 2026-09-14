import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";

import { MIGRATIONS } from "./migrations";
import * as schema from "./schema";

// Change listener on: `useLiveQuery` in screens depends on sqlite's update hook
// to know when a sync wrote something.
const expo = openDatabaseSync("mains.db", { enableChangeListener: true });

function migrate(): void {
  const row = expo.getFirstSync<{ user_version: number }>("PRAGMA user_version");
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const next = version + 1;
    expo.withTransactionSync(() => {
      expo.execSync(MIGRATIONS[version]);
      expo.execSync(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }
}

// Migrating at import time means every importer sees a ready database; the
// schema is tiny, so this costs a few milliseconds on first launch only.
migrate();

export const db = drizzle(expo, { schema });
export type Db = typeof db;
