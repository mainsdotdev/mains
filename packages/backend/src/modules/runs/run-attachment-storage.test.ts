import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../../../test/setup-db";
import { createRun, createRunArtifact } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import { runs, runArtifacts, runAttachments } from "../../db/schema";
import { configureBackendRuntime, getBackendRuntime } from "../../runtime/backend-runtime";
import { runsRepo } from "./runs.repo";
import { startAttachmentMaintenance, stopAttachmentMaintenance } from "./run-attachment-maintenance";
import { attachmentDescriptor, prepareRunAttachments, pruneAttachmentOrphans, pruneUnreferencedAttachments, resolveRunAttachment } from "./run-attachment-storage";
import { pruneAttachmentThumbnails, readAttachmentImage } from "./run-attachment-images";

let db: DatabaseInstance;
let sqlite: Database.Database;
let directory: string;
let cleanup: () => void;
let restoreRuntime: () => void;
vi.mock("../../db/client", () => ({ getDb: () => db, getSqlite: () => sqlite }));

const upload = (name = "screen.png", content = "original") => ({ name, type: "image" as const, mimeType: "image/png", data: Buffer.from(content).toString("base64") });

beforeEach(async () => {
  ({ db, sqlite, cleanup } = createTestDb());
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mains-attachment-test-")));
  const runtime = getBackendRuntime();
  restoreRuntime = configureBackendRuntime({ ...runtime, getPath: () => directory });
});

