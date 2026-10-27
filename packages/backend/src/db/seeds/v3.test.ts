import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb } from "../../../test/setup-db";
import { createAppSettings, createProject } from "../../../test/factories";
import { appSettings, projects, spaces } from "../schema";
import { run } from "./v3";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe("Bridge ownership seed", () => {
  it("heals db:push ownership once, preserving replicas, identity and user preferences", async () => {
    const test = createTestDb();
    cleanup = test.cleanup;
    const { db } = test;
    createAppSettings(db, { backendId: "backend-a", seedVersion: 2, enableWorktrees: true });
    createProject(db, { id: "local" });
    createProject(db, { id: "replica", ownerBackendId: "backend-b" });
    db.update(projects).set({ ownerBackendId: "" }).where(eq(projects.id, "local")).run();
    db.run(sql`DROP TRIGGER projects_local_owner`);
    await run(db);
    await run(db);
    expect(db.select({ owner: projects.ownerBackendId }).from(projects).where(eq(projects.id, "local")).get()?.owner).toBe("backend-a");
    expect(db.select({ owner: projects.ownerBackendId }).from(projects).where(eq(projects.id, "replica")).get()?.owner).toBe("backend-b");
    expect(db.select().from(appSettings).get()).toMatchObject({ backendId: "backend-a", enableWorktrees: true });
    db.run(sql`INSERT INTO projects(id, account_id, name, root_path) VALUES ('sql-writer', 'default', 'Repo', '/new/repo')`);
    expect(db.select({ owner: projects.ownerBackendId }).from(projects).where(eq(projects.id, "sql-writer")).get()?.owner).toBe("backend-a");
  });
  it("restores missing seeded ids archived and preserves existing renamed Spaces", async () => {
    const test = createTestDb();
    cleanup = test.cleanup;
    const { db } = test;
    createAppSettings(db, { backendId: "backend-a" });
    db.insert(spaces).values({ id: "codex", accountId: "default", name: "My Agent", slug: "renamed", isArchived: false }).run();
    await run(db);
    expect(db.select().from(spaces).where(eq(spaces.id, "codex")).get()).toMatchObject({ name: "My Agent", slug: "renamed", isArchived: false });
    expect(db.select().from(spaces).where(eq(spaces.id, "claude")).get()).toMatchObject({ id: "claude", isArchived: true });
  });
});
