import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../../test/setup-db";
import { createProvider } from "../../../test/factories";
import { providers } from "../schema";
import { PROVIDER_IDS } from "../../../shared/provider-ids";
import type { DatabaseInstance } from "../types";
import { run } from "./v2";

let db: DatabaseInstance;
let cleanup: () => void;

function readProvider(id: string) {
  return db.select().from(providers).where(eq(providers.id, id)).get();
}

function readConfig(id: string): Record<string, unknown> {
  const raw = readProvider(id)?.config;
  return raw ? JSON.parse(raw) : {};
}

describe("seed v2 — provider model/effort defaults", () => {
  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
  });

  afterEach(() => {
    cleanup();
  });

  it("clears the v1-seeded default models", async () => {
    createProvider(db, { id: PROVIDER_IDS.claude, defaultModel: "claude-opus-4-8" });
    createProvider(db, { id: PROVIDER_IDS.codex, defaultModel: "gpt-5.4" });
    createProvider(db, { id: PROVIDER_IDS.copilot, defaultModel: "claude-sonnet-4-6" });
    createProvider(db, { id: PROVIDER_IDS.cursor, defaultModel: "composer-2.5[fast=true]" });

    await run(db);

    for (const id of Object.values(PROVIDER_IDS)) {
      expect(readProvider(id)?.defaultModel).toBeNull();
    }
  });

  it("leaves a model the user pinned themselves alone", async () => {
    createProvider(db, { id: PROVIDER_IDS.claude, defaultModel: "opus[1m]" });

    await run(db);

    expect(readProvider(PROVIDER_IDS.claude)?.defaultModel).toBe("opus[1m]");
  });

  it("backfills effort defaults for Claude and Codex only", async () => {
    createProvider(db, { id: PROVIDER_IDS.claude, config: JSON.stringify({ timeout: 1 }) });
    createProvider(db, { id: PROVIDER_IDS.codex, config: JSON.stringify({ timeout: 1 }) });
    createProvider(db, { id: PROVIDER_IDS.cursor, config: JSON.stringify({ timeout: 1 }) });
    createProvider(db, { id: PROVIDER_IDS.copilot, config: JSON.stringify({ timeout: 1 }) });

    await run(db);

    expect(readConfig(PROVIDER_IDS.claude)).toMatchObject({
      timeout: 1,
      thinkingMode: true,
      effortLevel: "medium",
    });
    expect(readConfig(PROVIDER_IDS.codex)).toMatchObject({
      timeout: 1,
      modelReasoningEffort: "medium",
    });
    // Both default to their "auto" model, which advertises no effort levels.
    expect(readConfig(PROVIDER_IDS.cursor)).toEqual({ timeout: 1 });
    expect(readConfig(PROVIDER_IDS.copilot)).toEqual({ timeout: 1 });
  });

  it("does not overwrite an effort the user already chose", async () => {
    createProvider(db, {
      id: PROVIDER_IDS.codex,
      config: JSON.stringify({ modelReasoningEffort: "xhigh" }),
    });

    await run(db);

    expect(readConfig(PROVIDER_IDS.codex).modelReasoningEffort).toBe("xhigh");
  });

  it("heals ultracode left on with thinking off", async () => {
    // The combination that made every Claude run fail with
    // "effort 'xhigh' is not supported when thinking is disabled".
    createProvider(db, {
      id: PROVIDER_IDS.claude,
      config: JSON.stringify({ ultracode: true, thinkingMode: false }),
    });

    await run(db);

    expect(readConfig(PROVIDER_IDS.claude)).toMatchObject({
      ultracode: true,
      thinkingMode: true,
    });
  });

  it("is idempotent and tolerates a null config", async () => {
    createProvider(db, { id: PROVIDER_IDS.claude, config: null });

    await run(db);
    const afterFirst = readConfig(PROVIDER_IDS.claude);
    await run(db);

    expect(afterFirst).toEqual({ thinkingMode: true, effortLevel: "medium" });
    expect(readConfig(PROVIDER_IDS.claude)).toEqual(afterFirst);
  });

  it("skips providers that are not installed", async () => {
    // A partially-seeded DB must not throw — only claude exists here.
    createProvider(db, { id: PROVIDER_IDS.claude, config: null });

    await expect(run(db)).resolves.toBeUndefined();
    expect(readProvider(PROVIDER_IDS.codex)).toBeUndefined();
  });
});

describe("claude provider seed", () => {
  it("starts a fresh install on the shared default permission mode", async () => {
    // The seed inserts with onConflictDoNothing, so this is a first-install
    // value only — changing it never overwrites a mode a user already picked.
    const { seedProviders } = await import("../data/providers");
    const { DEFAULT_CLAUDE_PERMISSION_MODE } = await import(
      "../../../shared/claude-permission-modes"
    );
    const { PROVIDER_IDS } = await import("../../../shared/provider-ids");

    const claude = seedProviders.find((p) => p.id === PROVIDER_IDS.claude);
    expect((claude?.config as { permissionMode?: string }).permissionMode).toBe(
      DEFAULT_CLAUDE_PERMISSION_MODE,
    );
  });
});