afterEach(async () => {
  await stopAttachmentMaintenance();
  restoreRuntime();
  cleanup();
  await fs.rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("durable prompt attachments", () => {
  it.each(["chat", "developer", "work"] as const)("stores originals and compact descriptors in %s", async (mode) => {
    const run = createRun(db, { mode });
    const capture = path.join(directory, "browser-captures", "screen.png");
    await fs.mkdir(path.dirname(capture));
    await fs.writeFile(capture, "capture");
    const originals = await prepareRunAttachments(run.id, [
      upload("../screen.png", "first"), upload("screen.png", "second"),
      { name: "spec.pdf", type: "document", mimeType: "application/pdf", data: Buffer.from("%PDF").toString("base64") },
      { name: "notes.txt", type: "document", mimeType: "text/plain", data: Buffer.from("notes").toString("base64") },
      { name: "capture.png", type: "image", mimeType: "image/png", sourcePath: capture },
    ], "message");
    await fs.rm(capture);
    expect(originals).toHaveLength(5);
    expect(new Set(originals!.map((item) => item.sourcePath)).size).toBe(5);
    expect(await Promise.all(originals!.map((item) => fs.readFile(item.sourcePath, "utf8")))).toEqual(["first", "second", "%PDF", "notes", "capture"]);
    for (const item of originals!) {
      expect(item.sourcePath).toBe(path.join(directory, "attachments", item.attachmentId, item.name));
      expect(attachmentDescriptor(item)).not.toHaveProperty("sourcePath");
      expect(attachmentDescriptor(item)).not.toHaveProperty("data");
    }
    const retry = await prepareRunAttachments(run.id, [upload("capture.png")], "next-message");
    expect(retry![0].attachmentId).not.toBe(originals![4].attachmentId);
  });

  it("coalesces retries and keeps same-name queued messages independent", async () => {
    const run = createRun(db);
    const [first, retry] = await Promise.all([
      prepareRunAttachments(run.id, [upload("screen.png", "first")], "first-input"),
      prepareRunAttachments(run.id, [upload("screen.png", "first")], "first-input"),
    ]);
    const second = await prepareRunAttachments(run.id, [upload("screen.png", "second")], "second-input");
    expect(first).toEqual(retry);
    expect(await fs.readFile(first![0].sourcePath, "utf8")).toBe("first");
    expect(await fs.readFile(second![0].sourcePath, "utf8")).toBe("second");
    expect(db.select().from(runAttachments).all()).toHaveLength(2);
  });

  it("keeps a fork's inherited original until its last run is deleted", async () => {
    const parent = createRun(db);
    const fork = createRun(db);
    const [item] = (await prepareRunAttachments(parent.id, [upload()]))!;
    runsRepo.inheritAttachmentRefs(parent.id, fork.id);
    db.update(runs).set({ isArchived: true }).where(eq(runs.id, parent.id)).run();
    await pruneUnreferencedAttachments();
    expect(await fs.readFile(item.sourcePath, "utf8")).toBe("original");
    db.delete(runs).where(eq(runs.id, parent.id)).run();
    await pruneUnreferencedAttachments();
    expect((await resolveRunAttachment(fork.id, item.attachmentId)).path).toBe(item.sourcePath);
    await expect(resolveRunAttachment(parent.id, item.attachmentId)).rejects.toThrow("not found");
    db.delete(runs).where(eq(runs.id, fork.id)).run();
    await pruneUnreferencedAttachments();
    await expect(fs.access(item.sourcePath)).rejects.toThrow();
    expect(db.select().from(runAttachments).all()).toEqual([]);
  });

  it("resolves relative storage keys after the data directory moves", async () => {
    const run = createRun(db);
    const [item] = (await prepareRunAttachments(run.id, [upload()]))!;
    const moved = path.join(directory, "restored-data");
    await fs.mkdir(moved);
    await fs.cp(path.join(directory, "attachments"), path.join(moved, "attachments"), { recursive: true });
    const restore = configureBackendRuntime({ ...getBackendRuntime(), getPath: () => moved });
    try {
      const resolved = await resolveRunAttachment(run.id, item.attachmentId);
      expect(resolved.path).toBe(path.join(moved, "attachments", item.attachmentId, item.name));
      expect(await fs.readFile(resolved.path, "utf8")).toBe("original");
    } finally { restore(); }
  });

  it("leaves no DB reference or pending file when an upload fails", async () => {
    const run = createRun(db);
    await expect(prepareRunAttachments(run.id, [{ ...upload(), data: "!invalid" }])).rejects.toThrow("invalid");
    expect(db.select().from(runAttachments).all()).toEqual([]);
    const root = path.join(directory, "attachments");
    for (const name of await fs.readdir(root)) expect(await fs.readdir(path.join(root, name))).toEqual([]);
  });

  it("removes old orphans while preserving recent and referenced originals", async () => {
    const run = createRun(db);
    const [item] = (await prepareRunAttachments(run.id, [upload()]))!;
    const root = path.join(directory, "attachments");
    const old = path.join(root, "a".repeat(64));
    const recent = path.join(root, "b".repeat(64));
    await fs.mkdir(old); await fs.mkdir(recent);
    const past = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await fs.utimes(old, past, past);
    await pruneAttachmentOrphans();
    await expect(fs.access(old)).rejects.toThrow();
    await fs.access(recent); await fs.access(item.sourcePath);
  });
});

describe("attachment maintenance", () => {
  it("leaves existing prompts unchanged while retaining new attachments in the same conversation", async () => {
    const run = createRun(db);
    const legacy = JSON.stringify({ attachments: [
      { name: "image.png", type: "image", mimeType: "image/png", dataUrl: `data:image/png;base64,${upload().data}` },
      { name: "missing.pdf", type: "document", mimeType: "application/pdf", path: "/missing.pdf" },
    ] });
    const oldPrompt = createRunArtifact(db, { runId: run.id, kind: "user-prompt" as "file", metadata: legacy });
    const [item] = (await prepareRunAttachments(run.id, [upload("new.png")]))!;
    const metadata = { attachments: [attachmentDescriptor(item)] };
    const newPrompt = createRunArtifact(db, { runId: run.id, kind: "user-prompt" as "file", metadata: JSON.stringify(metadata) });
    const backup = vi.spyOn(sqlite, "backup");

    startAttachmentMaintenance();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await stopAttachmentMaintenance();

    expect(db.select().from(runArtifacts).where(eq(runArtifacts.id, oldPrompt.id)).get()!.metadata).toBe(legacy);
    expect(backup).not.toHaveBeenCalled();
    expect(db.select().from(runAttachments).all()).toHaveLength(1);
    expect(await fs.readFile((await resolveRunAttachment(run.id, item.attachmentId)).path, "utf8")).toBe("original");
    const delta = await runsRepo.findArtifactsByRun(run.id, oldPrompt.id);
    expect(delta.map((artifact) => artifact.id)).toEqual([newPrompt.id]);
    expect(delta[0].metadata).toEqual(metadata);
    expect(await runsRepo.findArtifactsByRun(run.id, newPrompt.id)).toEqual([]);
  });
});

describe("bounded attachment previews", () => {
  it("deduplicates thumbnails, serializes decodes, caps expanded size and evicts only cache files", async () => {
    const run = createRun(db);
    const items = (await prepareRunAttachments(run.id, [upload("a.png"), upload("b.png")]))!;
    let decoding = 0;
    let peak = 0;
    const codec = vi.fn(async (_bytes: Buffer, maxSide: number) => {
      peak = Math.max(peak, ++decoding);
      await new Promise<void>((resolve) => setImmediate(resolve));
      decoding--;
      return { jpeg: Buffer.alloc(100), width: maxSide, height: Math.max(1, maxSide / 2) };
    });
    const restore = configureBackendRuntime({ ...getBackendRuntime(), imagePreview: { resizeToJpeg: codec } });
    try {
      const request = (id: string, maxSide?: number) => readAttachmentImage({ runId: run.id, attachmentId: id, maxSide });
      const [first, duplicate, second] = await Promise.all([request(items[0].attachmentId), request(items[0].attachmentId), request(items[1].attachmentId)]);
      expect(first).toEqual(duplicate); expect(second.width).toBe(256);
      expect(codec).toHaveBeenCalledTimes(2); expect(peak).toBe(1);
      await request(items[0].attachmentId);
      expect(codec).toHaveBeenCalledTimes(2);
      expect((await request(items[0].attachmentId, 9999)).width).toBe(1600);
      const unrelated = createRun(db);
      await expect(readAttachmentImage({ runId: unrelated.id, attachmentId: items[0].attachmentId })).rejects.toThrow("not found");
      await pruneAttachmentThumbnails(0);
      for (const item of items) expect(await fs.readFile(item.sourcePath, "utf8")).toBe("original");
      await request(items[0].attachmentId);
      expect(codec).toHaveBeenCalledTimes(4);
    } finally { restore(); }
  });

  it("never returns original bytes if an image cannot be decoded", async () => {
    const run = createRun(db);
    const [item] = (await prepareRunAttachments(run.id, [upload()]))!;
    const restore = configureBackendRuntime({ ...getBackendRuntime(), imagePreview: { resizeToJpeg: async () => null } });
    try {
      await expect(readAttachmentImage({ runId: run.id, attachmentId: item.attachmentId })).rejects.toThrow("cannot be previewed");
      expect(await fs.readFile(item.sourcePath, "utf8")).toBe("original");
    } finally { restore(); }
  });
});
