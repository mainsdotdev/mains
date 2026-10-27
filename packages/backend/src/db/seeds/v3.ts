import { eq, getTableName, sql } from "drizzle-orm";
import { getLocalBackendId } from "../backend-identity";
import { automations, bridgeState, projects, pulses, runs, spaces, workspaces } from "../schema";
import { seedSpaces } from "../data/spaces";
import type { DatabaseInstance } from "../types";

/** db:push installs columns but skips SQL migration data fixes and triggers. */
export async function run(db: DatabaseInstance): Promise<void> {
  db.transaction(() => {
    const backendId = getLocalBackendId(db);
    for (const table of [projects, workspaces, runs, pulses, automations]) {
      db.update(table).set({ ownerBackendId: backendId }).where(eq(table.ownerBackendId, "")).run();
      const name = getTableName(table);
      db.run(sql.raw(`CREATE TRIGGER IF NOT EXISTS ${name}_local_owner AFTER INSERT ON ${name}
        WHEN NEW.owner_backend_id = '' BEGIN
          UPDATE ${name} SET owner_backend_id = (SELECT backend_id FROM app_settings WHERE id = 'default') WHERE id = NEW.id;
        END`));
    }
    db.insert(bridgeState).values({ id: 1, applying: false }).onConflictDoNothing().run();
    // Older releases allowed deleting these identities. Restore missing ones
    // archived, without changing a surviving Space or re-enabling an agent.
    for (const space of seedSpaces) {
      db.insert(spaces).values({
        id: space.id, accountId: "default", name: space.name, slug: space.slug,
        providerId: space.providerId, mode: space.mode, icon: space.icon,
        systemPrompt: space.systemPrompt, themeConfig: JSON.stringify(space.themeConfig),
        sortOrder: space.sortOrder, isArchived: true,
      }).onConflictDoNothing().run();
    }
  });
}
