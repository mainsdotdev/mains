import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createRun } from "../../../test/factories";
import { installTestBackendRuntime } from "../../../test/backend-runtime";
import type { DatabaseInstance } from "../../db/types";
import { runs } from "../../db/schema";

let db: DatabaseInstance;
let directory: string;
let cleanup: () => void;
let restoreRuntime: () => void;

vi.mock("../../db/client", () => ({ getDb: () => db }));

import { imageProxyService, serveLocalDocument } from "../imageProxy";
import { runsService } from "../runs";
import { prepareRunAttachments } from "../runs/run-attachment-storage";
import { runsRepo } from "../runs/runs.repo";
import { fileExplorerService } from "./fileExplorer.service";

beforeEach(async () => {
  ({ db, cleanup } = createTestDb());
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mains-attachment-open-")));
  restoreRuntime = installTestBackendRuntime({ getPath: () => directory });
});

afterEach(async () => {
  restoreRuntime();
  cleanup();
  await fs.rm(directory, { recursive: true, force: true });
});

async function attach(name: string, content: string, mimeType: string) {
  const run = createRun(db, { mode: "work" });
  const [attachment] = (await prepareRunAttachments(run.id, [{
    name, type: "document", mimeType, data: Buffer.from(content).toString("base64"),
  }]))!;
  const filePath = await runsService.resolveAttachmentPath({
    runId: run.id, attachmentId: attachment.attachmentId,
  });
  return { run, attachment, filePath };
}

describe("Opening durable prompt attachments", () => {
  it("opens an uploaded PDF through the Sources path check and document preview", async () => {
    const pdf = "%PDF-1.7\nAttachment preview\n";
    const { filePath } = await attach("CV.pdf", pdf, "application/pdf");

    await expect(fileExplorerService.getPathInfo(filePath)).resolves.toEqual({
      exists: true, isFile: true, isDirectory: false,
    });
    const signed = imageProxyService.signLocalDocumentUrl(filePath);
    expect(signed).not.toBeNull();
    const response = await serveLocalDocument(new URL(signed!));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(pdf);

    const copy = path.join(directory, "CV-copy.pdf");
    await fileExplorerService.saveFileAs(filePath, copy);
    expect(await fs.readFile(copy, "utf8")).toBe(pdf);
  });

  it.each(["notes.txt", "Özgeçmiş.txt", "Özgeçmiş.txt".normalize("NFD")])("reads attached text document %s without granting edit access to originals", async (name) => {
    const { filePath } = await attach(name, "Attached notes", "text/plain");

    await expect(fileExplorerService.readFileText({ filePath }))
      .resolves.toMatchObject({ content: "Attached notes" });
    await expect(fileExplorerService.writeFileText({ filePath, content: "changed" }))
      .rejects.toThrow("Path is outside your workspaces");
    expect(await fs.readFile(filePath, "utf8")).toBe("Attached notes");
  });

  it("rejects unregistered files beside an attachment and symlink escapes", async () => {
    const { filePath } = await attach("notes.txt", "Attached notes", "text/plain");
    const extra = path.join(path.dirname(filePath), "other.txt");
    await fs.writeFile(extra, "Unregistered");
    await expect(fileExplorerService.getPathInfo(extra))
      .rejects.toThrow("Path is outside your workspaces");

    await fs.unlink(filePath);
    await fs.symlink(extra, filePath);
    await expect(fileExplorerService.getPathInfo(filePath))
      .rejects.toThrow("Path is outside your workspaces");
  });

  it("keeps archived and fork-retained originals readable until the last run releases them", async () => {
    const { run, attachment, filePath } = await attach("notes.txt", "Attached notes", "text/plain");
    db.update(runs).set({ isArchived: true }).where(eq(runs.id, run.id)).run();
    await expect(fileExplorerService.getPathInfo(filePath)).resolves.toMatchObject({ isFile: true });

    const fork = createRun(db, { mode: "work" });
    runsRepo.inheritAttachmentRefs(run.id, fork.id);
    db.delete(runs).where(eq(runs.id, run.id)).run();
    expect(await runsService.resolveAttachmentPath({ runId: fork.id, attachmentId: attachment.attachmentId })).toBe(filePath);
    await expect(fileExplorerService.getPathInfo(filePath)).resolves.toMatchObject({ isFile: true });

    db.delete(runs).where(eq(runs.id, fork.id)).run();
    await expect(fileExplorerService.getPathInfo(filePath))
      .rejects.toThrow("Path is outside your workspaces");
  });
});
