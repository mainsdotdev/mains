import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createCollection, createRun } from "../../../test/factories";
import { installTestBackendRuntime } from "../../../test/backend-runtime";
import type { DatabaseInstance } from "../../db/types";

const TEST_USER_DATA = path.join(os.tmpdir(), "mains-file-explorer-collection-test");
let db: DatabaseInstance;
let cleanup: () => void;

vi.mock("../../db/client", () => ({ getDb: () => db }));

import { collectionsService } from "../collections";
import { imageProxyService, serveLocalDocument } from "../imageProxy";
import { buildCollectionSourceInstructions } from "../runs/run-collection-sources";
import { fileExplorerService } from "./fileExplorer.service";

describe("Collection source file opening", () => {
  let restoreRuntime: () => void;

  beforeAll(() => {
    restoreRuntime = installTestBackendRuntime({
      getPath: (name) => name === "userData" ? TEST_USER_DATA : path.join(TEST_USER_DATA, name),
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

  it("opens a registered source through the run link without allowing edits", async () => {
    createCollection(db, { id: "collection-1" });
    createRun(db, { id: "run-1", mode: "work", collectionId: "collection-1" });
    const source = await collectionsService.addSource({
      accountId: "default", collectionId: "collection-1", kind: "text",
      name: "Brief.md", text: "# Collection reference",
    });
    const cwd = path.join(TEST_USER_DATA, "runs", "run-1", "work");
    await buildCollectionSourceInstructions({
      runId: "run-1", accountId: "default", collectionId: "collection-1", cwd,
    });
    const linkedPath = path.join(cwd, "collection-sources", source.id, "content.md");
    const canonicalPath = (await collectionsService.getSourceMaterials({
      accountId: "default", collectionId: "collection-1",
    }))[0]!.absolutePath;

    await expect(fileExplorerService.getPathInfo(linkedPath)).resolves.toMatchObject({
      exists: true, isFile: true,
    });
    await expect(fileExplorerService.readFileText({ filePath: linkedPath }))
      .resolves.toMatchObject({ content: "# Collection reference" });
    await expect(fileExplorerService.getPathInfo(canonicalPath)).resolves.toMatchObject({
      exists: true, isFile: true,
    });

    const copyPath = path.join(TEST_USER_DATA, "copy.md");
    await fileExplorerService.saveFileAs(linkedPath, copyPath);
    expect(fs.readFileSync(copyPath, "utf8")).toBe("# Collection reference");
    await expect(fileExplorerService.writeFileText({
      filePath: linkedPath, content: "changed",
    })).rejects.toThrow("Path is outside your workspaces");
    expect(fs.readFileSync(canonicalPath, "utf8")).toBe("# Collection reference");
  });

  it("does not expose an unregistered file beside a Collection source", async () => {
    createCollection(db, { id: "collection-1" });
    await collectionsService.addSource({
      accountId: "default", collectionId: "collection-1", kind: "text",
      name: "Brief.md", text: "Reference",
    });
    const canonicalPath = (await collectionsService.getSourceMaterials({
      accountId: "default", collectionId: "collection-1",
    }))[0]!.absolutePath;
    const extraPath = path.join(path.dirname(canonicalPath), "other.md");
    fs.writeFileSync(extraPath, "Not registered");

    await expect(fileExplorerService.getPathInfo(extraPath))
      .rejects.toThrow("Path is outside your workspaces");
  });

  it("serves a linked PDF to the document viewer", async () => {
    createCollection(db, { id: "collection-1" });
    createRun(db, { id: "run-1", mode: "work", collectionId: "collection-1" });
    const pdf = Buffer.from("%PDF-1.7\nCollection test\n");
    const source = await collectionsService.addSource({
      accountId: "default", collectionId: "collection-1", kind: "file",
      name: "Blueprint.pdf", mimeType: "application/pdf", data: pdf.toString("base64"),
    });
    const cwd = path.join(TEST_USER_DATA, "runs", "run-1", "work");
    await buildCollectionSourceInstructions({
      runId: "run-1", accountId: "default", collectionId: "collection-1", cwd,
    });
    const linkedPath = path.join(cwd, "collection-sources", source.id, "content.pdf");

    await expect(fileExplorerService.getPathInfo(linkedPath)).resolves.toMatchObject({
      exists: true, isFile: true,
    });
    const signed = imageProxyService.signLocalDocumentUrl(linkedPath);
    expect(signed).not.toBeNull();
    const response = await serveLocalDocument(new URL(signed!));
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf);
  });
});
