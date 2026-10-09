import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { RunOutputFile } from "@mains/contracts/runs";
import { createTestDb } from "../../../test/setup-db";
import { createAccount, createRun, createRunArtifact } from "../../../test/factories";
import { installTestBackendRuntime } from "../../../test/backend-runtime";
import type { DatabaseInstance } from "../../db/types";
import { atlasItems, atlasPageRevisions, runs } from "../../db/schema";

let db: DatabaseInstance;
let directory: string;
let cleanup: () => void;
let restoreRuntime: () => void;
const root = (id: string, mode = "work") => path.join(directory, "runs", id, mode);
vi.mock("../../db/client", () => ({ getDb: () => db }));
// Keep the integration focused on Atlas' real SQLite/storage boundary.
vi.mock("../runs", () => ({ runsService: {
  getRunById: async (id: string) => db.select().from(runs).where(eq(runs.id, id)).get() ?? null,
  getRunExecutionRoot: async (id: string) => {
    const run = db.select().from(runs).where(eq(runs.id, id)).get();
    return root(id, run?.mode ?? "work");
  },
  listRunOutputFiles: vi.fn(async (_id: string): Promise<RunOutputFile[]> => []),
  getOutputArtifacts: async (id: string) => {
    const { runsRepo } = await import("../runs/runs.repo");
    const { projectRunDeliverables } = await import("../runs/run-deliverables");
    const run = await runsRepo.findRunById(id);
    if (!run) return [];
    return projectRunDeliverables({ runId: id, artifacts: await runsRepo.findArtifactsByRun(id),
      toolCalls: await runsRepo.findToolCallsByRun(id), turns: await runsRepo.findTurnsByRun(id),
      terminal: run.status === "succeeded", root: root(id, run.mode),
      extraRoots: [path.join(directory, "generated-images", id),
        ...(run.sessionId ? [path.join(directory, ".codex", "generated_images", run.sessionId)] : [])] });
  },
  listRunAttachmentFiles: async (id: string) => {
    const { listRunAttachmentFiles } = await import("../runs/run-attachment-storage");
    return listRunAttachmentFiles(id);
  },
} }));
import { atlasService } from "./atlas.service";
import { prepareRunAttachments } from "../runs/run-attachment-storage";
import { handleAtlasCreatePage, handleAtlasReadPage, handleAtlasUpdatePage } from "../providers/adapters/atlas-tools";

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
  it("uses the same tail-selected, deduplicated outputs as the conversation", async () => {
    const file = output("final.md");
    const early = path.join(root("conversation"), "CONTEXT.md"); fs.writeFileSync(early, "project context");
    createRunArtifact(db, { runId: "conversation", kind: "document", metadata: JSON.stringify({ path: early }) });
    createRunArtifact(db, { runId: "conversation", kind: "report", content: `[Early](<${early}>)` });
    createRunArtifact(db, { runId: "conversation", kind: "report", content: "Working" });
    createRunArtifact(db, { runId: "conversation", kind: "report", content: `[Delivered](<${file}>) [Again](./final.md)` });
    createRunArtifact(db, { runId: "conversation", kind: "report", content: "Done" });
    const { runsService } = await import("../runs");
    const selected = (await runsService.getOutputArtifacts("conversation")).filter((row) => row.metadata?.outputSelected);
    const generated = await atlasService.generated({ accountId: "default" });
    expect(selected).toHaveLength(1);
    expect(generated.items.map((item) => item.path)).toEqual(selected.map((row) => row.path));
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
  it("projects and saves Codex images from the run's native thread folder", async () => {
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
    createRunArtifact(db, { runId: "codex-run", kind: "image", path: unrelated });
    const result = await atlasService.generated({ accountId: "default" });
    expect(result.items.map((item) => item.path)).toEqual([fs.realpathSync(registered)]);
    expect(atlasService.list({ accountId: "default" })).toEqual([]);
    const saved = await atlasService.saveFile({ accountId: "default", runId: "codex-run", path: registered });
    expect(fs.readFileSync(saved.path!, "utf8")).toBe("generated image");
    await expect(atlasService.saveFile({ accountId: "default", runId: "codex-run", path: unrelated })).rejects.toThrow("outside");
  });
  it("retains explicit native image-generation results when Codex returns inline pixels", async () => {
    createRun(db, { id: "inline-image", providerId: "codex", mode: "work", status: "succeeded" });
    const image = path.join(directory, "generated-images", "inline-image", "generated.png");
    fs.mkdirSync(path.dirname(image), { recursive: true });
    fs.writeFileSync(image, "native image output");
    createRunArtifact(db, { runId: "inline-image", kind: "image", path: image,
      metadata: JSON.stringify({ path: image, source: "codex_image_generation" }) });
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
    expect(atlasService.list({ accountId: "default" })).toEqual([]);
    const saved = await atlasService.saveFile({ accountId: "default", runId: "uploads", path: attachment.sourcePath });
    expect(fs.readFileSync(saved.path!, "utf8")).toBe("uploaded original");
    fs.unlinkSync(attachment.sourcePath);
    expect((await atlasService.generated({ accountId: "default" })).items).toEqual([]);
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

    await atlasService.savePage({ ...identity, expectedVersion: 1, title: "Notes", markdown: "## Today\n- [x] New task" });
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
      atlasService.savePage({ ...identity, expectedVersion: 1, title: "Updated", markdown: "New content" }),
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
    expect(atlasService.revisions(identity)).toHaveLength(3);
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
    const results = await Promise.allSettled([atlasService.savePage(update), atlasService.savePage(update, "agent")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const restored = await atlasService.restore({ accountId: "default", id: page.item.id, expectedVersion: 2, version: 1 });
    expect(restored.item.version).toBe(3);
    expect(restored.revision.blocks).toEqual(page.revision.blocks);
    expect(restored.item.title).toBe("Notes");
    expect(atlasService.revisions({ accountId: "default", id: page.item.id }).map((row) => row.version)).toEqual([3, 2, 1]);
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
