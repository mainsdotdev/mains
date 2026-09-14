// ─────────────────────────────────────────────────────────────
// Seed v2 — Provider model/effort defaults
//
// v1 shipped a hardcoded `default_model` per provider and no reasoning-effort
// value at all. Both aged badly:
//
//   * The pinned ids stopped matching the CLIs' live catalogs (Claude's was
//     `claude-opus-4-8` — an API id that never matched an SDK alias), so no
//     model got `isDefault` and the picker silently fell back to list order.
//     Drivers now resolve the default from the live catalog, so the column
//     goes back to meaning "the id the *user* pinned" — cleared here, but only
//     where it still holds the v1 value.
//   * Effort was never seeded, and the renderer only auto-filled it when
//     thinking was already on — which for Codex/Copilot is itself inferred
//     from the effort value. Runs launched outside the workspace UI (pulse,
//     automations) read the config directly, so the default belongs in the DB.
//
// It also heals the `ultracode: true` + `thinkingMode: false` combination,
// which made every Claude run fail with "effort 'xhigh' is not supported when
// thinking is disabled on this model".
// ─────────────────────────────────────────────────────────────

import { and, eq, sql } from "drizzle-orm";
import { providers } from "../schema";
import { PROVIDER_IDS } from "../../../shared/provider-ids";
import type { DatabaseInstance } from "../types";

/** The exact `default_model` values v1 seeded, per provider. */
const V1_SEEDED_DEFAULT_MODELS: Record<string, string> = {
  [PROVIDER_IDS.copilot]: "claude-sonnet-4-6",
  [PROVIDER_IDS.claude]: "claude-opus-4-8",
  [PROVIDER_IDS.codex]: "gpt-5.4",
  [PROVIDER_IDS.cursor]: "composer-2.5[fast=true]",
};

/**
 * Config keys to add when absent. Cursor and Copilot are omitted on purpose:
 * both default to their "auto" model, which advertises no effort levels, so a
 * seeded value would just be cleared on first render.
 */
const EFFORT_DEFAULTS: Record<string, Record<string, unknown>> = {
  [PROVIDER_IDS.claude]: { thinkingMode: true, effortLevel: "medium" },
  [PROVIDER_IDS.codex]: { modelReasoningEffort: "medium" },
};

export async function run(db: DatabaseInstance): Promise<void> {
  // 1. Un-pin the v1 default models — but leave a user's own pick alone.
  for (const [providerId, staleModel] of Object.entries(V1_SEEDED_DEFAULT_MODELS)) {
    db.update(providers)
      .set({ defaultModel: null, updatedAt: sql`(unixepoch())` })
      .where(and(eq(providers.id, providerId), eq(providers.defaultModel, staleModel)))
      .run?.();
  }

  // 2. Backfill effort defaults and heal the ultracode/thinking desync.
  for (const providerId of Object.values(PROVIDER_IDS)) {
    const row = db
      .select({ config: providers.config })
      .from(providers)
      .where(eq(providers.id, providerId))
      .get?.();
    if (!row) continue;

    let config: Record<string, unknown>;
    try {
      config = row.config ? { ...(JSON.parse(row.config) as Record<string, unknown>) } : {};
    } catch {
      continue; // Unparseable config is not ours to rewrite.
    }

    let changed = false;
    for (const [key, value] of Object.entries(EFFORT_DEFAULTS[providerId] ?? {})) {
      if (config[key] === undefined) {
        config[key] = value;
        changed = true;
      }
    }
    if (config.ultracode === true && config.thinkingMode !== true) {
      config.thinkingMode = true;
      changed = true;
    }
    if (!changed) continue;

    db.update(providers)
      .set({ config: JSON.stringify(config), updatedAt: sql`(unixepoch())` })
      .where(eq(providers.id, providerId))
      .run?.();
  }
}
