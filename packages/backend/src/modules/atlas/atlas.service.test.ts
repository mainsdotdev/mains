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
import { atlasItems, atlasPageRevisions, collections, runAttachmentRefs, runAttachments, runs } from "../../db/schema";
import { ownershipOf } from "../bridge/bridge.ownership";
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

function output(name = "report.pdf", runId = "conversation") {
  createRun(db, { id: runId, mode: "work", title: "Research", status: "succeeded" });
  fs.mkdirSync(root(runId), { recursive: true });
  const file = path.join(root(runId), name);
  fs.writeFileSync(file, "original contents");
  createRunArtifact(db, { runId, kind: name.endsWith(".png") ? "image" : "document",
    metadata: JSON.stringify({ path: file }) });
  createRunArtifact(db, { runId, kind: "report", content: `[Output](<${file}>)` });
  return file;
}
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
  it.each(["work", "chat"] as const)("shows only delivered files in a %s folder", async (mode) => {
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
    expect(result.items.map((item) => item.fileName).sort()).toEqual(["report.pdf", "summary.txt"]);
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
  it("keeps repository files cited by a Code conversation out of the library unless it delivered them", async () => {
    createRun(db, { id: "code", mode: "developer", title: "MAI-295", status: "succeeded" });
    const folder = root("code", "developer");
    fs.mkdirSync(folder, { recursive: true });
    const cited = path.join(folder, "CONTEXT.md");
    const delivered = path.join(folder, "summary.pdf");
    fs.writeFileSync(cited, "project context");
    fs.writeFileSync(delivered, "report");
    createRunArtifact(db, { runId: "code", kind: "document", metadata: JSON.stringify({ path: delivered, outputRole: "deliverable" }) });
    createRunArtifact(db, { runId: "code", kind: "report", content: `Updated [CONTEXT.md](<${cited}>) and [summary](<${delivered}>)`,
      metadata: JSON.stringify({ messagePhase: "final_answer" }) });
    const [attachment] = (await prepareRunAttachments("code", [{ name: "screen.png", type: "image",
      mimeType: "image/png", data: Buffer.from("uploaded original").toString("base64") }]))!;

    const library = await atlasService.library({ accountId: "default", scope: "all" });
    expect(library.items.map((entry) => entry.title).sort()).toEqual(["screen.png", "summary.pdf"]);
    // The conversation's own file card still offers every selected output.
    const generated = await atlasService.generated({ accountId: "default" });
    expect(generated.items.map((item) => item.fileName)).toContain("CONTEXT.md");
    await expect(atlasService.saveFile({ accountId: "default", runId: "code", path: cited })).resolves.toMatchObject({ title: "CONTEXT.md" });
    expect(fs.existsSync(attachment.sourcePath)).toBe(true);
  });
  it("applies the same Code-conversation rule to another device's synced outputs", async () => {
    createRun(db, { id: "replica-code", title: "MAI-296", ownerBackendId: "laptop", mode: "developer" });
    const output = (id: number, name: string, metadata: object) => ({ id, runId: "replica-code", kind: "document", path: null,
      content: "", blobData: null, entityId: null, contentHash: null, createdAt: new Date("2026-10-17T10:00:00Z"),
      metadata: { outputSelected: true, path: `/Users/laptop/repo/${name}`, fileName: name, byteSize: 10, ...metadata } });
    replicaOutputs.set("replica-code", [output(-1, "CLAUDE.md", {}), output(-2, "brief.pdf", { outputRole: "deliverable" })]);
    try {
      expect((await atlasService.library({ accountId: "default", scope: "generated" })).items.map((entry) => entry.title)).toEqual(["brief.pdf"]);
    } finally { replicaOutputs.delete("replica-code"); }
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
    createRun(db, { id: "uploads", mode: "chat" });
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
    createRun(db, { id: "annotations" });
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
    createRun(db, { id: "annotation-source" });
    createRun(db, { id: "annotation-fork" });
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
    createRun(db, { id: "hash-uploads" });
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
  it("paginates conversations including older generated files", async () => {
    output("one.pdf", "first"); output("two.pdf", "second");
    const first = await atlasService.generated({ accountId: "default", limit: 1 });
    const second = await atlasService.generated({ accountId: "default", limit: 1, offset: first.nextOffset! });
    expect(first.items).toHaveLength(1); expect(second.items).toHaveLength(1);
    expect(first.items[0].sourceKey).not.toBe(second.items[0].sourceKey);
    expect(second.nextOffset).toBeNull();
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
  it("never rewrites or prunes a replicated revision", async () => {
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
    // History groups each author's saves into one entry, but nothing is deleted from a replicated Page.
    expect(revisionRows(page.item.id)).toHaveLength(4);
    expect(atlasService.revisions(identity).map((row) => row.id)).toEqual([last.revision.id, next.revision.id]);
  });
  it("protects embedded files needed by a previous revision", async () => {
    const page = await atlasService.createPage({ accountId: "default", title: "Visual notes" });
    const image = await atlasService.uploadFile({ accountId: "default", pageId: page.item.id,
      fileName: "photo.png", data: Buffer.from("image bytes").toString("base64") });
    await atlasService.savePage({ accountId: "default", id: page.item.id, expectedVersion: 1, title: "Visual notes",
      blocks: [{ type: "image", props: { url: `atlas-file://${image.id}`, name: "photo.png" } }] });
    await atlasService.savePage({ accountId: "default", id: page.item.id, expectedVersion: 2, title: "Visual notes", markdown: "Without image" });
    await atlasService.update({ accountId: "default", id: image.id, trashed: true });
    await expect(atlasService.remove({ accountId: "default", id: image.id })).rejects.toThrow("revision history");
    await atlasService.update({ accountId: "default", id: page.item.id, trashed: true });
    await atlasService.remove({ accountId: "default", id: page.item.id });
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
