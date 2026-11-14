import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import type { RunOutputFile } from "@mains/contracts/runs";
import { createTestDb } from "../../../test/setup-db";
import { createAccount, createRun, createRunArtifact, createToolCall } from "../../../test/factories";
import { installTestBackendRuntime } from "../../../test/backend-runtime";
import type { DatabaseInstance } from "../../db/types";
import { atlasItems, atlasPageRevisions, atlasTags, atlasItemTags, collections, runAttachmentRefs, runAttachments, runs } from "../../db/schema";
import { ownershipOf } from "../bridge/bridge.ownership";
import { HISTORY_CHECKPOINTS } from "./atlas.history";
import { atlasRepo } from "./atlas.repo";
import { sourceKey } from "./atlas.storage";

let db: DatabaseInstance;
let directory: string;
let cleanup: () => void;
let restoreRuntime: () => void;
const root = (id: string, mode = "work") => path.join(directory, "runs", id, mode);
const revisionRows = (pageId: string) => db.select().from(atlasPageRevisions).where(eq(atlasPageRevisions.itemId, pageId)).all();
// Another device's selected outputs, as the runs projection rebuilds them from synced manifests.
const replicaOutputs = new Map<string, unknown[]>();
vi.mock("../../db/client", () => ({ getDb: () => db }));
// Keep the integration focused on Atlas' real SQLite/storage boundary.
vi.mock("../runs", () => ({ runsService: {
  listOutputs: vi.fn(),
  readOutputFile: vi.fn(),
  describeAttachmentFile: vi.fn(),
  resolveAttachmentPath: vi.fn(),
  readAttachmentImage: vi.fn(),
  readArtifactImage: vi.fn(),
  getRunById: async (id: string) => {
    const run = db.select().from(runs).where(eq(runs.id, id)).get();
    return run ? { ...run, ...ownershipOf(run.ownerBackendId) } : null;
  },
  getRunExecutionRoot: async (id: string) => {
    const run = db.select().from(runs).where(eq(runs.id, id)).get();
    return root(id, run?.mode ?? "work");
  },
  listRunOutputFiles: vi.fn(async (_id: string): Promise<RunOutputFile[]> => []),
  getOutputArtifacts: async (id: string) => {
    if (replicaOutputs.has(id)) return replicaOutputs.get(id);
    const { runsRepo } = await import("../runs/runs.repo");
    const { projectRunDeliverables } = await import("../runs/run-deliverables");
    const run = await runsRepo.findRunById(id);
    if (!run) return [];
    return projectRunDeliverables({ runId: id, artifacts: await runsRepo.findArtifactsByRun(id),
      turns: await runsRepo.findTurnsByRun(id),
      terminal: run.status === "succeeded", root: root(id, run.mode),
      extraRoots: [path.join(directory, "generated-images", id),
        ...(run.sessionId ? [path.join(directory, ".codex", "generated_images", run.sessionId)] : [])] });
  },
  listRunAttachmentFiles: async (id: string) => {
    const { listRunAttachmentFiles } = await import("../runs/run-attachment-storage");
    return listRunAttachmentFiles(id);
  },
  listRunAttachmentRecords: (id: string) => listRunAttachmentRecords(id),
} }));
import { atlasService } from "./atlas.service";
import { atlasMobile } from "./atlas.mobile";
import { attachmentDescriptor, listRunAttachmentRecords, prepareRunAttachments, resolveRunAttachment } from "../runs/run-attachment-storage";
import { runsRepo } from "../runs/runs.repo";
import { insertRunInputArtifact } from "../runs/run-input-artifact";
import { ATLAS_COVER_PRESETS } from "@mains/contracts/atlas-covers";
import * as covers from "./atlas.covers";
import { bridgeService } from "../bridge";
import { handleAtlasCreatePage, handleAtlasListCovers, handleAtlasReadPage, handleAtlasUpdatePage } from "../providers/adapters/atlas-tools";

beforeEach(() => {
  ({ db, cleanup } = createTestDb());
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "mains-atlas-"));
  restoreRuntime = installTestBackendRuntime({ getPath: () => directory });
  createAccount(db);
});

describe("Atlas agent access", { timeout: 15000 }, () => {
  const context = (runId: string | null) => ({ runId, workspaceId: null, rootPath: null });
  it("derives ownership from the conversation and records agent revisions", async () => {
    createRun(db, { id: "work", mode: "work" });
    createAccount(db, { id: "other" });
    createRun(db, { id: "foreign", mode: "work", accountId: "other" });
    const created = await handleAtlasCreatePage({ title: "Agent notes", markdown: "Initial" }, context("work"));
    const page = JSON.parse(created.content[0].text);
    expect(page.item.accountId).toBe("default");
    expect(page.revision.actor).toBe("agent");
    expect(page.revision.sourceRunId).toBe("work");
    expect(page.pageHref).toBe(`/atlas/${page.item.id}`);
    await expect(handleAtlasReadPage({ pageId: page.item.id }, context("foreign"))).rejects.toThrow("Page not found");
    await expect(handleAtlasUpdatePage({ pageId: page.item.id, expectedVersion: 1, markdown: "Foreign" }, context("foreign"))).rejects.toThrow("Page not found");
    const updated = await handleAtlasUpdatePage({ pageId: page.item.id, expectedVersion: 1, markdown: "Updated" }, context("work"));
    expect(JSON.parse(updated.content[0].text).item.version).toBe(2);
    expect(JSON.parse(updated.content[0].text).pageHref).toBe(page.pageHref);
    await expect(handleAtlasUpdatePage({ pageId: page.item.id, expectedVersion: 1, markdown: "Stale" }, context("work"))).rejects.toThrow("changed elsewhere");
    expect(atlasService.getPage({ id: page.item.id, accountId: "default" })?.revision.markdown).toContain("Updated");
  });
  it("sets, changes and removes a Page icon without creating a revision", async () => {
    createRun(db, { id: "work", mode: "work" });
    const created = JSON.parse((await handleAtlasCreatePage({ title: "Reading list", markdown: "Books", icon: "📚" }, context("work"))).content[0].text);
    expect(created.item.metadata).toEqual({ icon: "emoji:📚" });
    expect(created.item.version).toBe(1);
    const changed = JSON.parse((await handleAtlasUpdatePage({ pageId: created.item.id, expectedVersion: 1, icon: "🧠" }, context("work"))).content[0].text);
    expect(changed.item.metadata).toEqual({ icon: "emoji:🧠" });
    expect(changed.item.version).toBe(1);
    const both = JSON.parse((await handleAtlasUpdatePage({ pageId: created.item.id, expectedVersion: 1, markdown: "More books", icon: "emoji:🔖" }, context("work"))).content[0].text);
    expect(both.item.version).toBe(2);
    expect(both.item.metadata).toEqual({ icon: "emoji:🔖" });
    const removed = JSON.parse((await handleAtlasUpdatePage({ pageId: created.item.id, expectedVersion: 2, icon: null }, context("work"))).content[0].text);
    expect(removed.item.metadata).toBeNull();
    await expect(handleAtlasUpdatePage({ pageId: created.item.id, expectedVersion: 2 }, context("work"))).rejects.toThrow("Supply");
    await expect(handleAtlasUpdatePage({ pageId: created.item.id, expectedVersion: 2, title: "Renamed" }, context("work"))).rejects.toThrow("new title");
    await expect(handleAtlasUpdatePage({ pageId: created.item.id, expectedVersion: 2, icon: "x\u0000y" }, context("work"))).rejects.toThrow("Invalid Page icon");
  });
  it("sets a bundled cover once per account and shares it between Pages", async () => {
    createRun(db, { id: "work", mode: "work" });
    const first = JSON.parse((await handleAtlasCreatePage({ title: "Trip", markdown: "Plan", icon: "✈️", coverPreset: "ocean" }, context("work"))).content[0].text);
    const second = JSON.parse((await handleAtlasCreatePage({ title: "Dive log", markdown: "Notes", coverPreset: "ocean" }, context("work"))).content[0].text);
    expect(first.item.metadata.icon).toBe("emoji:✈️");
    expect(first.item.metadata.coverFileId).toBeTruthy();
    expect(second.item.metadata.coverFileId).toBe(first.item.metadata.coverFileId);
    expect(first.item.version).toBe(1);
    const cover = atlasService.list({ accountId: "default", kind: "image" });
    expect(cover).toHaveLength(1);
    expect(cover[0]).toMatchObject({ id: first.item.metadata.coverFileId, kind: "image", mimeType: "image/png", sourceKey: "cover-preset:ocean" });
    expect(fs.readFileSync(cover[0].path!).subarray(1, 4).toString()).toBe("PNG");
    // Changing the cover keeps the icon; removing it keeps the icon too.
    const changed = JSON.parse((await handleAtlasUpdatePage({ pageId: first.item.id, expectedVersion: 1, coverPreset: "citrus" }, context("work"))).content[0].text);
    expect(changed.item.metadata.icon).toBe("emoji:✈️");
    expect(changed.item.metadata.coverFileId).not.toBe(first.item.metadata.coverFileId);
    expect(changed.item.version).toBe(1);
    const removed = JSON.parse((await handleAtlasUpdatePage({ pageId: first.item.id, expectedVersion: 1, coverPreset: null }, context("work"))).content[0].text);
    expect(removed.item.metadata).toEqual({ icon: "emoji:✈️" });
    await expect(handleAtlasUpdatePage({ pageId: first.item.id, expectedVersion: 1, coverPreset: "nope" }, context("work"))).rejects.toThrow();
  });
  it("lists the bundled covers and rejects an unknown id before writing", async () => {
    createRun(db, { id: "work", mode: "work" });
    createRun(db, { id: "chat", mode: "chat" });
    const listed = (await handleAtlasListCovers({}, context("work"))).content[0].text;
    for (const cover of ATLAS_COVER_PRESETS) expect(listed).toContain(`${cover.id}: ${cover.description}`);
    await expect(handleAtlasListCovers({}, context("chat"))).rejects.toThrow("Work mode");
    await expect(handleAtlasCreatePage({ title: "Unknown cover", markdown: "Body", coverPreset: "nope" }, context("work"))).rejects.toThrow("AtlasListCovers");
    expect(atlasService.list({ accountId: "default" })).toEqual([]);
  });
  it("lets the gallery set a bundled cover directly, only on a live Page", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Gallery", markdown: "Body" });
    const item = await atlasService.setCoverPreset({ accountId: "default", id: page.item.id, preset: "forest" });
    expect(item.metadata?.coverFileId).toBeTruthy();
    expect(item.version).toBe(1);
    const again = await atlasService.setCoverPreset({ accountId: "default", id: page.item.id, preset: "forest" });
    expect(again.metadata?.coverFileId).toBe(item.metadata?.coverFileId);
    expect(atlasService.list({ accountId: "default", kind: "image" })).toHaveLength(1);
    await expect(atlasService.setCoverPreset({ accountId: "default", id: page.item.id, preset: "../forest" })).rejects.toThrow("Unknown cover");
    await atlasService.update({ accountId: "default", id: page.item.id, trashed: true });
    await expect(atlasService.setCoverPreset({ accountId: "default", id: page.item.id, preset: "dawn" })).rejects.toThrow("Page unavailable");
    await expect(atlasService.setCoverPreset({ accountId: "other", id: page.item.id, preset: "dawn" })).rejects.toThrow("not found");
  });
  it("saves a photo cover with its own file type", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Photo", markdown: "Body" });
    const item = await atlasService.setCoverPreset({ accountId: "default", id: page.item.id, preset: "nutmeg" });
    const cover = atlasService.list({ accountId: "default", kind: "image" }).find((image) => image.id === item.metadata?.coverFileId);
    expect(cover).toMatchObject({ mimeType: "image/jpeg", fileName: "nutmeg.jpg", sourceKey: "cover-preset:nutmeg" });
    expect(fs.readFileSync(cover!.path!).subarray(0, 3).toString("hex")).toBe("ffd8ff");
  });
  it("keeps bundled cover images out of the Atlas library", async () => {
    createRun(db, { id: "work", mode: "work" });
    await handleAtlasCreatePage({ title: "Covered", markdown: "Body", coverPreset: "aurora" }, context("work"));
    const library = await atlasService.library({ accountId: "default", type: "all", scope: "all" });
    expect(library.items.map((entry) => entry.title)).toEqual(["Covered"]);
    expect(atlasService.list({ accountId: "default", kind: "image" })).toHaveLength(1);
  });
  it("does not create a Page when its cover cannot be prepared", async () => {
    createRun(db, { id: "work", mode: "work" });
    vi.spyOn(covers, "readCoverPreset").mockRejectedValueOnce(new Error("Cover read failed"));
    await expect(handleAtlasCreatePage({ title: "Retry", markdown: "Body", icon: "📚", coverPreset: "ocean" }, context("work")))
      .rejects.toThrow("Cover read failed");
    expect(atlasService.list({ accountId: "default", kind: "page" })).toEqual([]);
    await handleAtlasCreatePage({ title: "Retry", markdown: "Body", icon: "📚", coverPreset: "ocean" }, context("work"));
    expect(atlasService.list({ accountId: "default", kind: "page" })).toHaveLength(1);
  });
  it("preserves content, icon and version after a cover failure so the same update can be retried", async () => {
    createRun(db, { id: "work", mode: "work" });
    const page = await atlasService.createPage({ accountId: "default", title: "Original", markdown: "Old" });
    const before = atlasService.getPage({ accountId: "default", id: page.item.id });
    vi.spyOn(covers, "readCoverPreset").mockRejectedValueOnce(new Error("Cover read failed"));
    const input = { pageId: page.item.id, expectedVersion: 1, title: "Changed", markdown: "New", icon: "📚", coverPreset: "ocean" };
    await expect(handleAtlasUpdatePage(input, context("work"))).rejects.toThrow("Cover read failed");
    expect(atlasService.getPage({ accountId: "default", id: page.item.id })).toEqual(before);
    expect(atlasService.revisions({ accountId: "default", id: page.item.id })).toHaveLength(1);
    const saved = JSON.parse((await handleAtlasUpdatePage(input, context("work"))).content[0].text);
    expect(saved.item).toMatchObject({ version: 2, title: "Changed", metadata: { icon: "emoji:📚" } });
    expect(saved.revision.markdown).toContain("New");
  });
  it("does not change an icon when a presentation-only cover change fails", async () => {
    createRun(db, { id: "work", mode: "work" });
    const page = await atlasService.createPage({ accountId: "default", title: "Original", markdown: "Old" });
    vi.spyOn(covers, "readCoverPreset").mockRejectedValueOnce(new Error("Cover read failed"));
    await expect(handleAtlasUpdatePage({ pageId: page.item.id, expectedVersion: 1, icon: "📚", coverPreset: "ocean" }, context("work")))
      .rejects.toThrow("Cover read failed");
    expect(atlasService.getPage({ accountId: "default", id: page.item.id })?.item.metadata).toBeNull();
  });
  it.each([false, true])("restores a missing preset file locally (missing directory: %s)", async (removeDirectory) => {
    const page = await atlasService.createPage({ accountId: "default", title: "Offline", markdown: "Body" });
    await atlasService.setCoverPreset({ accountId: "default", id: page.item.id, preset: "ocean" });
    const image = atlasService.list({ accountId: "default", kind: "image" })[0];
    const bytes = fs.readFileSync(image.path!);
    if (removeDirectory) fs.rmSync(path.dirname(image.path!), { recursive: true, force: true });
    else fs.rmSync(image.path!, { force: true });
    await atlasService.setCoverPreset({ accountId: "default", id: page.item.id, preset: "ocean" });
    expect(atlasService.list({ accountId: "default", kind: "image" })).toHaveLength(1);
    expect(await atlasService.resolveFile({ accountId: "default", id: image.id })).toBe(image.path);
    expect(fs.readFileSync(image.path!)).toEqual(bytes);
  });
  it.each(["create", "update"])("rolls back the Page and revision if its presentation write fails (%s)", async (operation) => {
    createRun(db, { id: "work", mode: "work" });
    const page = await atlasService.createPage({ accountId: "default", title: "Original", markdown: "Old" });
    const before = atlasService.getPage({ accountId: "default", id: page.item.id });
    db.run(sql`CREATE TRIGGER reject_page_metadata BEFORE UPDATE OF metadata ON atlas_items
      BEGIN SELECT RAISE(ABORT, 'Presentation write failed'); END`);
    const action = operation === "create"
      ? handleAtlasCreatePage({ title: "New", markdown: "New", icon: "📚" }, context("work"))
      : handleAtlasUpdatePage({ pageId: page.item.id, expectedVersion: 1, markdown: "New", icon: "📚" }, context("work"));
    await expect(action).rejects.toThrow("Presentation write failed");
    expect(atlasService.list({ accountId: "default", kind: "page" })).toHaveLength(1);
    expect(atlasService.getPage({ accountId: "default", id: page.item.id })).toEqual(before);
    expect(atlasService.revisions({ accountId: "default", id: page.item.id })).toHaveLength(1);
    expect(db.select().from(atlasPageRevisions).all()).toHaveLength(1);
  });
  it("saves presentation even when the supplied Page content has not changed", async () => {
    createRun(db, { id: "work", mode: "work" });
    const page = await atlasService.createPage({ accountId: "default", title: "Original", markdown: "Body" });
    const saved = JSON.parse((await handleAtlasUpdatePage({ pageId: page.item.id, expectedVersion: 1,
      blocksJson: JSON.stringify(page.revision.blocks), icon: "📚", coverPreset: "ocean" }, context("work"))).content[0].text);
    expect(saved.item).toMatchObject({ version: 1, metadata: { icon: "emoji:📚" } });
    expect(saved.item.metadata.coverFileId).toBeTruthy();
    expect(atlasService.revisions({ accountId: "default", id: page.item.id })).toHaveLength(1);
  });
  it("never restores a different bundled image under a saved cover's immutable identity", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Offline", markdown: "Body" });
    await atlasService.setCoverPreset({ accountId: "default", id: page.item.id, preset: "ocean" });
    const image = atlasService.list({ accountId: "default", kind: "image" })[0];
    fs.rmSync(image.path!, { force: true });
    vi.spyOn(covers, "readCoverPreset").mockResolvedValueOnce(Buffer.from("different bundled image"));
    const download = vi.spyOn(bridgeService, "resolveFile").mockRejectedValueOnce(new Error("Offline"));
    await expect(atlasService.setCoverPreset({ accountId: "default", id: page.item.id, preset: "ocean" })).rejects.toThrow("Offline");
    expect(download).toHaveBeenCalledWith("atlas_items", image.id, "storage_key");
    expect(fs.existsSync(image.path!)).toBe(false);
    expect(atlasService.list({ accountId: "default", kind: "image" })).toEqual([image]);
  });
  it("does not restore a cover through a symlinked storage directory", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Safe", markdown: "Body" });
    await atlasService.setCoverPreset({ accountId: "default", id: page.item.id, preset: "ocean" });
    const image = atlasService.list({ accountId: "default", kind: "image" })[0];
    fs.rmSync(path.dirname(image.path!), { recursive: true, force: true });
    const outside = path.join(directory, "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.dirname(image.path!), "junction");
    await expect(atlasService.setCoverPreset({ accountId: "default", id: page.item.id, preset: "ocean" }))
      .rejects.toThrow("Invalid Atlas storage directory");
    expect(fs.readdirSync(outside)).toEqual([]);
  });
  it("rejects an invalid icon before creating the Page", async () => {
    createRun(db, { id: "work", mode: "work" });
    await expect(handleAtlasCreatePage({ title: "Bad icon", markdown: "Body", icon: "a\u0000b" }, context("work"))).rejects.toThrow("Invalid Page icon");
    expect(atlasService.list({ accountId: "default", kind: "page" })).toEqual([]);
  });
  it("keeps Chat read-only even if its handler is invoked directly", async () => {
    createRun(db, { id: "chat", mode: "chat" });
    createRun(db, { id: "developer", mode: "developer" });
    const page = await atlasService.createPage({ accountId: "default", title: "Readable notes", markdown: "Read me" });
    const read = await handleAtlasReadPage({ pageId: page.item.id }, context("chat"));
    expect(JSON.parse(read.content[0].text).revision.markdown).toContain("Read me");
    expect(JSON.parse(read.content[0].text).pageHref).toBe(`/atlas/${page.item.id}`);
    for (const runId of ["chat", "developer"]) {
      await expect(handleAtlasCreatePage({ title: "Write", markdown: "Disallowed" }, context(runId))).rejects.toThrow("Work mode");
      await expect(handleAtlasUpdatePage({ pageId: page.item.id, expectedVersion: 1, markdown: "Disallowed" }, context(runId))).rejects.toThrow("Work mode");
    }
    await expect(handleAtlasReadPage({ pageId: page.item.id }, context(null))).rejects.toThrow("active conversation");
    expect(atlasService.getPage({ id: page.item.id, accountId: "default" })?.item.version).toBe(1);
  });
});
afterEach(() => { cleanup(); restoreRuntime(); vi.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });

