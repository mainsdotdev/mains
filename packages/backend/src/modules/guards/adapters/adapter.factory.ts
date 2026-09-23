// ─────────────────────────────────────────────────────────────
// Guard Adapter Factory
// Creates appropriate guard adapter based on connection state
// ─────────────────────────────────────────────────────────────

import { eq, and } from "drizzle-orm";
import { getDb } from "../../../db/client";
import { connectionStates } from "../../../db/schema";
import { getConnectionWithSecrets } from "../../connections";
import { getSelectedResources } from "../../sync/sync.connection-utils";
import type { GuardAdapter, GuardConfig } from "./adapter.types";
import { createSocketDevAdapter } from "./socketdev.adapter";

/**
 * Guard provider IDs — order defines priority when multiple are connected
 */
export const SUPPORTED_GUARDS = ["socketdev"] as const;
export type SupportedGuard = (typeof SUPPORTED_GUARDS)[number];

/**
 * Cache of adapter instances
 */
const adapterCache = new Map<string, GuardAdapter>();

/**
 * Create a guard adapter for a specific provider
 */
export async function createGuardAdapter(
  providerId: SupportedGuard,
  config?: GuardConfig,
): Promise<GuardAdapter | null> {
  // Check cache
  const cached = adapterCache.get(providerId);
  if (cached) return cached;

  const connection = await getConnectionWithSecrets(providerId);
  if (!connection) return null;

  let adapter: GuardAdapter;

  switch (providerId) {
    case "socketdev": {
      const apiToken = connection.secrets.apiToken;
      if (!apiToken) return null;

      // Get selected organization slug
      const resources = await getSelectedResources(connection.id, "socketdev_org");
      const orgSlug = resources[0]?.externalId;

      adapter = createSocketDevAdapter({ apiToken, orgSlug, config });
      break;
    }
    default:
      return null;
  }

  adapterCache.set(providerId, adapter);
  return adapter;
}

/**
 * Get the active guard adapter based on which guard connections are enabled.
 * Returns the first connected guard in priority order, or null.
 */
export async function getActiveGuard(config?: GuardConfig): Promise<GuardAdapter | null> {
  const db = getDb();

  for (const guardId of SUPPORTED_GUARDS) {
    const state = db
      .select()
      .from(connectionStates)
      .where(
        and(
          eq(connectionStates.id, guardId),
          eq(connectionStates.isConnected, true),
        ),
      )
      .get();

    if (state) {
      const adapter = await createGuardAdapter(guardId, config);
      if (adapter) return adapter;
    }
  }

  return null;
}

/**
 * Get info about the active guard provider without creating an adapter
 */
export function getActiveGuardInfo(): { id: string; displayName: string } | null {
  const db = getDb();

  for (const guardId of SUPPORTED_GUARDS) {
    const state = db
      .select()
      .from(connectionStates)
      .where(
        and(
          eq(connectionStates.id, guardId),
          eq(connectionStates.isConnected, true),
        ),
      )
      .get();

    if (state) {
      const names: Record<string, string> = { socketdev: "Socket.dev" };
      return { id: guardId, displayName: names[guardId] || guardId };
    }
  }
  return null;
}

/**
 * Invalidate a cached adapter (e.g. when credentials change)
 */
export function invalidateGuardAdapter(providerId: string): void {
  adapterCache.delete(providerId);
}

/**
 * Shutdown all cached guard adapters
 */
export async function shutdownAllGuardAdapters(): Promise<void> {
  for (const [id, adapter] of adapterCache) {
    if (adapter.shutdown) {
      await adapter.shutdown().catch((err) => {
        console.error(`[GuardFactory] Error shutting down ${id}:`, err);
      });
    }
  }
  adapterCache.clear();
}
