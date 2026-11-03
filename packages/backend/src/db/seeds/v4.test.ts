import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../../test/setup-db";
import { createAppSettings } from "../../../test/factories";
import { providers, spaces } from "../schema";
import { run } from "./v4";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe("OpenCode seed", () => {
  it("inserts the provider and Space, and leaves an existing Space alone", async () => {
    const test = createTestDb();
    cleanup = test.cleanup;
    const { db } = test;
    createAppSettings(db, { backendId: "backend-a" });
    db.insert(spaces).values({
      id: "opencode",
      accountId: "default",
      name: "Mine",
      slug: "renamed",
      providerId: "opencode",
      mode: "developer",
      isArchived: true,
    }).run();

    await run(db);
    await run(db);

    expect(db.select().from(providers).where(eq(providers.id, "opencode")).get()).toMatchObject({
      id: "opencode",
      displayName: "OpenCode",
      isEnabled: true,
    });
    expect(db.select().from(spaces).where(eq(spaces.id, "opencode")).get()).toMatchObject({
      name: "Mine",
      slug: "renamed",
      isArchived: true,
    });
  });
});
