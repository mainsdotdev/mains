// ─────────────────────────────────────────────────────────────
// Seed v1 — Initial data (accounts, apps, connections, providers, spaces)
//
// This is the baseline seed that was previously in the individual
// seed-*.ts query files. All existing users already have this data,
// so every operation uses onConflictDoNothing / existence checks.
// ─────────────────────────────────────────────────────────────

import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { accounts, connectionStates, connections, providers, spaces, appSettings } from "../schema";
import { seedAccounts } from "../data/accounts";
import { seedProviders } from "../data/providers";
import { seedSpaces } from "../data/spaces";
import { connectionStatesData } from "../data/connectionStates";
import type { DatabaseInstance } from "../types";

export async function run(db: DatabaseInstance): Promise<void> {
  // 1. Accounts (must be first — foreign key dependency)
  for (const account of seedAccounts) {
    db.insert(accounts).values(account).onConflictDoNothing().run?.();
  }

  // 2. Connection states
  for (const app of connectionStatesData) {
    db.insert(connectionStates)
      .values({
        id: app.id,
        isConnected: false,
        connectionId: null,
        displayName: app.name,
        iconPath: app.imageSrc,
        category: app.category,
        sortOrder: connectionStatesData.indexOf(app),
        enabledFeatures: JSON.stringify([]),
        config: JSON.stringify({ description: app.description ?? "" }),
      })
      .onConflictDoNothing()
      .run?.();
  }

  // 3. Connections
  const connectionProviders = [
    { provider: "github", displayName: "GitHub" },
    { provider: "linear", displayName: "Linear" },
    { provider: "gitlab", displayName: "GitLab" },
    { provider: "jira", displayName: "Jira" },
    { provider: "asana", displayName: "Asana" },
    { provider: "trello", displayName: "Trello" },
    { provider: "sentry", displayName: "Sentry" },
    { provider: "socketdev", displayName: "Socket" },
  ];

  for (const cp of connectionProviders) {
    const existing = await db.query.connections.findFirst({
      where: eq(connections.provider, cp.provider),
    });
    if (!existing) {
      const id = generateConnectionId();
      await db.insert(connections).values({
        id,
        provider: cp.provider,
        type: "api_key",
        displayName: cp.displayName,
        status: "revoked",
        scopes: JSON.stringify([]),
        metadata: JSON.stringify(null),
      });
    }
  }

  // 4. Providers
  for (const provider of seedProviders) {
    db.insert(providers)
      .values({
        id: provider.id,
        kind: provider.kind,
        displayName: provider.displayName,
        isEnabled: provider.isEnabled ?? true,
        config: provider.config ? JSON.stringify(provider.config) : null,
        capabilities: provider.capabilities ? JSON.stringify(provider.capabilities) : null,
        defaultModel: provider.defaultModel ?? null,
      })
      .onConflictDoNothing()
      .run?.();
  }

  // 5. Spaces + appSettings active space
  const ACCOUNT_ID = "default";
  for (const space of seedSpaces) {
    db.insert(spaces)
      .values({
        id: space.id,
        accountId: ACCOUNT_ID,
        name: space.name,
        slug: space.slug,
        description: null,
        systemPrompt: space.systemPrompt || null,
        model: null,
        icon: space.icon || null,
        themeConfig: JSON.stringify(space.themeConfig),
        providerId: space.providerId,
        mode: space.mode,
        sortOrder: space.sortOrder,
      })
      .onConflictDoNothing()
      .run?.();
  }

  db.insert(appSettings)
    .values({
      id: "default",
      accountId: ACCOUNT_ID,
      activeSpaceId: "claude",
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        activeSpaceId: "claude",
        updatedAt: sql`(unixepoch())`,
      },
    })
    .run?.();
}

// ─────────────────────────────────────────────────────────────

function generateConnectionId(): string {
  const timestamp = Date.now().toString(36);
  const randomStr = Array.from({ length: 16 }, () =>
    Math.random().toString(36).charAt(2),
  ).join("");
  return `c${timestamp}${randomStr}`.slice(0, 24);
}