function output(name = "report.pdf", runId = "conversation", mode: "work" | "developer" | "chat" = "work") {
  createRun(db, { id: runId, mode, title: "Research", status: "succeeded" });
  fs.mkdirSync(root(runId, mode), { recursive: true });
  const file = path.join(root(runId, mode), name);
  fs.writeFileSync(file, "original contents");
  createRunArtifact(db, { runId, kind: name.endsWith(".png") ? "image" : "document",
    metadata: JSON.stringify({ path: file }) });
  createRunArtifact(db, { runId, kind: "report", content: `[Output](<${file}>)` });
  return file;
}
describe("Atlas phone library", { timeout: 15000 }, () => {
  it("keeps embedded Page image references between the surrounding text in phone Markdown", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Visual notes" });
    const image = await atlasService.uploadFile({ accountId: "default", pageId: page.item.id,
      fileName: "Screenshot.png", data: Buffer.from("prepared image").toString("base64") });
    await atlasService.savePage({ accountId: "default", id: page.item.id, expectedVersion: 1, title: "Visual notes", blocks: [
      { type: "paragraph", content: "Before the picture" },
      { type: "image", props: { url: `atlas-file://${image.id}`, name: "Screenshot.png" } },
      { type: "paragraph", content: "After the picture" },
    ] });
    const result = atlasMobile.readPage({ accountId: "default", id: page.item.id });
    expect(result.markdown).toContain(`atlas-file://${image.id}`);
    expect(result.markdown).toMatch(/!\[[^\]]*\]\(/);
    expect(result.markdown.indexOf("Before the picture")).toBeLessThan(result.markdown.indexOf(`atlas-file://${image.id}`));
    expect(result.markdown.indexOf("After the picture")).toBeGreaterThan(result.markdown.indexOf(`atlas-file://${image.id}`));
  });

  it("previews only a pinned Page's embedded image without sending paths or changing content", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Visual notes" });
    const image = await atlasService.uploadFile({ accountId: "default", pageId: page.item.id,
      fileName: "photo.png", data: Buffer.from("prepared image").toString("base64") });
    const saved = await atlasService.savePage({ accountId: "default", id: page.item.id, expectedVersion: 1, title: "Visual notes",
      blocks: [{ type: "paragraph", children: [{ type: "image", props: { url: `atlas-file://${image.id}`, name: "photo.png" } }] }] });
    const request = { accountId: "default", id: page.item.id, fileId: image.id, version: saved.item.version };
    const resize = vi.fn(async () => ({ bytes: Buffer.from("preview"), mime: "image/png" as const, width: 768, height: 384 }));
    const reset = installTestBackendRuntime({ getPath: () => directory, imagePreview: { resize } });
    try {
      const result = await atlasMobile.readPageImage(request);
      expect(result).toMatchObject({ pageId: page.item.id, fileId: image.id, pageVersion: saved.item.version, width: 768, height: 384 });
      expect(resize).toHaveBeenCalledWith(expect.any(Buffer), 768, true);
      expect(JSON.stringify(result)).not.toContain(directory);
      expect(atlasService.getPage({ accountId: "default", id: page.item.id })?.revision).toEqual(saved.revision);
      await expect(atlasMobile.readPageImage({ ...request, accountId: "foreign" })).rejects.toThrow("not found");
      await expect(atlasMobile.readPageImage({ ...request, version: 1 })).rejects.toThrow("changed");
      await expect(atlasMobile.readPageImage({ ...request, version: 0 })).rejects.toThrow("Invalid Page version");
      const unrelated = await atlasService.createPage({ accountId: "default", title: "Other Page" });
      await expect(atlasMobile.readPageImage({ ...request, id: unrelated.item.id, version: 1 })).rejects.toThrow("not found in this Page");
    } finally { reset(); }
  });

  it.each(["page-changed", "page-trashed", "image-trashed", "file-changed"])(
    "rejects an embedded image that becomes %s while its preview loads", async condition => {
      const page = await atlasService.createPage({ accountId: "default", title: "Visual notes" });
      const image = await atlasService.uploadFile({ accountId: "default", pageId: page.item.id,
        fileName: "photo.png", data: Buffer.from("prepared image").toString("base64") });
      const saved = await atlasService.savePage({ accountId: "default", id: page.item.id, expectedVersion: 1, title: "Visual notes",
        blocks: [{ type: "image", props: { url: `atlas-file://${image.id}`, name: "photo.png" } }] });
      const reset = installTestBackendRuntime({ getPath: () => directory, imagePreview: { resize: async () => {
        if (condition === "page-changed") await atlasService.savePage({ accountId: "default", id: page.item.id,
          expectedVersion: saved.item.version, title: "Changed", markdown: "Image removed" });
        if (condition === "page-trashed") await atlasService.update({ accountId: "default", id: page.item.id, trashed: true });
        if (condition === "image-trashed") await atlasService.update({ accountId: "default", id: image.id, trashed: true });
        if (condition === "file-changed") fs.writeFileSync(image.path!, "changed while loading");
        return { bytes: Buffer.from("old preview"), mime: "image/png", width: 128, height: 96 };
      } } });
      try { await expect(atlasMobile.readPageImage({ accountId: "default", id: page.item.id, fileId: image.id, version: saved.item.version })).rejects.toThrow(); }
      finally { reset(); }
    },
  );

  it.each([[false, false], [false, true], [true, false], [true, true]])(
    "reads Page icon=%s and cover=%s independently without hydrating an image", async (icon, covered) => {
      const file = output("photo.png");
      const cover = await atlasService.saveFile({ accountId: "default", runId: "conversation", path: file });
      const page = await atlasService.createPage({ accountId: "default", title: "Workout", markdown: "Body",
        metadata: { icon: icon ? "icon:dumbbell|purple" : null, coverFileId: covered ? cover.id : null } });
      const resolve = vi.spyOn(atlasService, "resolveFile");
      const result = atlasMobile.readPage({ accountId: "default", id: page.item.id });
      expect(result).toMatchObject({ title: "Workout", icon: icon ? "icon:dumbbell|purple" : null,
        coverFileId: covered ? cover.id : null, version: 1 });
      expect(resolve).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(directory);
    },
  );

  it("reads only the Page's current cover, bounds its preview and retains ordinary thumbnail limits", async () => {
    const file = output("photo.png"), bytes = Buffer.from("prepared cover preview");
    const cover = await atlasService.saveFile({ accountId: "default", runId: "conversation", path: file });
    const page = await atlasService.createPage({ accountId: "default", title: "Cover", metadata: { coverFileId: cover.id } });
    const request = { accountId: "default", id: page.item.id, coverFileId: cover.id };
    const resize = vi.fn(async (_bytes: Buffer, maxSide: number) => ({ bytes, mime: "image/png" as const, width: maxSide, height: maxSide / 2 }));
    const reset = installTestBackendRuntime({ getPath: () => directory, imagePreview: { resize } });
    try {
      const image = await atlasMobile.readPageCover(request);
      expect(image).toMatchObject({ pageId: page.item.id, coverFileId: cover.id, width: 768, height: 384 });
      expect(resize).toHaveBeenCalledWith(expect.any(Buffer), 768, true);
      expect(Buffer.from(image.base64, "base64")).toEqual(bytes);
      expect(JSON.stringify(image)).not.toContain(directory);
      await expect(atlasMobile.readPageCover({ ...request, accountId: "other" })).rejects.toThrow("unavailable");
      await expect(atlasMobile.readPageCover({ ...request, coverFileId: "not-the-cover" })).rejects.toThrow("changed");
      expect((await atlasMobile.readImage({ accountId: "default", reference: { itemId: cover.id } })).width).toBe(128);
      await atlasService.update({ accountId: "default", id: cover.id, trashed: true });
      expect(atlasMobile.readPage({ accountId: "default", id: page.item.id }).coverFileId).toBeNull();
      await expect(atlasMobile.readPageCover(request)).rejects.toThrow("unavailable");
    } finally { reset(); }
  });

  it.each(["page-trashed", "cover-removed", "cover-trashed", "file-changed", "oversized", "dimensions"])(
    "refuses a cover that becomes %s during decoding", async (condition) => {
      const file = output("photo.png");
      const cover = await atlasService.saveFile({ accountId: "default", runId: "conversation", path: file });
      const page = await atlasService.createPage({ accountId: "default", title: "Cover", metadata: { coverFileId: cover.id } });
      const reset = installTestBackendRuntime({ getPath: () => directory, imagePreview: { resize: async () => {
        if (condition === "page-trashed") await atlasService.update({ accountId: "default", id: page.item.id, trashed: true });
        if (condition === "cover-removed") await atlasService.update({ accountId: "default", id: page.item.id, metadata: { coverFileId: null } });
        if (condition === "cover-trashed") await atlasService.update({ accountId: "default", id: cover.id, trashed: true });
        if (condition === "file-changed") fs.writeFileSync(cover.path!, "changed during decoding");
        return { bytes: condition === "oversized" ? Buffer.alloc(512 * 1024 + 1) : Buffer.from("preview"),
          mime: "image/png", width: condition === "dimensions" ? 769 : 128, height: 96 };
      } } });
      try { await expect(atlasMobile.readPageCover({ accountId: "default", id: page.item.id, coverFileId: cover.id })).rejects.toThrow(); }
      finally { reset(); }
    },
  );

  it("uses a smaller cover derivative when a transparent PNG exceeds the wire budget", async () => {
    const file = output("photo.png");
    const cover = await atlasService.saveFile({ accountId: "default", runId: "conversation", path: file });
    const page = await atlasService.createPage({ accountId: "default", title: "Cover", metadata: { coverFileId: cover.id } });
    const resize = vi.fn(async (_bytes: Buffer, maxSide: number) => ({ bytes: maxSide === 768 ? Buffer.alloc(512 * 1024 + 1) : Buffer.from("smaller preview"),
      mime: "image/png" as const, width: maxSide, height: maxSide }));
    const reset = installTestBackendRuntime({ getPath: () => directory, imagePreview: { resize } });
    try {
      const result = await atlasMobile.readPageCover({ accountId: "default", id: page.item.id, coverFileId: cover.id });
      expect(result.width).toBe(256);
      expect(resize.mock.calls.map(call => call[1])).toEqual([768, 256]);
    } finally { reset(); }
  });

  it("returns useful bounded display metadata without paths or embedded image hydration", async () => {
    output();
    const page = await atlasService.createPage({ accountId: "default", title: "Brief", markdown: "😀".repeat(500) });
    const resolve = vi.spyOn(atlasService, "resolveFile");
    const rows = (await atlasMobile.library({ accountId: "default" })).items;
    const document = rows.find(item => item.kind === "file")!;
    expect(document).toMatchObject({ fileName: "report.pdf", mimeType: "application/pdf", byteSize: 17 });
    expect(Array.from(rows.find(item => item.pageId === page.item.id)!.preview!)).toHaveLength(240);
    expect(resolve).not.toHaveBeenCalled();
    expect(JSON.stringify(rows)).not.toContain(directory);
    expect(rows.every(item => !("blocks" in item) && !("path" in item))).toBe(true);
    output("x".repeat(239) + "😀.pdf", "unicode-name");
    const unicode = (await atlasMobile.library({ accountId: "default" })).items.find(item => item.file?.runId === "unicode-name")!;
    expect(unicode.fileName).toBe("x".repeat(239)); // Never cut a UTF-16 surrogate pair at the wire limit.
  });

  it("reads bounded thumbnails for selected and saved images, refusing foreign and non-image sources", async () => {
    const file = output("photo.png"), preview = Buffer.from("small thumbnail");
    const resize = vi.fn(async () => ({ bytes: preview, mime: "image/png" as const, width: 128, height: 96 }));
    const reset = installTestBackendRuntime({ getPath: () => directory, imagePreview: { resize } });
    try {
      const reference = (await atlasMobile.library({ accountId: "default" })).items[0].file!;
      const image = await atlasMobile.readImage({ accountId: "default", reference });
      expect(Buffer.from(image.base64, "base64")).toEqual(preview);
      expect(image).toMatchObject({ reference, width: 128, height: 96, version: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(resize).toHaveBeenCalledWith(expect.any(Buffer), 128, true);
      expect(JSON.stringify(image)).not.toContain(directory);
      const saved = await atlasService.saveFile({ accountId: "default", runId: "conversation", path: file });
      expect((await atlasMobile.readImage({ accountId: "default", reference: { itemId: saved.id } })).base64).toBe(image.base64);
      await expect(atlasMobile.readImage({ accountId: "other", reference })).rejects.toThrow("not found");
      const pdf = output("notes.pdf", "pdf-chat");
      const document = await atlasService.saveFile({ accountId: "default", runId: "pdf-chat", path: pdf });
      await expect(atlasMobile.readImage({ accountId: "default", reference: { itemId: document.id } })).rejects.toThrow("Not an Atlas image");
      await atlasService.update({ accountId: "default", id: saved.id, trashed: true });
      await expect(atlasMobile.readImage({ accountId: "default", reference: { itemId: saved.id } })).rejects.toThrow("not found");
    } finally { reset(); }
  });

  it.each(["changed", "trashed", "oversized"])("refuses thumbnail bytes when their source becomes %s during decoding", async (condition) => {
    const file = output("photo.png");
    const saved = await atlasService.saveFile({ accountId: "default", runId: "conversation", path: file });
    const reference = condition === "trashed" ? { itemId: saved.id } : { runId: "conversation", sourceKey: sourceKey("conversation", fs.realpathSync(file)) };
    const reset = installTestBackendRuntime({ getPath: () => directory, imagePreview: { resize: async () => {
      if (condition === "changed") fs.writeFileSync(file, "changed source during decoding");
      if (condition === "trashed") await atlasService.update({ accountId: "default", id: saved.id, trashed: true });
      return { bytes: condition === "oversized" ? Buffer.alloc(128 * 1024 + 1) : Buffer.from("thumbnail"), mime: "image/png", width: 128, height: 96 };
    } } });
    try { await expect(atlasMobile.readImage({ accountId: "default", reference })).rejects.toThrow(); }
    finally { reset(); }
  });

  it("routes replica thumbnails through the verified conversation image reader", async () => {
    createRun(db, { id: "replica-image", mode: "work", status: "succeeded", ownerBackendId: "remote-source" });
    replicaOutputs.set("replica-image", [{ id: -42, kind: "image", metadata: { path: "/remote/photo.png", byteSize: 2 }, createdAt: new Date() }]);
    const { runsService } = await import("../runs");
    vi.mocked(runsService.listOutputs).mockReset().mockResolvedValue({ items: [{ runId: "replica-image", artifactId: -42,
      name: "photo.png", mimeType: "image/png", previewType: "image", byteSize: 2, modifiedAt: 1, version: "d".repeat(64) }], nextOffset: null });
    const reader = vi.mocked(runsService.readArtifactImage).mockReset().mockResolvedValue({ mime: "image/png", base64: Buffer.from("tiny").toString("base64"), width: 1, height: 1 });
    const reference = (await atlasMobile.library({ accountId: "default" })).items[0].file!;
    expect((await atlasMobile.readImage({ accountId: "default", reference })).width).toBe(1);
    expect(reader).toHaveBeenCalledWith({ runId: "replica-image", artifactId: -42, maxSide: 128 });
  });

  it.each(["page", "file", "image", "bookmark"] as const)("shows, creates and removes phone tags on a saved %s without changing content or source context", async (kind) => {
    createRun(db, { id: "tag-conversation", mode: "work" });
    atlasRepo.insert({ id: "tag-item", accountId: "default", kind, title: "Keep title", sourceRunId: "tag-conversation", isFavorite: true,
      version: 4, url: kind === "bookmark" ? "https://example.com" : null, description: "Keep description", note: "Keep note" });
    const identity = { accountId: "default", id: "tag-item" };
    atlasRepo.setTags(identity.id, identity.accountId, ["Work", "AI suggestion"], "ai");
    const before = atlasMobile.readTags(identity), work = before.tags.find(tag => tag.name === "Work")!;
    const result = atlasMobile.setTags({ ...identity, expectedRevision: before.revision, tags: [work.id, "New topic", "Ｗｏｒｋ"] });
    const current = atlasMobile.readTags(identity);
    expect(current.tags).toEqual(expect.arrayContaining([{ ...work, source: "ai" }, expect.objectContaining({ name: "New topic", source: "user" })]));
    expect(current.tags).toHaveLength(2);
    expect(result).toEqual({ id: identity.id, requestedId: identity.id, title: "Keep title", kind, revision: current.revision });
    const library = await atlasMobile.library({ accountId: "default", scope: "saved", tagId: work.id });
    expect(library.items.map(row => row.savedItemId)).toEqual([identity.id]);
    expect(library.items[0].tags).toEqual(current.tags);
    expect(atlasService.get(identity)).toMatchObject({ title: "Keep title", sourceRunId: "tag-conversation", isFavorite: true, version: 4, description: "Keep description", note: "Keep note" });
    expect(JSON.stringify(current)).not.toMatch(/"(path|blocks|markdown|metadata|note|url)":/);
    atlasMobile.setTags({ ...identity, expectedRevision: current.revision, tags: [] });
    expect((await atlasMobile.library({ accountId: "default", tagId: work.id })).items).toEqual([]);
    atlasRepo.setTags(identity.id, identity.accountId, ["Work", "AI suggestion"], "ai");
    expect(atlasMobile.readTags(identity).tags).toEqual([]);
    expect(atlasService.listTags({ accountId: "default" })).toHaveLength(3);
  });

  it("bounds a large merged tag selection without silently replacing hidden tags", async () => {
    atlasRepo.insert({ id: "merged-tags", accountId: "default", kind: "page", title: "Merged Page" });
    for (let index = 0; index < 61; index++) {
      const id = `merged-tag-${index}`, name = `Tag ${String(index).padStart(2, "0")}`;
      db.insert(atlasTags).values({ id, accountId: "default", name, normalizedName: name.toLowerCase() }).run();
      db.insert(atlasItemTags).values({ itemId: "merged-tags", tagId: id, source: "user" }).run();
    }
    expect((await atlasMobile.library({ accountId: "default" })).items[0].tags).toHaveLength(60);
    expect(() => atlasMobile.readTags({ accountId: "default", id: "merged-tags" })).toThrow("too many tags");
    expect(atlasService.get({ accountId: "default", id: "merged-tags" })?.tags).toHaveLength(61);
  });

  it("keeps the phone tag catalogue bounded, searchable and scoped to the account", async () => {
    createAccount(db, { id: "tag-foreign" });
    for (const [id, accountId] of [["one", "default"], ["two", "default"], ["private", "tag-foreign"]]) atlasRepo.insert({ id, accountId, kind: "page", title: id });
    const names = Array.from({ length: 55 }, (_, index) => `Topic ${String(index).padStart(2, "0")}`);
    atlasRepo.setTags("one", "default", names.slice(0, 30), "user");
    atlasRepo.setTags("two", "default", names.slice(30), "user");
    atlasRepo.setTags("private", "tag-foreign", ["Private"], "user");
    await atlasService.update({ accountId: "default", id: "two", trashed: true });
    const first = atlasMobile.tags({ accountId: "default" }), second = atlasMobile.tags({ accountId: "default", page: 2 });
    expect(first.items).toHaveLength(50); expect(first.hasNext).toBe(true);
    expect(second.items).toHaveLength(5); expect(second.hasNext).toBe(false);
    expect([...first.items, ...second.items].map(tag => tag.name)).toEqual(names);
    expect(first.items[0].count).toBe(1); expect(second.items[0].count).toBe(0);
    expect(atlasMobile.tags({ accountId: "default", query: "ＴＯＰＩＣ ０" }).items).toHaveLength(10);
    expect(atlasMobile.tags({ accountId: "default", query: "%" }).items).toEqual([]);
    expect(atlasMobile.tags({ accountId: "default", page: 3 }).items).toEqual([]);
    for (const page of [0, -1, 1.5, 100001]) expect(() => atlasMobile.tags({ accountId: "default", page })).toThrow();
    expect(() => atlasMobile.tags({ accountId: "default", query: "x".repeat(65) })).toThrow();
  });

  it("refuses stale phone tag edits after another device or enrichment changes them, without creating orphan tags", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Original", markdown: "Keep body" });
    const identity = { accountId: "default", id: page.item.id };
    atlasService.setTags({ ...identity, tags: ["Research"] });
    const before = atlasMobile.readTags(identity);
    await atlasService.update({ ...identity, isFavorite: true });
    expect(atlasMobile.readTags(identity).revision).toBe(before.revision);
    atlasService.renameTag({ accountId: "default", id: before.tags[0].id, name: "Renamed elsewhere" });
    expect(() => atlasMobile.setTags({ ...identity, expectedRevision: before.revision, tags: ["Unsent new tag"] })).toThrow("changed elsewhere");
    expect(atlasService.listTags({ accountId: "default" }).map(tag => tag.name)).toEqual(["Renamed elsewhere"]);
    const fresh = atlasMobile.readTags(identity);
    atlasRepo.setTags(identity.id, "default", ["Enriched"], "ai");
    expect(() => atlasMobile.setTags({ ...identity, expectedRevision: fresh.revision, tags: [] })).toThrow("changed elsewhere");
    expect(atlasService.getPage(identity)?.revision.markdown).toContain("Keep body");
  });

  it("rejects foreign, trashed or generated-only tag targets and refuses fields beyond tags", async () => {
    createAccount(db, { id: "tag-other" });
    atlasRepo.insert({ id: "tag-active", accountId: "default", kind: "page", title: "Active" });
    atlasRepo.insert({ id: "tag-other-item", accountId: "tag-other", kind: "page", title: "Private" });
    atlasService.setTags({ accountId: "tag-other", id: "tag-other-item", tags: ["Private tag"] });
    const identity = { accountId: "default", id: "tag-active" }, revision = atlasMobile.readTags(identity).revision;
    const foreignTag = atlasService.listTags({ accountId: "tag-other" })[0].id;
    expect(() => atlasMobile.setTags({ ...identity, expectedRevision: revision, tags: ["Roll back creation", foreignTag] })).toThrow("different account");
    expect(atlasService.listTags({ accountId: "default" })).toEqual([]);
    for (const tags of [null, [false], [""], ["a\nb"], ["😀".repeat(33)], Array(31).fill("Tag")])
      expect(() => atlasMobile.setTags({ ...identity, expectedRevision: revision, tags } as never)).toThrow();
    for (const field of ["title", "path", "isFavorite", "collectionId", "trashed", "metadata"])
      expect(() => atlasMobile.setTags({ ...identity, expectedRevision: revision, tags: ["Tag"], [field]: true } as never)).toThrow("Invalid");
    for (const id of ["tag-other-item", "generated-only"])
      expect(() => atlasMobile.readTags({ accountId: "default", id })).toThrow("not found");
    await atlasService.update({ ...identity, trashed: true });
    expect(() => atlasMobile.setTags({ ...identity, expectedRevision: revision, tags: ["Tag"] })).toThrow("Trash");
    expect(atlasService.get(identity)?.title).toBe("Active");
  });

  it.each(["page", "file", "image", "bookmark"] as const)("moves a saved %s to Trash and restores it idempotently without losing metadata", async (kind) => {
    db.insert(collections).values({ id: "trash-project", accountId: "default", name: "Research" }).run();
    atlasRepo.insert({ id: "trash-item", accountId: "default", kind, title: "Keep title", collectionId: "trash-project", isFavorite: true, version: 4 });
    const identity = { accountId: "default", id: "trash-item" };
    const first = await atlasMobile.setTrash({ ...identity, trashed: true });
    const date = atlasService.get(identity)!.trashedAt;
    expect(await atlasMobile.setTrash({ ...identity, trashed: true })).toEqual(first);
    expect(atlasService.get(identity)!.trashedAt).toBe(date);
    expect(atlasMobile.trash({ accountId: "default" }).items).toMatchObject([{ id: "trash-item", kind, collectionId: "trash-project" }]);
    expect(first).toMatchObject({ id: "trash-item", requestedId: "trash-item", kind, trashed: true });
    expect(first).not.toHaveProperty("path");
    expect((await atlasMobile.setTrash({ ...identity, trashed: false })).trashed).toBe(false);
    await atlasMobile.setTrash({ ...identity, trashed: false });
    expect(atlasService.get(identity)).toMatchObject({ title: "Keep title", collectionId: "trash-project", isFavorite: true, version: 4, trashedAt: null });
    expect(atlasMobile.trash({ accountId: "default" }).items).toEqual([]);
  });

  it("pages only the account's trashed metadata in stable Trash-date order", () => {
    createAccount(db, { id: "trash-foreign" });
    const date = new Date();
    for (let index = 0; index < 55; index++) {
      atlasRepo.insert({ id: `trash-${String(index).padStart(2, "0")}`, accountId: "default", kind: "page", title: `Page ${index}`, trashedAt: date });
    }
    atlasRepo.insert({ id: "trash-old", accountId: "default", kind: "file", title: "Older trash", trashedAt: new Date(0), updatedAt: new Date(date.getTime() + 86400_000) });
    atlasRepo.insert({ id: "active", accountId: "default", kind: "page", title: "Active" });
    atlasRepo.insert({ id: "foreign", accountId: "trash-foreign", kind: "page", title: "Private", trashedAt: date });
    const first = atlasMobile.trash({ accountId: "default" }), next = atlasMobile.trash({ accountId: "default", page: 2 });
    expect(first.items).toHaveLength(50); expect(first.hasNext).toBe(true);
    expect(next.items).toHaveLength(6); expect(next.hasNext).toBe(false);
    expect(next.items.at(-1)?.id).toBe("trash-old");
    expect(new Set([...first.items, ...next.items].map((item) => item.id)).size).toBe(56);
    expect(first.items.every((item) => item.id !== "foreign" && item.id !== "active")).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/"(path|blocks|markdown|note)":/);
    for (const page of [0, -1, 1.5, 100001]) expect(() => atlasMobile.trash({ accountId: "default", page })).toThrow("Invalid");
  });

  it("keeps the first Trash timestamp when another device submits the same state before confirmation", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Shared Page", markdown: "Body" });
    const input = { accountId: "default", id: page.item.id, trashed: true };
    const update = atlasService.update.bind(atlasService);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-13T10:00:00Z"));
    let commits = 0;
    const spy = vi.spyOn(atlasService, "update").mockImplementation((fields, validate) => update(fields, () => {
      validate?.();
      if (++commits === 1) vi.setSystemTime(new Date("2026-11-13T10:00:10Z"));
    }));
    try {
      await Promise.all([atlasMobile.setTrash(input), atlasMobile.setTrash(input)]);
      expect(atlasService.get(input)?.trashedAt).toBe("2026-11-13T10:00:00.000Z");
    } finally { spy.mockRestore(); vi.useRealTimers(); }
  });
  it("preserves both an Atlas file's immutable bytes and its conversation's original through Trash/Restore", async () => {
    const source = output("kept.pdf", "trash-source");
    const copy = await atlasService.saveFile({ accountId: "default", runId: "trash-source", path: source });
    const identity = { accountId: "default", id: copy.id };
    await atlasMobile.setTrash({ ...identity, trashed: true });
    expect(fs.existsSync(source) && fs.existsSync(copy.path!)).toBe(true);
    await expect(atlasMobile.describeFile({ accountId: "default", reference: { itemId: copy.id } })).rejects.toThrow("not found");
    expect((await atlasMobile.library({ accountId: "default" })).items).toEqual([]);
    const { runsService } = await import("../runs");
    expect((await runsService.getOutputArtifacts("trash-source")).some((item) => item.path === fs.realpathSync(source))).toBe(true);
    await atlasMobile.setTrash({ ...identity, trashed: false });
    expect((await atlasMobile.describeFile({ accountId: "default", reference: { itemId: copy.id } })).name).toBe("kept.pdf");
    expect(fs.readFileSync(copy.path!, "utf8")).toBe("original contents");
  });

  it("rejects foreign, missing and generated-only Trash targets and all wider mutations", async () => {
    atlasRepo.insert({ id: "trash-safe", accountId: "default", kind: "file", title: "Keep" });
    const identity = { accountId: "default", id: "trash-safe", trashed: true };
    await expect(atlasMobile.setTrash({ ...identity, accountId: "other" })).rejects.toThrow("not found");
    await expect(atlasMobile.setTrash({ ...identity, id: "a".repeat(64) })).rejects.toThrow("not found");
    await expect(atlasMobile.setTrash({ ...identity, trashed: "yes" } as never)).rejects.toThrow("Only Trash");
    for (const field of ["title", "path", "remove", "metadata", "collectionId"]) {
      await expect(atlasMobile.setTrash({ ...identity, [field]: "forbidden" } as never)).rejects.toThrow("Only Trash");
    }
    expect(atlasService.get(identity)?.trashedAt).toBeNull();
  });

  it.each(["page", "file", "image", "bookmark"] as const)("organizes a permanent %s without changing its content or source", async (kind) => {
    db.insert(collections).values({ id: "phone-project", accountId: "default", name: "Research" }).run();
    atlasRepo.insert({ id: "organize", accountId: "default", kind, title: "Keep title", version: 7 });
    const initial = atlasService.get({ id: "organize", accountId: "default" })!;
    const identity = { id: "organize", accountId: "default" };
    const favorite = await atlasMobile.updateItem({ ...identity, isFavorite: true });
    expect(favorite).toMatchObject({ id: "organize", requestedId: "organize", isFavorite: true, collectionId: null, kind });
    expect(await atlasMobile.updateItem({ ...identity, isFavorite: true })).toEqual(favorite);
    const moved = await atlasMobile.updateItem({ ...identity, collectionId: "phone-project" });
    expect(moved).toMatchObject({ isFavorite: true, collectionId: "phone-project" });
    expect((await atlasMobile.library({ accountId: "default", scope: "favorites", collectionId: "phone-project" })).items.map((item) => item.savedItemId)).toEqual(["organize"]);
    await atlasMobile.updateItem({ ...identity, isFavorite: false });
    expect((await atlasMobile.library({ accountId: "default", scope: "favorites" })).items).toEqual([]);
    await atlasMobile.updateItem({ ...identity, collectionId: null });
    const current = atlasService.get(identity)!;
    expect(current).toMatchObject({ title: initial.title, version: initial.version, metadata: initial.metadata, sourceRunId: initial.sourceRunId, collectionId: null, isFavorite: false });
    expect(moved).not.toHaveProperty("path");
  });

  it("refuses foreign/archived projects, Trash, generated-only identities and broader item writes", async () => {
    createAccount(db, { id: "other" });
    db.insert(collections).values([{ id: "foreign-project", accountId: "other", name: "Private" }, { id: "archived-project", accountId: "default", name: "Old", isArchived: true }]).run();
    atlasRepo.insert({ id: "phone-item", accountId: "default", kind: "file", title: "Original" });
    const identity = { accountId: "default", id: "phone-item" };
    await expect(atlasMobile.updateItem({ ...identity, accountId: "other", isFavorite: true })).rejects.toThrow("not found");
    await expect(atlasMobile.updateItem({ ...identity, collectionId: "foreign-project" })).rejects.toThrow();
    await expect(atlasMobile.updateItem({ ...identity, collectionId: "archived-project" })).rejects.toThrow("archived");
    await expect(atlasMobile.updateItem({ ...identity, collectionId: "missing" })).rejects.toThrow("not found");
    await expect(atlasMobile.updateItem({ ...identity, isFavorite: "yes" } as never)).rejects.toThrow("Only favorite");
    await expect(atlasMobile.updateItem(identity)).rejects.toThrow("Only favorite");
    for (const field of ["title", "trashed", "metadata", "path"]) {
      await expect(atlasMobile.updateItem({ ...identity, isFavorite: true, [field]: "forbidden" } as never)).rejects.toThrow("Only favorite");
    }
    await expect(atlasMobile.updateItem({ ...identity, id: "a".repeat(64), isFavorite: true })).rejects.toThrow("not found");
    await atlasService.update({ ...identity, trashed: true });
    await expect(atlasMobile.updateItem({ ...identity, isFavorite: true })).rejects.toThrow("Trash");
    expect(atlasService.get(identity)).toMatchObject({ title: "Original", collectionId: null, isFavorite: false });
  });

  it("rechecks active item ownership after awaiting project validation", async () => {
    db.insert(collections).values({ id: "race-project", accountId: "default", name: "Research" }).run();
    atlasRepo.insert({ id: "racing-item", accountId: "default", kind: "page", title: "Notes" });
    const identity = { accountId: "default", id: "racing-item" };
    const { collectionsService } = await import("../collections");
    const original = collectionsService.get.bind(collectionsService);
    vi.spyOn(collectionsService, "get").mockImplementation(async (input) => {
      const project = await original(input);
      await atlasService.update({ ...identity, trashed: true });
      return project;
    });
    await expect(atlasMobile.updateItem({ ...identity, collectionId: "race-project" })).rejects.toThrow("Trash");
    expect(atlasService.get(identity)?.collectionId).toBeNull();
  });

  it("organizes the permanent copy of a generated result without moving its source conversation", async () => {
    const file = output("report.pdf", "organize-source");
    const saved = await atlasService.saveFile({ accountId: "default", runId: "organize-source", path: file });
    db.insert(collections).values({ id: "copy-project", accountId: "default", name: "Saved research" }).run();
    await atlasMobile.updateItem({ accountId: "default", id: saved.id, collectionId: "copy-project", isFavorite: true });
    const generated = (await atlasMobile.library({ accountId: "default", scope: "generated" })).items[0];
    expect(generated.key).not.toBe(saved.id);
    expect(generated).toMatchObject({ savedItemId: saved.id, savedCollectionId: "copy-project", collectionId: null, isFavorite: true });
    expect(db.select().from(runs).where(eq(runs.id, "organize-source")).get()?.collectionId).toBeNull();
  });

  it.each(["work", "developer", "chat"] as const)("saves an exact selected output by identity in %s without accepting a path", async (mode) => {
    const file = output("snapshot.pdf", `save-${mode}`, mode);
    const { runsService } = await import("../runs");
    const { describeRunOutput } = await import("../runs/run-output-files");
    const selected = (await runsService.getOutputArtifacts(`save-${mode}`)).find((row) => row.path === fs.realpathSync(file))!;
    const descriptor = await describeRunOutput(`save-${mode}`, selected, false);
    vi.mocked(runsService.listOutputs).mockResolvedValue({ items: [descriptor], nextOffset: null });
    const input = { accountId: "default", runId: `save-${mode}`, artifactId: descriptor.artifactId, version: descriptor.version };
    const item = await atlasMobile.saveFile(input);
    expect(item.kind).toBe("file"); expect(item).not.toHaveProperty("path");
    expect(await atlasMobile.saveFile(input)).toEqual(item);
    const stored = atlasService.get({ accountId: "default", id: item.id })!;
    expect(fs.readFileSync(stored.path!, "utf8")).toBe("original contents");
    expect(atlasService.list({ accountId: "default" })).toHaveLength(1);
    await expect(atlasMobile.saveFile({ ...input, accountId: "other" })).rejects.toThrow("not found");
    await expect(atlasMobile.saveFile({ ...input, attachmentId: "a".repeat(64) })).rejects.toThrow("source");
    await expect(atlasMobile.saveFile({ ...input, version: "e".repeat(64) })).rejects.toThrow("changed");
    await expect(atlasMobile.saveFile({ accountId: "default", runId: input.runId, version: descriptor.version, path: file } as never)).rejects.toThrow("source");
  });

  it("saves generated library files and explicit attachments while refusing replicas", async () => {
    output();
    const entry = (await atlasMobile.library({ accountId: "default" })).items[0];
    const file = await atlasMobile.describeFile({ accountId: "default", reference: entry.file! });
    const result = await atlasMobile.saveFile({ accountId: "default", runId: "conversation", sourceKey: entry.key, version: file.version });
    expect(result.kind).toBe("file");
    const { runsService } = await import("../runs");
    const { prepareRunAttachments, resolveRunAttachment } = await import("../runs/run-attachment-storage");
    const { describeAttachmentFile } = await import("../runs/run-attachment-download");
    const uploaded = (await prepareRunAttachments("conversation", [{ name: "photo.png", type: "image", mimeType: "image/png", data: Buffer.from("png bytes").toString("base64") }], "phone-upload"))![0];
    const attachment = await describeAttachmentFile({ runId: "conversation", attachmentId: uploaded.attachmentId });
    vi.mocked(runsService.describeAttachmentFile).mockResolvedValue(attachment);
    vi.mocked(runsService.resolveAttachmentPath).mockResolvedValue((await resolveRunAttachment("conversation", uploaded.attachmentId)).path);
    const saved = await atlasMobile.saveFile({ accountId: "default", runId: "conversation", attachmentId: uploaded.attachmentId, version: attachment.version });
    expect(saved.kind).toBe("image");
    db.update(runs).set({ ownerBackendId: "different-computer" }).where(eq(runs.id, "conversation")).run();
    await expect(atlasMobile.saveFile({ accountId: "default", runId: "conversation", attachmentId: uploaded.attachmentId, version: attachment.version })).rejects.toThrow("source computer");
  });
  it("keeps replica download hydration with the original output reader and checks ownership on each chunk", async () => {
    createRun(db, { id: "phone-replica", mode: "work", status: "succeeded", ownerBackendId: "remote-phone-source" });
    replicaOutputs.set("phone-replica", [{ id: -42, kind: "document", metadata: { path: "/other-device/report.pdf", byteSize: 2 }, createdAt: new Date() }]);
    const { runsService } = await import("../runs");
    const version = "d".repeat(64);
    const describe = vi.mocked(runsService.listOutputs).mockReset().mockResolvedValue({ items: [{ runId: "phone-replica", artifactId: -42,
      name: "report.pdf", mimeType: "application/pdf", previewType: "native", byteSize: 2, modifiedAt: 1, version }], nextOffset: null });
    const read = vi.mocked(runsService.readOutputFile).mockReset().mockImplementation(async (input) => {
      if (input.version !== version) throw new Error("Output changed");
      return { base64: Buffer.from("x").toString("base64"), byteSize: 2, version, offset: input.offset, nextOffset: input.offset === 0 ? 1 : null };
    });
    const reference = (await atlasMobile.library({ accountId: "default" })).items[0].file!;
    expect((await atlasMobile.describeFile({ accountId: "default", reference })).version).toBe(version);
    await atlasMobile.readFile({ accountId: "default", reference, version, offset: 0 });
    await atlasMobile.readFile({ accountId: "default", reference, version, offset: 1 });
    expect(describe).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(2);
    await expect(atlasMobile.readFile({ accountId: "default", reference, version: "a".repeat(64), offset: 1 })).rejects.toThrow("changed");
    await expect(atlasMobile.readFile({ accountId: "other", reference, version, offset: 1 })).rejects.toThrow("not found");
    expect(JSON.stringify(await atlasMobile.library({ accountId: "default" }))).not.toContain("/other-device");
  });
  it("paginates saved Pages, filters favorites/search and never exposes blocks or computer paths", async () => {
    const date = new Date();
    for (let index = 0; index < 55; index++) {
      const id = `phone-page-${String(index).padStart(2, "0")}`;
      atlasRepo.insert({ id, accountId: "default", kind: "page", title: `Phone notes ${index}`, version: 1, isFavorite: index === 0 });
      db.update(atlasItems).set({ updatedAt: date }).where(eq(atlasItems.id, id)).run();
    }
    const first = await atlasMobile.library({ accountId: "default", type: "page" });
    const second = await atlasMobile.library({ accountId: "default", type: "page", page: 2 });
    expect(first.items).toHaveLength(50); expect(first.hasNext).toBe(true);
    expect(second.items).toHaveLength(5); expect(second.hasNext).toBe(false);
    expect(new Set([...first.items, ...second.items].map((item) => item.key)).size).toBe(55);
    expect(first.items.every((item) => item.file === null && item.pageId === item.key)).toBe(true);
    const favorites = await atlasMobile.library({ accountId: "default", scope: "favorites", query: "Phone" });
    expect(favorites.items.map((item) => item.key)).toEqual(["phone-page-00"]);
    const wire = JSON.stringify(first);
    expect(wire).not.toContain('"path"'); expect(wire).not.toContain('"blocks"'); expect(wire).not.toContain(directory);
    createAccount(db, { id: "other" });
    expect((await atlasMobile.library({ accountId: "other" })).items).toEqual([]);
  });

  it("reads Page Markdown in scalar-safe numbered parts and refuses changed, foreign and trashed Pages", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Travel" });
    const markdown = "x".repeat(16_383) + "😀" + "İstanbul 🌍";
    db.update(atlasPageRevisions).set({ markdown }).where(eq(atlasPageRevisions.id, page.revision.id)).run();
    const first = atlasMobile.readPage({ accountId: "default", id: page.item.id });
    expect(first.markdown.endsWith("😀")).toBe(true); expect(first.nextOffset).toBe(16_384);
    const second = atlasMobile.readPage({ accountId: "default", id: page.item.id, offset: first.nextOffset!, version: first.version });
    expect(first.markdown + second.markdown).toBe(markdown); expect(second.nextOffset).toBeNull();
    expect(() => atlasMobile.readPage({ accountId: "default", id: page.item.id, offset: 16_384 })).toThrow("position");
    expect(() => atlasMobile.readPage({ accountId: "default", id: page.item.id, version: 2 })).toThrow("changed");
    expect(() => atlasMobile.readPage({ accountId: "other", id: page.item.id })).toThrow("not found");
    expect(first).not.toHaveProperty("blocks");
    await atlasService.update({ accountId: "default", id: page.item.id, trashed: true });
    expect(() => atlasMobile.readPage({ accountId: "default", id: page.item.id })).toThrow("not found");
  });

  it("downloads only selected Work files by opaque identity, checking revisions on every chunk", async () => {
    const file = output();
    const bytes = Buffer.from("😀abc".repeat(50_000)); fs.writeFileSync(file, bytes);
    const listed = await atlasMobile.library({ accountId: "default" });
    const reference = listed.items[0].file!;
    expect(reference).toEqual({ runId: "conversation", sourceKey: sourceKey("conversation", fs.realpathSync(file)) });
    const descriptor = await atlasMobile.describeFile({ accountId: "default", reference });
    expect(JSON.stringify(descriptor)).not.toContain(directory);
    let offset = 0; const parts: Buffer[] = [];
    while (true) {
      const chunk = await atlasMobile.readFile({ accountId: "default", reference, version: descriptor.version, offset });
      const part = Buffer.from(chunk.base64, "base64"); expect(part.length).toBeLessThanOrEqual(128 * 1024); parts.push(part);
      if (chunk.nextOffset === null) break;
      offset = chunk.nextOffset;
    }
    expect(Buffer.concat(parts)).toEqual(bytes);
    fs.writeFileSync(file, "changed");
    await expect(atlasMobile.readFile({ accountId: "default", reference, version: descriptor.version, offset: 0 })).rejects.toThrow("changed");
    await expect(atlasMobile.describeFile({ accountId: "other", reference })).rejects.toThrow("not found");
    await expect(atlasMobile.describeFile({ accountId: "default", reference: { runId: "conversation", sourceKey: "a".repeat(64) } })).rejects.toThrow("not found");
    db.update(runs).set({ mode: "developer" }).where(eq(runs.id, "conversation")).run();
    await expect(atlasMobile.describeFile({ accountId: "default", reference })).rejects.toThrow("not found");
    expect((await atlasMobile.library({ accountId: "default" })).items).toEqual([]);
  });

  it("opens explicit saved copies across modes, but rejects Trash, symlinks and mixed references", async () => {
    const file = output();
    const saved = await atlasService.saveFile({ accountId: "default", runId: "conversation", path: file });
    db.update(runs).set({ mode: "developer" }).where(eq(runs.id, "conversation")).run();
    const reference = { itemId: saved.id }, request = { accountId: "default", reference };
    expect((await atlasMobile.library({ accountId: "default" })).items[0].file).toEqual(reference);
    const descriptor = await atlasMobile.describeFile(request);
    fs.rmSync(file);
    const chunk = await atlasMobile.readFile({ ...request, offset: 0, version: descriptor.version });
    expect(Buffer.from(chunk.base64, "base64").toString()).toBe("original contents");
    await expect(atlasMobile.describeFile({ accountId: "other", reference })).rejects.toThrow("not found");
    await expect(atlasMobile.describeFile({ ...request, reference: { ...reference, runId: "conversation" } as never })).rejects.toThrow("reference");
    await atlasService.update({ accountId: "default", id: saved.id, trashed: true });
    await expect(atlasMobile.describeFile(request)).rejects.toThrow("not found");
    await atlasService.update({ accountId: "default", id: saved.id, trashed: false });
    const outside = path.join(directory, "private.pdf"); fs.writeFileSync(outside, "private");
    fs.rmSync(saved.path!); fs.symlinkSync(outside, saved.path!);
    await expect(atlasMobile.describeFile(request)).rejects.toThrow();
  });
});
describe("Atlas Page asset visibility", { timeout: 15000 }, () => {
  it("keeps existing Page uploads usable but out of every library view until explicitly saved", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Notes" });
    const upload = { accountId: "default", pageId: page.item.id, fileName: "embedded.pdf", data: Buffer.from("page attachment").toString("base64") };
    const file = await atlasService.uploadFile(upload);
    const identity = { accountId: "default", id: file.id };
    const savedPage = await atlasService.savePage({ accountId: "default", id: page.item.id, expectedVersion: 1, title: "Notes",
      blocks: [{ type: "file", props: { url: `atlas-file://${file.id}`, name: file.fileName } }] });
    await atlasService.update({ ...identity, isFavorite: true });
    await atlasService.setTags({ ...identity, tags: ["Embedded"] });
    const tag = atlasService.listTags({ accountId: "default" })[0];
    expect(tag.count).toBe(0);
    expect((await atlasService.uploadFile(upload)).id).toBe(file.id);
    expect(atlasService.list({ accountId: "default", kind: "file" }).map(item => item.id)).toEqual([file.id]);
    for (const scope of ["all", "saved", "favorites", "generated", "uploads"] as const) {
      expect((await atlasService.library({ accountId: "default", scope, query: "embedded" })).items).toEqual([]);
      expect((await atlasMobile.library({ accountId: "default", scope, tagId: tag.id })).items).toEqual([]);
    }
    const request = { accountId: "default", reference: { itemId: file.id } };
    const descriptor = await atlasMobile.describeFile(request);
    expect(descriptor.canSaveToLibrary).toBe(true);
    expect(Buffer.from((await atlasMobile.readFile({ ...request, offset: 0, version: descriptor.version })).base64, "base64").toString()).toBe("page attachment");
    const promoted = await atlasService.saveFile({ accountId: "default", itemId: file.id });
    expect(promoted).toMatchObject({ id: file.id, path: file.path, sourceKey: file.sourceKey, metadata: { savedToLibrary: true } });
    expect((await atlasService.saveFile({ accountId: "default", itemId: file.id })).updatedAt).toBe(promoted.updatedAt);
    expect((await atlasService.uploadFile(upload)).metadata?.savedToLibrary).toBe(true);
    expect((await atlasMobile.describeFile(request)).canSaveToLibrary).toBe(false);
    expect(atlasService.listTags({ accountId: "default" })[0].count).toBe(1);
    for (const scope of ["all", "saved", "favorites"] as const)
      expect((await atlasService.library({ accountId: "default", scope, tagId: tag.id })).items.map(entry => entry.key)).toEqual([file.id]);
    expect(atlasService.getPage({ accountId: "default", id: page.item.id })?.revision).toEqual(savedPage.revision);
    expect(fs.readFileSync(file.path!, "utf8")).toBe("page attachment");
    expect(atlasService.list({ accountId: "default", kind: "file" })).toHaveLength(1);
    await atlasService.update({ ...identity, trashed: true });
    await expect(atlasService.remove(identity)).rejects.toThrow("used by a Page");
  });

  it("uses the existing version-checked phone save command to promote one stored identity", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Notes" });
    const file = await atlasService.uploadFile({ accountId: "default", pageId: page.item.id, fileName: "photo.png", data: Buffer.from("image").toString("base64") });
    const version = (await atlasMobile.describeFile({ accountId: "default", reference: { itemId: file.id } })).version;
    const input = { accountId: "default", itemId: file.id, version };
    await expect(atlasMobile.saveFile({ ...input, version: "0".repeat(64) })).rejects.toThrow("changed");
    await expect(atlasMobile.saveFile({ ...input, runId: "unexpected" })).rejects.toThrow("source");
    await expect(atlasMobile.saveFile({ ...input, path: file.path } as never)).rejects.toThrow("source");
    createAccount(db, { id: "other" });
    await expect(atlasMobile.saveFile({ ...input, accountId: "other" })).rejects.toThrow("not found");
    expect((await atlasMobile.library({ accountId: "default", type: "image" })).items).toEqual([]);
    expect(await atlasMobile.saveFile(input)).toMatchObject({ id: file.id, kind: "image" });
    expect(await atlasMobile.saveFile(input)).toMatchObject({ id: file.id });
    expect((await atlasMobile.library({ accountId: "default", type: "image" })).items.map(entry => entry.key)).toEqual([file.id]);
    await atlasService.update({ accountId: "default", id: file.id, trashed: true });
    await expect(atlasMobile.saveFile(input)).rejects.toThrow("not found");
    await expect(atlasService.saveFile({ accountId: "default", itemId: file.id })).rejects.toThrow("unavailable");
  });

  it("does not let hidden Page images suppress matching Work outputs or count toward library image identities", async () => {
    const source = output("matching.png");
    const page = await atlasService.createPage({ accountId: "default", title: "Notes" });
    const image = await atlasService.uploadFile({ accountId: "default", pageId: page.item.id, fileName: "matching.png", data: fs.readFileSync(source).toString("base64") });
    expect(atlasRepo.imageIdentities("default")).toEqual([]);
    expect((await atlasService.library({ accountId: "default", type: "image" })).items.map(entry => entry.generated?.path)).toEqual([fs.realpathSync(source)]);
    await atlasService.saveFile({ accountId: "default", itemId: image.id });
    expect(atlasRepo.imageIdentities("default")).toHaveLength(1);
    expect((await atlasService.library({ accountId: "default", type: "image" })).items.map(entry => entry.key)).toEqual([image.id]);
  });

  it("rechecks Trash after asynchronous save validation without changing the Page asset", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Notes" });
    const file = await atlasService.uploadFile({ accountId: "default", pageId: page.item.id, fileName: "hidden.txt", data: "dGV4dA==" });
    await expect(atlasService.saveFile({ accountId: "default", itemId: file.id }, async () => {
      await atlasService.update({ accountId: "default", id: file.id, trashed: true });
    })).rejects.toThrow("unavailable");
    expect(atlasService.get({ accountId: "default", id: file.id })?.metadata?.savedToLibrary).toBeUndefined();
    await expect(atlasService.saveFile({ accountId: "default", itemId: page.item.id })).rejects.toThrow("unavailable");
  });
});

