import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestDb } from "../../../test/setup-db";
import {
  createAccount,
  createCollection,
  createRun,
} from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";

let db: DatabaseInstance;
let cleanup: () => void;

const TEST_USER_DATA = path.join(os.tmpdir(), "mains-collection-sources-test");

vi.mock("electron", () => ({
  app: { getPath: () => TEST_USER_DATA },
}));

vi.mock("../../db/client", () => ({ getDb: () => db }));

import { collectionsService } from "./collections.service";
import { collectionsRepo } from "./collections.repo";
import { runsRepo } from "../runs/runs.repo";

describe("collectionsService", () => {
  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    createAccount(db, { id: "default" });
  });

  afterEach(() => {
    cleanup();
    fs.rmSync(TEST_USER_DATA, { recursive: true, force: true });
  });

  it("creates and lists account-scoped Collections shared by Work and Chat", async () => {
    await collectionsService.create({
      id: "work-a",
      accountId: "default",
      name: "Research",
    });
    await collectionsService.create({
      id: "chat-a",
      accountId: "default",
      name: "Personal",
    });
    createAccount(db, { id: "other" });
    await collectionsService.create({
      id: "other-a",
      accountId: "other",
      name: "Private",
    });

    const shared = await collectionsService.list({ accountId: "default" });

    expect(shared.map((collection) => collection.id).sort()).toEqual([
      "chat-a",
      "work-a",
    ]);
    expect(shared.every((collection) => !("mode" in collection))).toBe(true);
  });

  it("hides archived Collections unless requested", async () => {
    createCollection(db, { id: "archived", isArchived: true });

    await expect(
      collectionsService.list({ accountId: "default" }),
    ).resolves.toEqual([]);
    await expect(
      collectionsService.list({
        accountId: "default",
        includeArchived: true,
      }),
    ).resolves.toHaveLength(1);
  });

  it("reads and mutates an owned Collection through the account-scoped identity", async () => {
    createCollection(db, { id: "collection-1", name: "Draft" });
    const identity = { id: "collection-1", accountId: "default" };

    await expect(collectionsService.get(identity)).resolves.toMatchObject({
      name: "Draft",
      isArchived: false,
    });
    await expect(
      collectionsService.update(identity, { name: "Published" }),
    ).resolves.toMatchObject({ name: "Published" });
    await expect(collectionsService.archive(identity)).resolves.toMatchObject({
      isArchived: true,
    });
    await expect(
      collectionsService.unarchive(identity),
    ).resolves.toMatchObject({ isArchived: false });
    await expect(
      collectionsService.get({ id: "missing", accountId: "default" }),
    ).resolves.toBeNull();
  });

  it("removing a Collection detaches and preserves its runs", async () => {
    createCollection(db, { id: "collection-1" });
    createRun(db, {
      id: "run-1",
      mode: "work",
      collectionId: "collection-1",
    });

    await collectionsService.remove({
      id: "collection-1",
      accountId: "default",
    });

    const run = await runsRepo.findRunById("run-1");
    expect(run?.collectionId).toBeNull();
  });

  it("stores, lists, deduplicates, and removes canonical text Sources", async () => {
    createCollection(db, { id: "collection-1" });

    const first = await collectionsService.addSource({
      accountId: "default",
      collectionId: "collection-1",
      kind: "text",
      name: "Brief",
      text: "A durable piece of context",
    });
    const duplicate = await collectionsService.addSource({
      accountId: "default",
      collectionId: "collection-1",
      kind: "text",
      name: "Duplicate",
      text: "A durable piece of context",
    });

    expect(duplicate.id).toBe(first.id);
    await expect(
      collectionsService.listSources({
        accountId: "default",
        collectionId: "collection-1",
      }),
    ).resolves.toEqual([first]);
    expect(
      fs.readFileSync(
        path.join(
          TEST_USER_DATA,
          "collections",
          "collection-1",
          "sources",
          first.id,
          "content",
        ),
        "utf8",
      ),
    ).toBe("A durable piece of context");

    await collectionsService.removeSource({
      accountId: "default",
      id: first.id,
    });
    expect(
      fs.existsSync(
        path.join(
          TEST_USER_DATA,
          "collections",
          "collection-1",
          "sources",
          first.id,
        ),
      ),
    ).toBe(false);
  });

  it("rejects Source access from another account", async () => {
    createCollection(db, { id: "collection-1", accountId: "default" });
    createAccount(db, { id: "other" });

    await expect(
      collectionsService.listSources({
        accountId: "other",
        collectionId: "collection-1",
      }),
    ).rejects.toThrow("does not belong");
  });

  it("rejects parent access from another account without changing rows or storage", async () => {
    createAccount(db, { id: "other" });
    createCollection(db, {
      id: "private-collection",
      accountId: "other",
      name: "Private",
    });
    createRun(db, {
      id: "private-run",
      accountId: "other",
      mode: "work",
      collectionId: "private-collection",
    });
    const source = await collectionsService.addSource({
      accountId: "other",
      collectionId: "private-collection",
      kind: "text",
      name: "Secret",
      text: "private context",
    });
    const identity = {
      id: "private-collection",
      accountId: "default",
    };

    for (const attempt of [
      () => collectionsService.get(identity),
      () => collectionsService.update(identity, { name: "Taken over" }),
      () => collectionsService.archive(identity),
      () => collectionsService.unarchive(identity),
      () => collectionsService.remove(identity),
    ]) {
      await expect(attempt()).rejects.toThrow("does not belong");
    }

    await expect(
      collectionsRepo.findById("private-collection"),
    ).resolves.toMatchObject({ name: "Private", isArchived: false });
    await expect(runsRepo.findRunById("private-run")).resolves.toMatchObject({
      collectionId: "private-collection",
    });
    expect(
      fs.existsSync(
        path.join(
          TEST_USER_DATA,
          "collections",
          "private-collection",
          "sources",
          source.id,
        ),
      ),
    ).toBe(true);
  });

  it("also scopes parent mutations by account at the repository seam", async () => {
    createAccount(db, { id: "other" });
    createCollection(db, {
      id: "private-collection",
      accountId: "other",
      name: "Private",
    });

    await expect(
      collectionsRepo.update("private-collection", "default", {
        name: "Taken over",
      }),
    ).resolves.toBeNull();
    await expect(
      collectionsRepo.setArchived("private-collection", "default", true),
    ).resolves.toBeNull();
    await expect(
      collectionsRepo.remove("private-collection", "default"),
    ).resolves.toBe(false);
    await expect(
      collectionsRepo.findById("private-collection"),
    ).resolves.toMatchObject({ name: "Private", isArchived: false });
  });

  it("removes the exact managed Collection directory with the Collection", async () => {
    createCollection(db, { id: "collection-1" });
    await collectionsService.addSource({
      accountId: "default",
      collectionId: "collection-1",
      kind: "file",
      name: "notes.txt",
      mimeType: "text/plain",
      data: Buffer.from("notes").toString("base64"),
    });

    await collectionsService.remove({
      id: "collection-1",
      accountId: "default",
    });

    expect(
      fs.existsSync(path.join(TEST_USER_DATA, "collections", "collection-1")),
    ).toBe(false);
  });
});
