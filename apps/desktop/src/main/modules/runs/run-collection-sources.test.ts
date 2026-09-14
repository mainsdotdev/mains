import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import {
  createCollection,
  createRun,
} from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";

const TEST_USER_DATA = path.join(os.tmpdir(), "mains-run-source-context-test");

vi.mock("electron", () => ({
  app: { getPath: () => TEST_USER_DATA },
}));

let db: DatabaseInstance;
let cleanup: () => void;

vi.mock("../../db/client", () => ({ getDb: () => db }));

import { collectionsService } from "../collections";
import { runsRepo } from "./runs.repo";
import { materializeCollectionSourceContext } from "./run-collection-sources";

describe("materializeCollectionSourceContext", () => {
  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    fs.rmSync(TEST_USER_DATA, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
    fs.rmSync(TEST_USER_DATA, { recursive: true, force: true });
  });

  it("projects current Sources into the run tree and records one immutable ledger row", async () => {
    createCollection(db, { id: "collection-1" });
    createRun(db, {
      id: "run-1",
      mode: "work",
      collectionId: "collection-1",
    });
    const source = await collectionsService.addSource({
      accountId: "default",
      collectionId: "collection-1",
      kind: "text",
      name: "Research brief",
      text: "Keep this reference stable.",
    });
    const execution = {
      workspaceId: null,
      cwd: path.join(TEST_USER_DATA, "runs", "run-1", "work"),
    };

    const first = await materializeCollectionSourceContext({
      runId: "run-1",
      accountId: "default",
      collectionId: "collection-1",
      execution,
    });
    await materializeCollectionSourceContext({
      runId: "run-1",
      accountId: "default",
      collectionId: "collection-1",
      execution,
    });

    const projectedPath = path.join(
      execution.cwd,
      ".mains",
      "runs",
      "run-1",
      "sources",
      source.id,
      "Research brief",
    );
    expect(first[0]?.ref).toBe(projectedPath);
    expect(fs.readFileSync(projectedPath, "utf8")).toBe(
      "Keep this reference stable.",
    );
    const ledger = await runsRepo.findContextByRun("run-1");
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.metadata).toMatchObject({
      origin: "collection-source",
      collectionSourceId: source.id,
    });
  });
});