describe("Atlas file lifecycle", { timeout: 15000 }, () => {
  it("uses the same final-message, deduplicated outputs as the conversation", async () => {
    const file = output("final.md");
    const early = path.join(root("conversation"), "CONTEXT.md"); fs.writeFileSync(early, "project context");
    createRunArtifact(db, { runId: "conversation", kind: "document", metadata: JSON.stringify({ path: early }) });
    createRunArtifact(db, { runId: "conversation", kind: "report", content: `[Early](<${early}>)` });
    createRunArtifact(db, { runId: "conversation", kind: "report", content: "Working" });
    createRunArtifact(db, { runId: "conversation", kind: "report", content: `[Delivered](<${file}>) [Again](./final.md)`,
      metadata: JSON.stringify({ messagePhase: "final_answer" }) });
    createRunArtifact(db, { runId: "conversation", kind: "report", content: "Done" });
    const { runsService } = await import("../runs");
    const selected = (await runsService.getOutputArtifacts("conversation")).filter((row) => row.metadata?.outputSelected);
    const generated = await atlasService.generated({ accountId: "default" });
    expect(selected).toHaveLength(1);
    expect(generated.items.map((item) => item.path)).toEqual(selected.map((row) => row.path));
  });
  it("does not treat a tool's project-file reference as a generated document", async () => {
    createRun(db, { id: "tool-context", mode: "work", status: "succeeded" });
    fs.mkdirSync(root("tool-context"), { recursive: true });
    const context = path.join(root("tool-context"), "CONTEXT.md");
    fs.writeFileSync(context, "project context");
    createToolCall(db, { runId: "tool-context", toolName: "Read", status: "done",
      input: JSON.stringify({ path: context }), output: JSON.stringify({ path: context }) });
    createRunArtifact(db, { runId: "tool-context", kind: "report", content: "Review now refreshes the diff.",
      metadata: JSON.stringify({ messagePhase: "final_answer" }) });
    const { runsService } = await import("../runs");
    expect((await runsService.getOutputArtifacts("tool-context")).filter((row) => row.metadata?.outputSelected)).toEqual([]);
    expect((await atlasService.generated({ accountId: "default" })).items).toEqual([]);
  });
  it("preserves extensions and supports filenames containing repeated dots", async () => {
    const file = output("report..pdf");
    const saved = await atlasService.saveFile({ accountId: "default", runId: "conversation", path: file });
    expect(fs.readFileSync(saved.path!, "utf8")).toBe("original contents");
    const longFile = output(`${"ö".repeat(100)}.pdf`, "long-name");
    const longSaved = await atlasService.saveFile({ accountId: "default", runId: "long-name", path: longFile });
    expect(longSaved.fileName).toMatch(/\.pdf$/);
    expect(Buffer.byteLength(longSaved.fileName!)).toBeLessThanOrEqual(180);
    expect(fs.readFileSync(longSaved.path!, "utf8")).toBe("original contents");
  });
  it("projects generated files without copying or creating Atlas items", async () => {
    const file = output();
    const result = await atlasService.generated({ accountId: "default" });
    expect(result.items.map((item) => item.path)).toEqual([fs.realpathSync(file)]);
    expect(atlasService.list({ accountId: "default" })).toEqual([]);
    expect(fs.existsSync(path.join(directory, "atlas"))).toBe(false);
  });
  it.each(["work", "developer", "chat"] as const)("automatically lists delivered files only from Work (%s)", async (mode) => {
    const runId = `folder-${mode}`;
    createRun(db, { id: runId, mode, status: "succeeded" });
    const files = ["screenshot.PNG", "nested/chart.svg", "export.webp", "report.pdf", "summary.txt", "registered.png"]
      .map((relativePath): RunOutputFile => {
        const absolutePath = path.join(root(runId, mode), relativePath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, "output contents");
        const stats = fs.statSync(absolutePath);
        return { fileName: path.basename(absolutePath), relativePath, absolutePath,
          size: stats.size, modifiedAt: stats.mtimeMs };
      });
    createRunArtifact(db, { runId, kind: "image", path: path.join(root(runId, mode), "registered.png") });
    createRunArtifact(db, { runId, kind: "report", content: "[Report](report.pdf) [Summary](summary.txt)" });
    expect(files).toHaveLength(6);

    const result = await atlasService.generated({ accountId: "default" });
    expect(result.items.map((item) => item.fileName).sort()).toEqual(mode === "work" ? ["report.pdf", "summary.txt"] : []);
  });
  it("projects and saves Codex images from the native thread folder without final file references", async () => {
    vi.spyOn(os, "homedir").mockReturnValue(directory);
    createRun(db, { id: "codex-run", providerId: "codex", mode: "work", sessionId: "native-thread", status: "succeeded" });
    const images = path.join(directory, ".codex", "generated_images", "native-thread");
    fs.mkdirSync(images, { recursive: true });
    const registered = path.join(images, "generated.png");
    const unregistered = path.join(images, "older.png");
    fs.writeFileSync(registered, "generated image");
    fs.writeFileSync(unregistered, "older image");
    createRunArtifact(db, { runId: "codex-run", kind: "image", path: registered,
      metadata: JSON.stringify({ path: registered, source: "codex_image_generation" }) });
    const copy = path.join(root("codex-run"), "generated-copy.png");
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(registered, copy);
    createRunArtifact(db, { runId: "codex-run", kind: "image", metadata: JSON.stringify({ path: copy }) });
    const unrelated = path.join(directory, ".codex", "generated_images", "other-thread", "private.png");
    fs.mkdirSync(path.dirname(unrelated));
    fs.writeFileSync(unrelated, "another thread");
    createRunArtifact(db, { runId: "codex-run", kind: "image", path: unrelated,
      metadata: JSON.stringify({ path: unrelated, source: "codex_image_generation" }) });
    createRunArtifact(db, { runId: "codex-run", kind: "report", content: "Created your image.",
      metadata: JSON.stringify({ messagePhase: "final_answer" }) });
    const result = await atlasService.generated({ accountId: "default" });
    expect(result.items.map((item) => item.path)).toEqual([fs.realpathSync(registered)]);
    expect(atlasService.list({ accountId: "default" })).toEqual([]);
    const saved = await atlasService.saveFile({ accountId: "default", runId: "codex-run", path: registered });
    expect(fs.readFileSync(saved.path!, "utf8")).toBe("generated image");
    await expect(atlasService.saveFile({ accountId: "default", runId: "codex-run", path: unrelated })).rejects.toThrow("outside");
  });
  it.each(["developer", "chat"] as const)("keeps %s files in their conversation until explicitly saved", async (mode) => {
    createRun(db, { id: "conversation", mode, status: "succeeded" });
    const folder = root("conversation", mode);
    fs.mkdirSync(folder, { recursive: true });
    const cited = path.join(folder, "CONTEXT.md");
    const delivered = path.join(folder, "summary.pdf");
    fs.writeFileSync(cited, "project context");
    fs.writeFileSync(delivered, "report");
    const image = path.join(folder, "generated.png");
    fs.writeFileSync(image, "native image");
    createRunArtifact(db, { runId: "conversation", kind: "document", metadata: JSON.stringify({ path: delivered, outputRole: "deliverable" }) });
    createRunArtifact(db, { runId: "conversation", kind: "image", path: image,
      metadata: JSON.stringify({ path: image, source: "codex_image_generation" }) });
    createRunArtifact(db, { runId: "conversation", kind: "report", content: `Updated [CONTEXT.md](<${cited}>), [summary](<${delivered}>) and [image](<${image}>)`,
      metadata: JSON.stringify({ messagePhase: "final_answer" }) });
    const [attachment] = (await prepareRunAttachments("conversation", [{ name: "screen.png", type: "image",
      mimeType: "image/png", data: Buffer.from("uploaded original").toString("base64") }]))!;

    for (const scope of ["all", "generated", "uploads"] as const)
      expect((await atlasService.library({ accountId: "default", scope })).items).toEqual([]);
    expect(await atlasService.generated({ accountId: "default" })).toEqual({ items: [], nextOffset: null });
    const { runsService } = await import("../runs");
    expect((await runsService.getOutputArtifacts("conversation")).filter((item) => item.metadata?.outputSelected).map((item) => item.path).sort())
      .toEqual([cited, delivered, image].map((file) => fs.realpathSync(file)).sort());
    expect(await resolveRunAttachment("conversation", attachment.attachmentId!)).toMatchObject({ path: attachment.sourcePath });

    for (const file of [cited, delivered, image, attachment.sourcePath]) {
      const saved = await atlasService.saveFile({ accountId: "default", runId: "conversation", path: file });
      expect(fs.readFileSync(saved.path!)).toEqual(fs.readFileSync(file));
    }
    const page = await atlasService.createPage({ accountId: "default", title: "Notes", markdown: "Keep me" });
    const titles = ["CONTEXT.md", "summary.pdf", "generated.png", "screen.png", page.item.title].sort();
    for (const scope of ["all", "saved"] as const)
      expect((await atlasService.library({ accountId: "default", scope })).items.map((entry) => entry.title).sort()).toEqual(titles);
    db.delete(runs).where(eq(runs.id, "conversation")).run();
    expect((await atlasService.library({ accountId: "default" })).items.map((entry) => entry.title).sort()).toEqual(titles);
  });
  it.each(["work", "developer", "chat"] as const)("automatically lists synced %s files only for Work", async (mode) => {
    createRun(db, { id: "replica", ownerBackendId: "laptop", mode });
    const attachmentId = "b".repeat(64);
    db.insert(runAttachments).values({ id: attachmentId, name: "upload.png", type: "image", mimeType: "image/png",
      storageKey: `attachments/${attachmentId}/upload.png`, byteSize: 10, contentHash: "c".repeat(64) }).run();
    db.insert(runAttachmentRefs).values({ runId: "replica", attachmentId, inputKey: "prompt", ordinal: 0 }).run();
    const output = (id: number, name: string, metadata: object) => ({ id, runId: "replica", kind: "document", path: null,
      content: "", blobData: null, entityId: null, contentHash: null, createdAt: new Date("2026-10-17T10:00:00Z"),
      metadata: { outputSelected: true, path: `/Users/laptop/repo/${name}`, fileName: name, byteSize: 10, ...metadata } });
    replicaOutputs.set("replica", [output(-1, "CLAUDE.md", {}), output(-2, "brief.pdf", { outputRole: "deliverable" }),
      output(-3, "generated.png", { source: "codex_image_generation" })]);
    try {
      const outputs = ["CLAUDE.md", "brief.pdf", "generated.png"];
      for (const [scope, titles] of [["all", [...outputs, "upload.png"]], ["generated", outputs], ["uploads", ["upload.png"]]] as const)
        expect((await atlasService.library({ accountId: "default", scope })).items.map((entry) => entry.title).sort())
          .toEqual(mode === "work" ? [...titles].sort() : []);
      expect((await atlasService.generated({ accountId: "default" })).items.map((item) => item.fileName).sort())
        .toEqual(mode === "work" ? [...outputs, "upload.png"].sort() : []);
    } finally { replicaOutputs.delete("replica"); }
  });
  it("selects a native generated image when the completed reply contains no file reference", async () => {
    createRun(db, { id: "inline-image", providerId: "codex", mode: "work", status: "succeeded" });
    const image = path.join(directory, "generated-images", "inline-image", "generated.png");
    fs.mkdirSync(path.dirname(image), { recursive: true });
    fs.writeFileSync(image, "native image output");
    createRunArtifact(db, { runId: "inline-image", kind: "image", path: image,
      metadata: JSON.stringify({ path: image, source: "codex_image_generation" }) });
    expect((await atlasService.generated({ accountId: "default" })).items.map((item) => item.path)).toEqual([fs.realpathSync(image)]);
    createRunArtifact(db, { runId: "inline-image", kind: "report", content: "Created your image.",
      metadata: JSON.stringify({ messagePhase: "final_answer" }) });
    expect((await atlasService.generated({ accountId: "default" })).items.map((item) => item.path)).toEqual([fs.realpathSync(image)]);
  });
  it("projects durable image attachments separately from creations and can save their originals", async () => {
    createRun(db, { id: "uploads", mode: "work" });
    const [attachment] = (await prepareRunAttachments("uploads", [{ name: "screen.png", type: "image",
      mimeType: "image/png", data: Buffer.from("uploaded original").toString("base64") }]))!;
    createRun(db, { id: "foreign-uploads", accountId: "other", mode: "work" });
    await prepareRunAttachments("foreign-uploads", [{ name: "private.png", type: "image",
      mimeType: "image/png", data: Buffer.from("private original").toString("base64") }]);
    const result = await atlasService.generated({ accountId: "default" });
    expect(result.items).toEqual([expect.objectContaining({ path: fs.realpathSync(attachment.sourcePath),
      origin: "attachment", runId: "uploads", fileName: "screen.png" })]);
    expect((await atlasService.library({ accountId: "default", scope: "uploads" })).items.map((entry) => entry.generated?.runId)).toEqual(["uploads"]);
    expect((await atlasService.library({ accountId: "default", scope: "generated" })).items).toEqual([]);
    expect(atlasService.list({ accountId: "default" })).toEqual([]);
    const saved = await atlasService.saveFile({ accountId: "default", runId: "uploads", path: attachment.sourcePath });
    expect(fs.readFileSync(saved.path!, "utf8")).toBe("uploaded original");
    fs.unlinkSync(attachment.sourcePath);
    expect((await atlasService.generated({ accountId: "default" })).items).toEqual([]);
  });
  it("excludes historical annotation screenshots while retaining ordinary uploads and chat originals", async () => {
    createRun(db, { id: "annotations", mode: "work" });
    const files = (await prepareRunAttachments("annotations", [
      { name: "browser-localhost-annotation-abcdef.png", type: "image", mimeType: "image/png", data: Buffer.from("annotation").toString("base64") },
      { name: "browser-localhost-annotation-other.png", type: "image", mimeType: "image/png", data: Buffer.from("ordinary upload").toString("base64") },
    ], "sent"))!;
    await insertRunInputArtifact("annotations", { type: "artifact", kind: "user-prompt", content: "remove them",
      metadata: { browserAnnotations: [{ id: "abcdef-annotation", url: "http://localhost:3000", elements: [{ tagName: "h1", selector: "h1" }] }],
        attachments: files.map(attachmentDescriptor) } });
    expect((await atlasService.generated({ accountId: "default" })).items.map((file) => file.path)).toEqual([files[1].sourcePath]);
    expect(await resolveRunAttachment("annotations", files[0].attachmentId!)).toMatchObject({ path: files[0].sourcePath });
    expect((await runsRepo.findArtifactsByRun("annotations"))[0].metadata?.attachments).toHaveLength(2);
    // An explicit user save still admits a hidden context screenshot.
    expect((await atlasService.saveFile({ accountId: "default", runId: "annotations", path: files[0].sourcePath })).kind).toBe("image");
  });
  it("uses annotation attachment identity regardless of filename, including inherited fork attachments", async () => {
    createRun(db, { id: "annotation-source", mode: "work" });
    createRun(db, { id: "annotation-fork", mode: "work" });
    const [image] = (await prepareRunAttachments("annotation-source", [{ name: "capture.png", type: "image",
      mimeType: "image/png", data: Buffer.from("annotation").toString("base64") }], "sent"))!;
    await insertRunInputArtifact("annotation-source", { type: "artifact", kind: "user-prompt", content: "change it",
      metadata: { browserAnnotations: [{ id: "annotation", url: "http://localhost", screenshotAttachmentId: image.attachmentId,
        elements: [{ tagName: "h1", selector: "h1" }] }], attachments: [attachmentDescriptor(image)] } });
    runsRepo.inheritAttachmentRefs("annotation-source", "annotation-fork");
    expect((await atlasService.generated({ accountId: "default" })).items).toEqual([]);
    expect(await resolveRunAttachment("annotation-fork", image.attachmentId!)).toMatchObject({ path: image.sourcePath });
  });
  it("lists another device's uploads and selected outputs from their records, without opening its files", async () => {
    createRun(db, { id: "replica", title: "On the laptop", ownerBackendId: "laptop", mode: "work" });
    const id = "b".repeat(64), hash = "c".repeat(64), source = "/Users/laptop/out/chart.png";
    db.insert(runAttachments).values({ id, name: "Screenshot.png", type: "image", mimeType: "image/png",
      storageKey: `attachments/${id}/Screenshot.png`, byteSize: 125636, contentHash: hash, createdAt: new Date("2026-10-16T09:00:00Z") }).run();
    db.insert(runAttachmentRefs).values({ runId: "replica", attachmentId: id, inputKey: "prompt", ordinal: 0 }).run();
    replicaOutputs.set("replica", [{ id: -42, runId: "replica", kind: "image", path: null, content: "", blobData: null, entityId: null,
      contentHash: null, createdAt: new Date("2026-10-17T10:00:00Z"), metadata: { outputSelected: true, path: source, fileName: "chart.png", byteSize: 2048 } }]);
    try {
      const images = (await atlasService.library({ accountId: "default", type: "image" })).items;
      expect(images.map((entry) => [entry.title, entry.path, entry.generated?.origin, entry.generated?.replica])).toEqual([
        ["chart.png", null, "generated", { backendId: "laptop", artifactId: -42 }],
        ["Screenshot.png", null, "attachment", { backendId: "laptop", attachmentId: id }],
      ]);
      // The laptop keys its own output by that path, so a copy it saved to Atlas is not listed twice.
      expect(images[0].generated?.sourceKey).toBe(sourceKey("replica", source));
      expect(images[1]).toMatchObject({ contentHash: hash, generated: { runTitle: "On the laptop", byteSize: 125636 } });
      // A saved copy of the same image replaces the upload in All; Uploads still lists it.
      db.insert(atlasItems).values({ id: "saved-copy", accountId: "default", kind: "image", title: "Saved", contentHash: hash }).run();
      expect((await atlasService.library({ accountId: "default", type: "image" })).items.some((entry) => entry.generated?.replica?.attachmentId)).toBe(false);
      expect((await atlasService.library({ accountId: "default", scope: "uploads" })).items.map((entry) => entry.generated?.replica?.attachmentId)).toEqual([id]);
      await expect(atlasService.saveFile({ accountId: "default", runId: "replica", path: source })).rejects.toThrow("source backend");
    } finally { replicaOutputs.clear(); }
  });
  it("projects image content hashes across uploads and generated files and refreshes changed outputs", async () => {
    createRun(db, { id: "hash-uploads", mode: "work" });
    const [upload] = (await prepareRunAttachments("hash-uploads", [{ name: "photo.png", type: "image", mimeType: "image/png",
      data: Buffer.from("same image bytes").toString("base64") }]))!;
    const generated = output("generated.png", "hash-generated");
    const realGenerated = fs.realpathSync(generated);
    fs.writeFileSync(generated, "same image bytes");
    const files = (await atlasService.generated({ accountId: "default" })).items;
    expect(files).toHaveLength(2);
    const hash = files.find((file) => file.path === upload.sourcePath)?.contentHash;
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(files.find((file) => file.path === realGenerated)?.contentHash).toBe(hash);
    fs.writeFileSync(generated, "changed content!");
    expect((await atlasService.generated({ accountId: "default" })).items.find((file) => file.path === realGenerated)?.contentHash).not.toBe(hash);
  });
  it("saves once under concurrent requests and survives source deletion", async () => {
    const file = output();
    const input = { accountId: "default", runId: "conversation", path: file };
    const [first, second] = await Promise.all([atlasService.saveFile(input), atlasService.saveFile(input)]);
    expect(first.id).toBe(second.id);
    expect(fs.readFileSync(first.path!, "utf8")).toBe("original contents");
    fs.writeFileSync(file, "changed source");
    expect((await atlasService.saveFile(input)).id).toBe(first.id);
    expect(fs.readFileSync(first.path!, "utf8")).toBe("original contents");
    db.delete(runs).where(eq(runs.id, "conversation")).run();
    fs.rmSync(path.join(directory, "runs"), { recursive: true });
    const saved = atlasService.get({ accountId: "default", id: first.id });
    expect(saved).not.toBeNull();
    if (!saved) throw new Error("Saved file missing");
    expect(saved.sourceRunId).toBeNull();
    expect(saved.sourceKey).toBeTruthy();
    expect(fs.readFileSync(saved.path!, "utf8")).toBe("original contents");
    expect(atlasService.list({ accountId: "default" })).toHaveLength(1);
    expect(await atlasService.isStoredFile(fs.realpathSync(saved.path!))).toBe(true);
  });
  it("deletes a removed item's own folder but never follows a synced id outside the Atlas folder", async () => {
    const saved = await atlasService.saveFile({ accountId: "default", runId: "conversation", path: output() });
    const folder = path.dirname(saved.path!);
    await atlasService.update({ accountId: "default", id: saved.id, trashed: true });
    await atlasService.remove({ accountId: "default", id: saved.id });
    expect(fs.existsSync(folder)).toBe(false);

    // Another device chose this id; it resolves to a folder beside the profile's Atlas files.
    const outside = path.join(directory, "outside");
    fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "keep.txt"), "not Atlas data");
    db.insert(atlasItems).values({ id: "../../outside", accountId: "default", kind: "image", title: "Photo.png",
      storageKey: "crafted/Photo.png", trashedAt: new Date() }).run();
    await atlasService.remove({ accountId: "default", id: "../../outside" });
    expect(fs.readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe("not Atlas data");
    expect(atlasService.get({ accountId: "default", id: "../../outside" })).toBeNull();
  });
  it("enforces account ownership, output provenance and symlink boundaries", async () => {
    const file = output();
    createAccount(db, { id: "other" });
    await expect(atlasService.saveFile({ accountId: "other", runId: "conversation", path: file })).rejects.toThrow("Conversation not found");
    const unregistered = path.join(root("conversation"), "unregistered.pdf");
    fs.writeFileSync(unregistered, "private");
    await expect(atlasService.saveFile({ accountId: "default", runId: "conversation", path: unregistered })).rejects.toThrow("not a generated output");
    const outside = path.join(directory, "private.pdf");
    fs.writeFileSync(outside, "secret");
    const link = path.join(root("conversation"), "link.pdf");
    fs.symlinkSync(outside, link);
    createRunArtifact(db, { runId: "conversation", kind: "document", metadata: JSON.stringify({ path: link }) });
    await expect(atlasService.saveFile({ accountId: "default", runId: "conversation", path: link })).rejects.toThrow("regular files");
    const linkDirectory = path.join(root("conversation"), "escape");
    fs.symlinkSync(directory, linkDirectory);
    const escape = path.join(linkDirectory, "private.pdf");
    createRunArtifact(db, { runId: "conversation", kind: "document", metadata: JSON.stringify({ path: escape }) });
    expect((await atlasService.generated({ accountId: "default" })).items).toHaveLength(1);
    await expect(atlasService.saveFile({ accountId: "default", runId: "conversation", path: escape })).rejects.toThrow("outside");
  });
  it("filters out Code and Chat conversations before paginating older Work files", async () => {
    output("one.pdf", "first"); output("two.pdf", "second");
    db.update(runs).set({ createdAt: new Date("2020-01-01") }).run();
    for (let index = 0; index < 30; index++)
      createRun(db, { id: `excluded-${index}`, mode: index % 2 ? "chat" : "developer" });
    const first = await atlasService.generated({ accountId: "default", limit: 1 });
    const second = await atlasService.generated({ accountId: "default", limit: 1, offset: first.nextOffset! });
    expect(first.items).toHaveLength(1); expect(second.items).toHaveLength(1);
    expect(first.items[0].sourceKey).not.toBe(second.items[0].sourceKey);
    expect(second.nextOffset).toBeNull();
    expect((await atlasService.library({ accountId: "default" })).items.map((entry) => entry.title).sort()).toEqual(["one.pdf", "two.pdf"]);
  });
});
describe("Atlas library pagination", { timeout: 15000 }, () => {
  function savedFiles(count: number) {
    const rows = Array.from({ length: count }, (_, index) => ({
      id: `saved-${String(index).padStart(4, "0")}`, accountId: "default", kind: "file" as const,
      title: `Report ${index}`, updatedAt: new Date("2026-10-01"),
    }));
    db.insert(atlasItems).values(rows).run();
    return rows;
  }

  it("returns 50 saved records at a time with stable ties and bounded database reads", async () => {
    savedFiles(105);
    createAccount(db, { id: "other" });
    db.insert(atlasItems).values({ id: "private", accountId: "other", kind: "file", title: "Private" }).run();
    const list = vi.spyOn(atlasRepo, "list");
    const first = await atlasService.library({ accountId: "default", scope: "saved" });
    const second = await atlasService.library({ accountId: "default", scope: "saved", page: 2 });
    const third = await atlasService.library({ accountId: "default", scope: "saved", page: 3 });
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(50);
    expect(third.items).toHaveLength(5);
    expect([first.hasNext, second.hasNext, third.hasNext]).toEqual([true, true, false]);
    expect(new Set([...first.items, ...second.items, ...third.items].map((item) => item.key)).size).toBe(105);
    expect((await atlasService.library({ accountId: "default", scope: "saved", page: 2 })).items).toEqual(second.items);
    expect(list.mock.results.every((result) => result.value.length <= 50)).toBe(true);
  });

  it("paginates files within a single conversation without dropping its remaining outputs", async () => {
    createRun(db, { id: "many-files", mode: "work", status: "succeeded" });
    fs.mkdirSync(root("many-files"), { recursive: true });
    const files = Array.from({ length: 105 }, (_, index) => path.join(root("many-files"), `report-${index}.pdf`));
    for (const file of files) {
      fs.writeFileSync(file, "document");
      createRunArtifact(db, { runId: "many-files", kind: "document", metadata: JSON.stringify({ path: file }) });
    }
    createRunArtifact(db, { runId: "many-files", kind: "report", content: files.map((file) => `[File](<${file}>)`).join("\n") });
    const first = await atlasService.library({ accountId: "default", scope: "generated" });
    const second = await atlasService.library({ accountId: "default", scope: "generated", page: 2 });
    const third = await atlasService.library({ accountId: "default", scope: "generated", page: 3 });
    expect([first.items.length, second.items.length, third.items.length]).toEqual([50, 50, 5]);
    expect(new Set([...first.items, ...second.items, ...third.items].map((item) => item.key)).size).toBe(105);
    expect(third.hasNext).toBe(false);
    expect(atlasService.list({ accountId: "default" })).toEqual([]);
  });

  it("searches past empty conversation batches and applies source, type and project filters before pagination", async () => {
    db.insert(collections).values({ id: "project", accountId: "default", name: "Research" }).run();
    output("needle.pdf", "old");
    db.update(runs).set({ createdAt: new Date("2020-01-01"), collectionId: "project" }).where(eq(runs.id, "old")).run();
    for (let index = 0; index < 30; index++) createRun(db, { id: `empty-${index}`, mode: "work", collectionId: "project" });
    output("needle-elsewhere.pdf", "outside-project");
    const page = await atlasService.library({ accountId: "default", type: "file", scope: "generated", collectionId: "project", query: "NEEDLE" });
    expect(page.items.map((item) => item.title)).toEqual(["needle.pdf"]);
    expect(page.hasNext).toBe(false);
    expect((await atlasService.library({ accountId: "default", type: "image", query: "needle" })).items).toEqual([]);
    expect((await atlasService.library({ accountId: "default", scope: "uploads", query: "needle" })).items).toEqual([]);
  });

  it("merges saved and generated files before applying the 50-item boundary", async () => {
    savedFiles(49);
    const firstFile = output("first.pdf");
    const secondFile = path.join(root("conversation"), "second.pdf");
    fs.writeFileSync(secondFile, "second document");
    createRunArtifact(db, { runId: "conversation", kind: "document", metadata: JSON.stringify({ path: secondFile }) });
    createRunArtifact(db, { runId: "conversation", kind: "report", content: `[First](<${firstFile}>) [Second](<${secondFile}>)` });
    const saved = await atlasService.saveFile({ accountId: "default", runId: "conversation", path: firstFile });
    const first = await atlasService.library({ accountId: "default" });
    const second = await atlasService.library({ accountId: "default", page: 2 });
    expect(first.items).toHaveLength(50);
    expect(first.hasNext).toBe(true);
    expect(second.items).toHaveLength(1);
    expect(second.hasNext).toBe(false);
    const combined = [...first.items, ...second.items];
    expect(new Set(combined.map((entry) => entry.key)).size).toBe(51);
    expect(combined.some((entry) => entry.key === saved.id)).toBe(true);
    expect(combined.some((entry) => entry.generated?.path === fs.realpathSync(firstFile))).toBe(false);
    expect(combined.some((entry) => entry.generated?.path === fs.realpathSync(secondFile))).toBe(true);
  });

  it("deduplicates images across page boundaries and retains the permanent copy in All", async () => {
    savedFiles(51);
    db.insert(atlasItems).values([
      { id: "image-first", accountId: "default", kind: "image", title: "Photo", contentHash: "identical", updatedAt: new Date("2026-10-02") },
      { id: "image-last", accountId: "default", kind: "image", title: "Photo copy", contentHash: "identical", updatedAt: new Date("2026-09-01") },
    ]).run();
    const first = await atlasService.library({ accountId: "default", scope: "saved" });
    const second = await atlasService.library({ accountId: "default", scope: "saved", page: 2 });
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(2);
    expect([...first.items, ...second.items].filter((entry) => entry.kind === "image").map((entry) => entry.key)).toEqual(["image-first"]);

    const file = output("photo.png");
    const saved = await atlasService.saveFile({ accountId: "default", runId: "conversation", path: file });
    const images = await atlasService.library({ accountId: "default", type: "image" });
    expect(images.items.some((entry) => entry.key === saved.id)).toBe(true);
    expect(images.items.some((entry) => entry.generated?.path === fs.realpathSync(file))).toBe(false);
    const creations = await atlasService.library({ accountId: "default", type: "image", scope: "generated" });
    expect(creations.items).toHaveLength(1);
    expect(creations.items[0].saved?.id).toBe(saved.id);
  });

  it("filters favorites and Unicode search before filling a page and clamps pages after removal", async () => {
    const rows = savedFiles(51);
    db.insert(atlasItems).values({ id: "trashed", accountId: "default", kind: "file", title: "Trash", trashedAt: new Date() }).run();
    db.update(atlasItems).set({ title: "ÇALIŞMA notları", isFavorite: true }).where(eq(atlasItems.id, rows[0].id)).run();
    const matching = await atlasService.library({ accountId: "default", scope: "favorites", query: "çalişma" });
    expect(matching.items.map((item) => item.key)).toEqual([rows[0].id]);
    const last = await atlasService.library({ accountId: "default", scope: "saved", page: 2 });
    db.delete(atlasItems).where(eq(atlasItems.id, last.items[0].key)).run();
    const clamped = await atlasService.library({ accountId: "default", scope: "saved", page: 2 });
    expect(clamped.page).toBe(1);
    expect(clamped.items).toHaveLength(50);
    expect(clamped.hasNext).toBe(false);
  });

  it("keeps the existing activity order across conversations within each discovery batch", async () => {
    const recentFile = output("recent.pdf", "older-chat");
    const oldFile = output("old.pdf", "newer-chat");
    db.update(runs).set({ createdAt: new Date("2024-01-01") }).where(eq(runs.id, "older-chat")).run();
    db.update(runs).set({ createdAt: new Date("2025-01-01") }).where(eq(runs.id, "newer-chat")).run();
    fs.utimesSync(recentFile, new Date("2026-10-02"), new Date("2026-10-02"));
    fs.utimesSync(oldFile, new Date("2026-10-01"), new Date("2026-10-01"));
    expect((await atlasService.library({ accountId: "default", scope: "generated" })).items.map((entry) => entry.title))
      .toEqual(["recent.pdf", "old.pdf"]);
  });

  it("loads excerpts and image references only for the visible Page cards", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Notes" });
    const image = await atlasService.uploadFile({ accountId: "default", pageId: page.item.id,
      fileName: "diagram.png", data: Buffer.from("diagram").toString("base64") });
    await atlasService.savePage({ accountId: "default", id: page.item.id, expectedVersion: 1,
      title: "Notes", markdown: `![Diagram](atlas-file://${image.id})` });
    const without = await atlasService.library({ accountId: "default", type: "page" });
    expect(without.items[0].saved).not.toHaveProperty("preview");
    expect(without.previewImages).toEqual({});
    const grid = await atlasService.library({ accountId: "default", type: "page", includePagePreview: true });
    expect(grid.items).toHaveLength(1);
    expect(grid.items[0].saved?.preview).toContain(image.id);
    expect(grid.previewImages).toEqual({ [`atlas-file://${image.id}`]: image.path });
  });

  it("bounds inventory lookups and rejects invalid pages", async () => {
    const rows = savedFiles(51);
    expect(atlasService.list({ accountId: "default", limit: 30, kind: "page", trashed: false })).toEqual([]);
    expect(atlasService.list({ accountId: "default", ids: [rows[0].id] }).map((item) => item.id)).toEqual([rows[0].id]);
    expect(atlasService.list({ accountId: "default", ids: [] })).toEqual([]);
    expect(atlasService.list({ accountId: "default", offset: 50 })).toHaveLength(1);
    for (const page of [0, -1, 1.5, Infinity]) await expect(atlasService.library({ accountId: "default", page })).rejects.toThrow("pagination");
  });
});

