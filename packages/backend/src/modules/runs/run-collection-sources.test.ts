import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import {
  createCollection,
  createRun,
} from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import { installTestBackendRuntime } from "../../../test/backend-runtime";

const TEST_USER_DATA = path.join(os.tmpdir(), "mains-run-source-context-test");

let db: DatabaseInstance;
let cleanup: () => void;

vi.mock("../../db/client", () => ({ getDb: () => db }));

import { collectionsService } from "../collections";
import { runsRepo } from "./runs.repo";
import { buildCollectionSourceInstructions } from "./run-collection-sources";

describe("buildCollectionSourceInstructions", () => {
  let restoreRuntime: () => void;

  beforeAll(() => {
    restoreRuntime = installTestBackendRuntime({
      getPath: (name) =>
        name === "userData" ? TEST_USER_DATA : path.join(TEST_USER_DATA, name),
    });
  });
  afterAll(() => restoreRuntime());

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    fs.rmSync(TEST_USER_DATA, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
    fs.rmSync(TEST_USER_DATA, { recursive: true, force: true });
  });

  it("references the canonical source without making run-local copies", async () => {
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
      name: "Research brief.txt",
      text: "Keep this reference stable.",
    });
    const execution = {
      workspaceId: null,
      cwd: path.join(TEST_USER_DATA, "runs", "run-1", "work"),
    };

    const first = await buildCollectionSourceInstructions({
      runId: "run-1",
      accountId: "default",
      collectionId: "collection-1",
      cwd: execution.cwd,
    });
    await buildCollectionSourceInstructions({
      runId: "run-1",
      accountId: "default",
      collectionId: "collection-1",
      cwd: execution.cwd,
    });

    const ledger = await runsRepo.findContextByRun("run-1");
    expect(ledger).toHaveLength(1);
    expect(first).not.toContain(ledger[0]!.ref);
    expect(ledger[0]!.ref).toContain(path.join("collections", "collection-1", "sources", source.id));
    expect(fs.readFileSync(ledger[0]!.ref!, "utf8")).toBe("Keep this reference stable.");
    expect(fs.statSync(ledger[0]!.ref!).mode & 0o222).toBe(0);
    expect(fs.existsSync(path.join(execution.cwd, "project-resources"))).toBe(false);
    expect(fs.existsSync(path.join(execution.cwd, ".mains", "runs", "run-1", "sources"))).toBe(false);
    const sourceLink = path.join(execution.cwd, "collection-sources");
    expect(fs.lstatSync(sourceLink).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(path.join(sourceLink, source.id, "content.txt")))
      .toBe(fs.realpathSync(ledger[0]!.ref!));
    expect(fs.readFileSync(path.join(sourceLink, source.id, "content.txt"), "utf8"))
      .toBe("Keep this reference stable.");
    expect(first).toContain(`./collection-sources/${source.id}/content.txt`);
    expect(ledger[0]?.metadata).toMatchObject({
      origin: "collection-source",
      collectionSourceId: source.id,
      sourceName: "Research brief.txt",
    });
  });

  it("keeps source identity in the ledger after a source is removed", async () => {
    createCollection(db, { id: "collection-1" });
    createRun(db, { id: "run-1", mode: "work", collectionId: "collection-1" });
    const source = await collectionsService.addSource({
      accountId: "default",
      collectionId: "collection-1",
      kind: "text",
      name: "Brief.txt",
      text: "Historical reference",
    });
    const execution = {
      workspaceId: null,
      cwd: path.join(TEST_USER_DATA, "runs", "run-1", "work"),
    };

    await buildCollectionSourceInstructions({
      runId: "run-1", accountId: "default", collectionId: "collection-1", cwd: execution.cwd,
    });
    await collectionsService.removeSource({ accountId: "default", id: source.id });
    const nextInstructions = await buildCollectionSourceInstructions({
      runId: "run-1", accountId: "default", collectionId: "collection-1", cwd: execution.cwd,
    });

    expect(nextInstructions).toBeNull();
    expect(fs.existsSync(path.join(execution.cwd, "project-resources"))).toBe(false);
    expect(fs.existsSync(path.join(execution.cwd, "collection-sources"))).toBe(false);
    const historical = await runsRepo.findContextByRun("run-1");
    expect(historical).toHaveLength(1);
    expect(historical[0]!.metadata?.sourceName).toBe("Brief.txt");
    expect(historical[0]!.contentHash).toBe(source.contentHash);
  });

  it("leaves old run-local copies for manual cleanup", async () => {
    createCollection(db, { id: "collection-1" });
    createRun(db, { id: "run-1", mode: "work", collectionId: "collection-1" });
    const source = await collectionsService.addSource({
      accountId: "default",
      collectionId: "collection-1",
      kind: "text",
      name: "Shared CV.txt",
      text: "One canonical file",
    });
    const canonicalPath = (await collectionsService.getSourceMaterials({
      accountId: "default", collectionId: "collection-1",
    }))[0]!.absolutePath;
    const execution = {
      workspaceId: null,
      cwd: path.join(TEST_USER_DATA, "runs", "run-1", "work"),
    };
    const hiddenCopy = path.join(execution.cwd, ".mains", "runs", "run-1", "sources", source.id, "Shared CV.txt");
    const visibleCopy = path.join(execution.cwd, "project-resources", source.id, "Shared CV.txt");
    fs.mkdirSync(path.dirname(hiddenCopy), { recursive: true });
    fs.mkdirSync(path.dirname(visibleCopy), { recursive: true });
    fs.copyFileSync(canonicalPath, hiddenCopy);
    fs.copyFileSync(canonicalPath, visibleCopy);
    await runsRepo.insertContext({
      runId: "run-1",
      kind: "file",
      ref: hiddenCopy,
      contentHash: source.contentHash,
      metadata: {
        origin: "collection-source",
        collectionId: "collection-1",
        collectionSourceId: source.id,
      },
    });

    const instructions = await buildCollectionSourceInstructions({
      runId: "run-1", accountId: "default", collectionId: "collection-1", cwd: execution.cwd,
    });
    expect(instructions).toContain(`./collection-sources/${source.id}/content.txt`);
    expect(fs.existsSync(hiddenCopy)).toBe(true);
    expect(fs.existsSync(visibleCopy)).toBe(true);
    const ledger = await runsRepo.findContextByRun("run-1");
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.ref).toBe(hiddenCopy);
    expect(fs.readFileSync(canonicalPath, "utf8")).toBe("One canonical file");
  });

  it("switches the visible source directory when Collection membership changes", async () => {
    createCollection(db, { id: "collection-1" });
    createCollection(db, { id: "collection-2" });
    createRun(db, { id: "run-1", mode: "work", collectionId: "collection-1" });
    const firstSource = await collectionsService.addSource({
      accountId: "default", collectionId: "collection-1", kind: "text",
      name: "First.txt", text: "First Collection",
    });
    const secondSource = await collectionsService.addSource({
      accountId: "default", collectionId: "collection-2", kind: "text",
      name: "Second.txt", text: "Second Collection",
    });
    const cwd = path.join(TEST_USER_DATA, "runs", "run-1", "work");
    const link = path.join(cwd, "collection-sources");

    await buildCollectionSourceInstructions({
      runId: "run-1", accountId: "default", collectionId: "collection-1", cwd,
    });
    expect(fs.readFileSync(path.join(link, firstSource.id, "content.txt"), "utf8"))
      .toBe("First Collection");

    await buildCollectionSourceInstructions({
      runId: "run-1", accountId: "default", collectionId: "collection-2", cwd,
    });
    expect(fs.existsSync(path.join(link, firstSource.id))).toBe(false);
    expect(fs.readFileSync(path.join(link, secondSource.id, "content.txt"), "utf8"))
      .toBe("Second Collection");

    await buildCollectionSourceInstructions({
      runId: "run-1", accountId: "default", collectionId: null, cwd,
    });
    expect(fs.existsSync(link)).toBe(false);
    expect(fs.existsSync(path.join(TEST_USER_DATA, "collections", "collection-1", "sources", firstSource.id))).toBe(true);
  });

  it("uses the canonical path for a historical workspace-backed run", async () => {
    createCollection(db, { id: "collection-1" });
    createRun(db, { id: "run-1", mode: "work", collectionId: "collection-1" });
    const source = await collectionsService.addSource({
      accountId: "default", collectionId: "collection-1", kind: "text",
      name: "Legacy.txt", text: "Reference",
    });
    const instructions = await buildCollectionSourceInstructions({
      runId: "run-1", accountId: "default", collectionId: "collection-1", cwd: null,
    });
    const canonicalPath = (await collectionsService.getSourceMaterials({
      accountId: "default", collectionId: "collection-1",
    }))[0]!.absolutePath;

    expect(instructions).toContain(canonicalPath);
    expect(instructions).not.toContain(`./collection-sources/${source.id}`);
    expect(fs.existsSync(path.join(TEST_USER_DATA, "runs", "run-1"))).toBe(false);
  });
});
