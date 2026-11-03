import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import { providers, spaces } from "../schema";
import { seedProviders } from "../data/providers";
import { seedSpaces } from "../data/spaces";
import type { DatabaseInstance } from "../types";

/**
 * Existing databases stopped at seed v3, before OpenCode existed. Insert the
 * provider and its developer Space without touching a row the user already has.
 */
export async function run(db: DatabaseInstance): Promise<void> {
  const provider = seedProviders.find((entry) => entry.id === PROVIDER_IDS.opencode);
  const space = seedSpaces.find((entry) => entry.id === "opencode");
  if (!provider || !space) throw new Error("OpenCode seed data is missing");

  db.insert(providers).values({
    id: provider.id,
    kind: provider.kind,
    displayName: provider.displayName,
    isEnabled: provider.isEnabled ?? true,
    config: provider.config ? JSON.stringify(provider.config) : null,
    capabilities: provider.capabilities ? JSON.stringify(provider.capabilities) : null,
    defaultModel: provider.defaultModel ?? null,
  }).onConflictDoNothing().run();

  db.insert(spaces).values({
    id: space.id,
    accountId: "default",
    name: space.name,
    slug: space.slug,
    providerId: space.providerId,
    mode: space.mode,
    icon: space.icon,
    systemPrompt: space.systemPrompt,
    themeConfig: JSON.stringify(space.themeConfig),
    sortOrder: space.sortOrder,
    isArchived: false,
  }).onConflictDoNothing().run();
}