describe("Atlas Pages", { timeout: 15000 }, () => {
  it("lists optional bounded previews from the current revision, scoped to the account", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Notes", markdown: "## Original\n- [ ] Old task" });
    const identity = { accountId: "default", id: page.item.id };
    const blank = await atlasService.createPage({ accountId: "default", title: "Blank" });
    const file = await atlasService.uploadFile({ accountId: "default", pageId: page.item.id,
      fileName: "note.pdf", data: Buffer.from("document").toString("base64") });
    createAccount(db, { id: "other" });
    await atlasService.createPage({ accountId: "other", title: "Private", markdown: "Secret content" });
    expect(atlasService.list({ accountId: "default" }).every((item) => !("preview" in item))).toBe(true);

    // An agent save always adds a revision, so version 1 stays available to restore.
    await atlasService.savePage({ ...identity, expectedVersion: 1, title: "Notes", markdown: "## Today\n- [x] New task" }, "agent");
    const items = atlasService.list({ accountId: "default", includePagePreview: true });
    expect(items).toHaveLength(3);
    expect(items.find((item) => item.id === file.id)).not.toHaveProperty("preview");
    expect(items.find((item) => item.id === page.item.id)?.preview).toContain("New task");
    expect(items.find((item) => item.id === page.item.id)?.preview).not.toContain("Old task");
    expect(items.find((item) => item.id === blank.item.id)?.preview?.trim()).toBe("");
    expect(JSON.stringify(items)).not.toContain("Secret content");
    expect(items.every((item) => !("revision" in item) && !("blocks" in item))).toBe(true);

    await atlasService.restore({ ...identity, expectedVersion: 2, version: 1 });
    expect(atlasService.list({ accountId: "default", includePagePreview: true })
      .find((item) => item.id === page.item.id)?.preview).toContain("Old task");
    db.update(atlasPageRevisions).set({ markdown: "x".repeat(10000) })
      .where(eq(atlasPageRevisions.itemId, page.item.id)).run();
    expect(atlasService.list({ accountId: "default", includePagePreview: true })
      .find((item) => item.id === page.item.id)?.preview).toHaveLength(2400);
  });
  it("merges presentation changes without revisions and preserves them through content saves/restores", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Notes", markdown: "Original" });
    const identity = { accountId: "default", id: page.item.id };
    expect(page.item.metadata).toBeNull();
    const cover = await atlasService.uploadFile({ accountId: "default", pageId: page.item.id,
      fileName: "cover.png", data: Buffer.from("cover bytes").toString("base64") });
    await Promise.all([
      atlasService.update({ ...identity, metadata: { coverFileId: cover.id } }),
      atlasService.update({ ...identity, metadata: { icon: "emoji:📚" } }),
    ]);
    expect(atlasService.getPage(identity)?.item.metadata).toEqual({ icon: "emoji:📚", coverFileId: cover.id });
    expect(atlasService.getPage(identity)?.item.version).toBe(1);
    expect(atlasService.revisions(identity)).toHaveLength(1);
    const [unchanged] = await Promise.all([
      atlasService.savePage({ ...identity, expectedVersion: 1, title: "Notes", blocks: page.revision.blocks }),
      atlasService.update({ ...identity, metadata: { icon: "emoji:📖" } }),
    ]);
    expect(unchanged.item.metadata).toEqual({ icon: "emoji:📖", coverFileId: cover.id });
    expect(unchanged.item.version).toBe(1);
    await Promise.all([
      atlasService.savePage({ ...identity, expectedVersion: 1, title: "Updated", markdown: "New content" }, "agent"),
      atlasService.update({ ...identity, metadata: { icon: "icon:notebook|violet" } }),
    ]);
    const restored = await atlasService.restore({ ...identity, expectedVersion: 2, version: 1 });
    expect(restored.item.version).toBe(3);
    expect(restored.revision.blocks).toEqual(page.revision.blocks);
    expect(restored.item.metadata).toEqual({ icon: "icon:notebook|violet", coverFileId: cover.id });
    expect(restored.revision).not.toHaveProperty("metadata");
    await atlasService.update({ ...identity, metadata: { icon: null } });
    expect(atlasService.getPage(identity)?.item.metadata).toEqual({ coverFileId: cover.id });
    await atlasService.update({ ...identity, metadata: null });
    expect(atlasService.getPage(identity)?.item.metadata).toBeNull();
    expect(db.select().from(atlasPageRevisions).where(eq(atlasPageRevisions.itemId, page.item.id)).all()).toHaveLength(3);
  });
  it("shares a saved cover without copies and protects it only while a current Page uses it", async () => {
    const first = await atlasService.createPage({ accountId: "default", title: "First" });
    const second = await atlasService.createPage({ accountId: "default", title: "Second" });
    const firstIdentity = { accountId: "default", id: first.item.id };
    const secondIdentity = { accountId: "default", id: second.item.id };
    const cover = await atlasService.uploadFile({ accountId: "default", pageId: first.item.id,
      fileName: "cover.png", data: Buffer.from("cover bytes").toString("base64") });
    const coverIdentity = { accountId: "default", id: cover.id };
    await atlasService.update({ ...firstIdentity, metadata: { coverFileId: cover.id } });
    await atlasService.update({ ...secondIdentity, metadata: { coverFileId: cover.id } });
    expect(atlasService.list({ accountId: "default" }).filter((item) => item.kind === "image")).toHaveLength(1);
    await atlasService.update({ ...coverIdentity, trashed: true });
    await expect(atlasService.remove(coverIdentity)).rejects.toThrow("used by a Page");
    await atlasService.update({ ...firstIdentity, metadata: { coverFileId: null } });
    await atlasService.update({ ...secondIdentity, trashed: true });
    await expect(atlasService.remove(coverIdentity)).rejects.toThrow("used by a Page");
    await atlasService.remove(secondIdentity);
    await atlasService.remove(coverIdentity);
    expect(fs.existsSync(cover.path!)).toBe(false);
    expect(atlasService.getPage(firstIdentity)?.item.metadata).toBeNull();
    expect(atlasService.revisions(firstIdentity)).toHaveLength(1);
  });
  it("validates metadata and requires an available, same-account stored cover image", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Notes" });
    const identity = { accountId: "default", id: page.item.id };
    const file = await atlasService.uploadFile({ accountId: "default", pageId: page.item.id,
      fileName: "report.pdf", data: Buffer.from("document").toString("base64") });
    await expect(atlasService.update({ ...identity, metadata: { coverFileId: file.id } })).rejects.toThrow("cover image");
    await expect(atlasService.update({ ...identity, metadata: { coverFileId: page.item.id } })).rejects.toThrow("cover image");
    await expect(atlasService.update({ ...identity, metadata: { coverFileId: "missing" } })).rejects.toThrow("not found");
    await expect(atlasService.update({ accountId: "default", id: file.id, metadata: { icon: "emoji:📄" } })).rejects.toThrow("Page unavailable");
    await expect(atlasService.update({ ...identity, metadata: { icon: "https://external/icon" } })).rejects.toThrow("Invalid Page icon");
    await expect(atlasService.update({ ...identity, metadata: { coverPositionY: 50 } as never })).rejects.toThrow("Unsupported Page metadata");
    createAccount(db, { id: "other" });
    const other = await atlasService.createPage({ accountId: "other", title: "Private" });
    const foreign = await atlasService.uploadFile({ accountId: "other", pageId: other.item.id,
      fileName: "cover.png", data: Buffer.from("private").toString("base64") });
    await expect(atlasService.update({ ...identity, metadata: { coverFileId: foreign.id } })).rejects.toThrow("not found");
    const cover = await atlasService.uploadFile({ accountId: "default", pageId: page.item.id,
      fileName: "cover.png", data: Buffer.from("cover").toString("base64") });
    await atlasService.update({ accountId: "default", id: cover.id, trashed: true });
    await expect(atlasService.update({ ...identity, metadata: { coverFileId: cover.id } })).rejects.toThrow("cover image");
    await atlasService.update({ accountId: "default", id: cover.id, trashed: false });
    fs.rmSync(cover.path!);
    await expect(atlasService.update({ ...identity, metadata: { coverFileId: cover.id } })).rejects.toThrow();
    expect(atlasService.getPage(identity)?.item.metadata).toBeNull();
  });
  it("keeps lossless blocks, handles concurrent updates, and restores as a new revision", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Notes", markdown: "# Plan\n\n- [ ] Ship Atlas" });
    expect(page.item.version).toBe(1);
    expect(page.revision.blocks.some((block) => (block as { type: string }).type === "heading")).toBe(true);
    const update = { accountId: "default", id: page.item.id, expectedVersion: 1, title: "Updated", markdown: "New content" };
    const results = await Promise.allSettled([atlasService.savePage(update, "agent"), atlasService.savePage(update, "agent")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const restored = await atlasService.restore({ accountId: "default", id: page.item.id, expectedVersion: 2, version: 1 });
    expect(restored.item.version).toBe(3);
    expect(restored.revision.blocks).toEqual(page.revision.blocks);
    expect(restored.item.title).toBe("Notes");
    const versions = db.select().from(atlasPageRevisions).where(eq(atlasPageRevisions.itemId, page.item.id)).all()
      .map((row) => row.version).sort((left, right) => right - left);
    expect(versions).toEqual([3, 2, 1]);
  });
  it("preserves Page content and history through Trash and rejects writes or permanent deletion in the wrong state", async () => {
    const first = await atlasService.createPage({ accountId: "default", title: "Notes", markdown: "Original" });
    const identity = { accountId: "default", id: first.item.id };
    const latest = await atlasService.savePage({ ...identity, title: "Latest notes", expectedVersion: 1, markdown: "Keep this" }, "agent");
    await expect(atlasService.remove(identity)).rejects.toThrow("Trash");
    await atlasService.update({ ...identity, trashed: true });
    await expect(atlasService.savePage({ ...identity, title: "Late write", expectedVersion: 2, markdown: "Wrong" })).rejects.toThrow("Trash");
    await expect(atlasService.restore({ ...identity, revisionId: first.revision.id, expectedVersion: 2 })).rejects.toThrow("Trash");
    expect(atlasService.getPage(identity)?.revision).toEqual(latest.revision);
    expect(atlasService.revisions(identity).map((row) => row.id)).toEqual([latest.revision.id, first.revision.id]);
    await atlasService.update({ ...identity, trashed: false });
    expect(atlasService.getPage(identity)?.item).toMatchObject({ title: "Latest notes", version: 2, trashedAt: null });
    await expect(atlasService.remove(identity)).rejects.toThrow("Trash");
    await atlasService.update({ ...identity, trashed: true });
    await atlasService.remove(identity);
    expect(atlasService.getPage(identity)).toBeNull();
  });
  it("folds a user's autosaves into one revision while the Page version still advances", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Notes", markdown: "v1" });
    const identity = { accountId: "default", id: page.item.id };
    await atlasService.savePage({ ...identity, expectedVersion: 1, title: "Notes", markdown: "v2" });
    const third = await atlasService.savePage({ ...identity, expectedVersion: 2, title: "Notes", markdown: "v3" });
    expect(third.revision.id).toBe(page.revision.id);
    expect(third.revision.markdown).toContain("v3");
    expect(third.item.version).toBe(3);
    // The version is still the concurrency token, so a stale editor cannot overwrite the folded save.
    await expect(atlasService.savePage({ ...identity, expectedVersion: 2, title: "Notes", markdown: "stale" })).rejects.toThrow("changed elsewhere");
    expect(revisionRows(page.item.id)).toHaveLength(1);
  });
  it("adds a revision for another author, an ended session and a restore, and keeps what the restore replaced", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Notes", markdown: "v1" });
    const identity = { accountId: "default", id: page.item.id };
    const agent = await atlasService.savePage({ ...identity, expectedVersion: 1, title: "Notes", markdown: "agent text" }, "agent");
    expect(agent.revision.id).not.toBe(page.revision.id);
    const user = await atlasService.savePage({ ...identity, expectedVersion: 2, title: "Notes", markdown: "user text" });
    expect(user.revision.id).not.toBe(agent.revision.id);
    // A pause longer than a session: the next save starts a new revision instead of rewriting this one.
    db.update(atlasPageRevisions).set({ createdAt: new Date(Date.now() - 60 * 60_000) }).where(eq(atlasPageRevisions.id, user.revision.id)).run();
    const later = await atlasService.savePage({ ...identity, expectedVersion: 3, title: "Notes", markdown: "later text" });
    expect(later.revision.id).not.toBe(user.revision.id);
    const restored = await atlasService.restore({ ...identity, revisionId: agent.revision.id, expectedVersion: 4 });
    expect(restored.revision.actor).toBe("restore");
    expect(restored.revision.id).not.toBe(later.revision.id);
    // The state the restore replaced stays listed, so the restore can be undone.
    expect(atlasService.revisions(identity).map((row) => row.id)).toContain(later.revision.id);
    expect(revisionRows(page.item.id)).toHaveLength(5);
  });
  it("prunes what history hides and relinks survivors, so none reads as a conflict", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Notes", markdown: "v1" });
    const identity = { accountId: "default", id: page.item.id };
    let latest = page;
    // Agent saves never fold, so consecutive ones are separate rows that history shows as one session.
    for (let version = 1; version <= 3; version++)
      latest = await atlasService.savePage({ ...identity, expectedVersion: latest.item.version, title: "Notes", markdown: `agent ${version}` }, "agent");
    const rows = revisionRows(page.item.id);
    expect(rows.map((row) => row.id).sort()).toEqual([page.revision.id, latest.revision.id].sort());
    expect(rows.find((row) => row.id === latest.revision.id)?.parentRevisionId).toBe(page.revision.id);
    expect(atlasService.getPage(identity)?.conflicts).toEqual([]);
    expect(atlasService.revisions(identity).map((row) => row.id)).toEqual([latest.revision.id, page.revision.id]);
  });
  it("does not rewrite a replicated revision while its sessions are still retained", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Notes", markdown: "v1" });
    const identity = { accountId: "default", id: page.item.id };
    // A Bridge clock means another backend may already hold this revision.
    db.run(sql`INSERT INTO bridge_row_clock(table_name,pk,register,physical_ms,counter,origin,values_json,portable)
      VALUES('atlas_page_revisions',${page.revision.id},'row',1,0,'other','{}',1)`);
    const next = await atlasService.savePage({ ...identity, expectedVersion: 1, title: "Notes", markdown: "v2" });
    expect(next.revision.id).not.toBe(page.revision.id);
    expect(atlasService.getRevision({ ...identity, revisionId: page.revision.id }).markdown).toContain("v1");
    await atlasService.savePage({ ...identity, expectedVersion: 2, title: "Notes", markdown: "agent 1" }, "agent");
    const last = await atlasService.savePage({ ...identity, expectedVersion: 3, title: "Notes", markdown: "agent 2" }, "agent");
    // History groups each author's saves into one entry. They still sit inside the retained sessions.
    expect(revisionRows(page.item.id)).toHaveLength(4);
    expect(atlasService.revisions(identity).map((row) => row.id)).toEqual([last.revision.id, next.revision.id]);
  });
  it("drops a replicated prefix older than the retained sessions without opening a conflict", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Notes", markdown: "base" });
    const identity = { accountId: "default", id: page.item.id };
    db.run(sql`INSERT INTO bridge_row_clock(table_name,pk,register,physical_ms,counter,origin,values_json,portable)
      VALUES('atlas_page_revisions',${page.revision.id},'row',1,0,'other','{}',1)`);
    let latest = page;
    const ids = [page.revision.id];
    for (let index = 0; index < HISTORY_CHECKPOINTS + 2; index++) {
      latest = await atlasService.savePage({ ...identity, expectedVersion: latest.item.version, title: "Notes", markdown: `s${index}` }, "agent");
      ids.push(latest.revision.id);
    }
    const step = 2 * 60 * 60_000;
    ids.forEach((id, index) => {
      db.update(atlasPageRevisions).set({ createdAt: new Date(Date.now() - (ids.length - index) * step) })
        .where(eq(atlasPageRevisions.id, id)).run();
      db.run(sql`INSERT OR IGNORE INTO bridge_row_clock(table_name,pk,register,physical_ms,counter,origin,values_json,portable)
        VALUES('atlas_page_revisions',${id},'row',1,0,'other','{}',1)`);
    });
    const mid = await atlasService.savePage({ ...identity, expectedVersion: latest.item.version, title: "Notes", markdown: "mid" }, "agent");
    const head = await atlasService.savePage({ ...identity, expectedVersion: mid.item.version, title: "Notes", markdown: "head" }, "agent");
    const rows = revisionRows(page.item.id);
    // The last two saves share one session, so the prefix is one session longer than `ids`.
    const dropped = ids.slice(0, ids.length + 1 - HISTORY_CHECKPOINTS);
    expect(rows.map((row) => row.id)).toEqual(expect.not.arrayContaining(dropped));
    expect(rows).toHaveLength(ids.length - dropped.length + 2);
    expect(rows.find((row) => row.id === ids[dropped.length])?.parentRevisionId).toBeNull();
    expect(rows.find((row) => row.id === head.revision.id)?.parentRevisionId).toBe(mid.revision.id);
    expect(rows.find((row) => row.id === mid.revision.id)?.parentRevisionId).toBe(ids[ids.length - 1]);
    expect(atlasService.getPage(identity)?.conflicts).toEqual([]);
  });
  it("protects embedded files needed by a previous revision", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Visual notes" });
    const image = await atlasService.uploadFile({ accountId: "default", pageId: page.item.id,
      fileName: "photo.png", data: Buffer.from("image bytes").toString("base64") });
    const identity = { accountId: "default", id: page.item.id };
    const blocks = [{ type: "image", props: { url: `atlas-file://${image.id}`, name: "photo.png" } }];
    // An agent save is its own revision, so dropping the image later must not free the file.
    await atlasService.savePage({ ...identity, expectedVersion: 1, title: "Visual notes", blocks }, "agent");
    await atlasService.savePage({ ...identity, expectedVersion: 2, title: "Visual notes", markdown: "Without image" });
    await atlasService.update({ accountId: "default", id: image.id, trashed: true });
    await expect(atlasService.remove({ accountId: "default", id: image.id })).rejects.toThrow("revision history");
    await atlasService.update({ ...identity, trashed: true });
    await atlasService.remove(identity);
    await atlasService.remove({ accountId: "default", id: image.id });
    expect(fs.existsSync(image.path!)).toBe(false);
  });
  it("releases an embedded file dropped during a folded session", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Visual notes" });
    const image = await atlasService.uploadFile({ accountId: "default", pageId: page.item.id,
      fileName: "photo.png", data: Buffer.from("image bytes").toString("base64") });
    const identity = { accountId: "default", id: page.item.id };
    const withImage = await atlasService.savePage({ ...identity, expectedVersion: 1, title: "Visual notes",
      blocks: [{ type: "image", props: { url: `atlas-file://${image.id}`, name: "photo.png" } }] });
    const without = await atlasService.savePage({ ...identity, expectedVersion: 2, title: "Visual notes", markdown: "Without image" });
    expect(without.revision.id).toBe(withImage.revision.id);
    await atlasService.update({ accountId: "default", id: image.id, trashed: true });
    await atlasService.remove({ accountId: "default", id: image.id });
    expect(fs.existsSync(image.path!)).toBe(false);
  });
  it("rejects foreign files, raw local links, invalid blocks, and stale restores", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Notes" });
    createAccount(db, { id: "other" });
    expect(atlasService.getPage({ accountId: "other", id: page.item.id })).toBeNull();
    await expect(atlasService.savePage({ accountId: "default", id: page.item.id, expectedVersion: 1, title: "Notes" })).rejects.toThrow("content is required");
    await expect(atlasService.savePage({ accountId: "default", id: page.item.id, expectedVersion: 1, title: "Notes",
      blocks: [{ type: "image", props: { url: "/private/image.png" } }] })).rejects.toThrow("Upload local files");
    await expect(atlasService.savePage({ accountId: "default", id: page.item.id, expectedVersion: 1, title: "Notes",
      blocks: [{ type: "nonsense" }] })).rejects.toThrow("Unsupported page block");
    await expect(atlasService.restore({ accountId: "default", id: page.item.id, version: 1, expectedVersion: 0 })).rejects.toThrow("changed elsewhere");
    expect(db.select().from(atlasItems).all()).toHaveLength(1);
  });
});
