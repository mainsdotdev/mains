// ─────────────────────────────────────────────────────────────
// Seed Runner — Versioned data seeding
//
// Each seed version is an idempotent function that inserts or
// updates data. The runner tracks which versions have been
// applied via app_settings.seedVersion and only runs new ones.
//
// To add new seed data:
//   1. Create src/main/db/seeds/v{N}.ts with `export async function run(db)`
//   2. Add it to the SEEDS array below
//   3. All existing users will get the new data on next app launch
// ─────────────────────────────────────────────────────────────

import { eq, sql } from "drizzle-orm";
import { appSettings } from "../schema";
import type { DatabaseInstance } from "../types";

import * as v1 from "./v1";
import * as v2 from "./v2";

type SeedVersion = {
  version: number;
  run: (db: DatabaseInstance) => Promise<void>;
};

const SEEDS: SeedVersion[] = [
  { version: 1, run: v1.run },
  { version: 2, run: v2.run },
];

export const CURRENT_SEED_VERSION = SEEDS.length;

/**
 * Run all pending seed versions.
 *
 * Reads the current seedVersion from app_settings, executes any
 * versions that haven't been applied yet, and updates the version.
 */
export async function runSeeds(db: DatabaseInstance): Promise<void> {
  const currentVersion = getSeedVersion(db);

  if (currentVersion >= CURRENT_SEED_VERSION) {
    console.log(`[Seeds] Already at version ${currentVersion}, nothing to do`);
    return;
  }

  console.log(
    `[Seeds] Upgrading from v${currentVersion} to v${CURRENT_SEED_VERSION}`,
  );

  for (const seed of SEEDS) {
    if (seed.version <= currentVersion) continue;

    console.log(`[Seeds] Running v${seed.version}...`);
    await seed.run(db);
    updateSeedVersion(db, seed.version);
    console.log(`[Seeds] v${seed.version} complete`);
  }

  console.log("[Seeds] All seeds applied");
}

// ─────────────────────────────────────────────────────────────

function getSeedVersion(db: DatabaseInstance): number {
  try {
    const row = db
      .select({ seedVersion: appSettings.seedVersion })
      .from(appSettings)
      .where(eq(appSettings.id, "default"))
      .get();

    return row?.seedVersion ?? 0;
  } catch {
    // Table might not have seedVersion column yet (pre-migration)
    // or no row exists — treat as version 0
    return 0;
  }
}

function updateSeedVersion(db: DatabaseInstance, version: number): void {
  db.update(appSettings)
    .set({
      seedVersion: version,
      updatedAt: sql`(unixepoch())`,
    })
    .where(eq(appSettings.id, "default"))
    .run();
}
