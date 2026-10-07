import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AtlasCreatePage, AtlasGeneratedOptions, AtlasGeneratedFile, AtlasIdentity,
  AtlasItem, AtlasListItem, AtlasListOptions, AtlasPage, AtlasPageRevision, AtlasSaveFile, AtlasSavePage, AtlasUpdateItem,
  AtlasUploadFile } from "@mains/contracts/atlas";
import { collectionsService } from "../collections";
import { getBackendRuntime } from "../../runtime/backend-runtime";
import { atlasRepo, type AtlasRecord, type RevisionRecord } from "./atlas.repo";
import { pageContent } from "./atlas.blocks";
import { metadataPatch, readMetadata } from "./atlas.metadata";
import { atlasRoot, fileHash, inspectSource, readSource, removeFiles, safeName, sourceKey, storagePath, writeFile } from "./atlas.storage";

const pendingSaves = new Map<string, Promise<AtlasItem>>();
const IMAGE_MIMES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", gif: "image/gif", avif: "image/avif", svg: "image/svg+xml" };
const FILE_MIMES: Record<string, string> = { pdf: "application/pdf", md: "text/markdown", markdown: "text/markdown",
  txt: "text/plain", csv: "text/csv", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
function classify(file: string) {
  const extension = path.extname(file).slice(1).toLowerCase();
  if (IMAGE_MIMES[extension]) return { kind: "image" as const, mimeType: IMAGE_MIMES[extension] };
  if (FILE_MIMES[extension]) return { kind: "file" as const, mimeType: FILE_MIMES[extension] };
  return null;
}
function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || value.includes("\0"))
    throw new Error(`${label} is required`);
  return value.trim();
}
function title(value: unknown) {
  const text = required(value, "Title");
  if (text.length > 240) throw new Error("Title must be 240 characters or fewer");
  return text;
}
function identity(input: AtlasIdentity) {
  return { id: required(input?.id, "Atlas item ID"), accountId: required(input?.accountId, "Account") };
}
function owned(input: AtlasIdentity) {
  const { id, accountId } = identity(input);
  const item = atlasRepo.find(id, accountId);
  if (!item) throw new Error("Atlas item not found");
  return item;
}
function format(row: AtlasRecord): AtlasItem {
  const { storageKey, contentHash: _hash, ...item } = row;
  return { ...item, metadata: readMetadata(row.metadata), path: storageKey ? storagePath(storageKey) : null,
    trashedAt: row.trashedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
function revision(row: RevisionRecord): AtlasPageRevision {
  const { blocksJson, ...rest } = row;
  return { ...rest, blocks: JSON.parse(blocksJson), createdAt: row.createdAt.toISOString() };
}
function pageFor(item: AtlasRecord): AtlasPage {
  if (item.kind !== "page") throw new Error("Atlas item is not a page");
  const current = atlasRepo.revision(item.id, item.version);
  if (!current) throw new Error("Page revision not found");
  return { item: format(item), revision: revision(current) };
}
async function collection(id: string | null | undefined, accountId: string) {
  if (!id) return null;
  const value = await collectionsService.get({ id: required(id, "Project"), accountId });
  if (!value || value.isArchived) throw new Error("Project not found or archived");
  return id;
}
async function requirePageFiles(ids: string[], accountId: string) {
  for (const id of ids) {
    const file = owned({ id, accountId });
    if (!file.storageKey || file.kind === "page") throw new Error("Embedded Atlas file not found");
    const stats = await fs.lstat(storagePath(file.storageKey));
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("Embedded Atlas file is missing");
  }
}
async function runContext(runId: string, accountId: string) {
  // Lazy seam: provider tools also call Atlas while runs owns their lifecycle.
  const { runsService } = await import("../runs");
  const run = await runsService.getRunById(required(runId, "Conversation"));
  if (!run || run.accountId !== accountId) throw new Error("Conversation not found");
  const root = await runsService.getRunExecutionRoot(runId);
  const imageRoot = path.join(getBackendRuntime().getPath("userData"), "generated-images", runId);
  // Codex's native image files are outside the execution cwd. Admit only this
  // account-owned run's thread, never the shared directory of all Codex threads.
  const codexImages = run.providerId === "codex" && run.sessionId && /^[\w-]+$/.test(run.sessionId)
    ? path.join(os.homedir(), ".codex", "generated_images", run.sessionId) : null;
  const attachments = await runsService.listRunAttachmentFiles(runId);
  return { run, runsService, codexImages, attachments,
    roots: [...(root ? [root] : []), imageRoot, ...(codexImages ? [codexImages] : []),
      ...attachments.map((file) => path.dirname(file.path))] };
}
async function generatedForRun(runId: string, accountId: string): Promise<AtlasGeneratedFile[]> {
  const { run, runsService, roots, codexImages, attachments } = await runContext(runId, accountId);
  const candidates = new Set<string>();
  for (const artifact of atlasRepo.generatedArtifacts(runId)) {
    let metadata: Record<string, unknown> = {};
    try { metadata = artifact.metadata ? JSON.parse(artifact.metadata) : {}; } catch { /* Legacy metadata. */ }
    if (metadata.working || metadata.viewed) continue;
    const file = typeof metadata.path === "string" ? metadata.path : artifact.path;
    if (!file) continue;
    const resolved = path.isAbsolute(file) ? file : path.resolve(roots[0], file);
    // Mentioned paths belong to the transcript, not the image library. Keep
    // native generation results, including Codex's inline-image fallback.
    if (classify(resolved)?.kind === "image" && metadata.source !== "codex_image_generation") continue;
    candidates.add(resolved);
  }
  // Run-folder discovery supplies documents; native image discovery is below.
  for (const file of await runsService.listRunOutputFiles(runId)) {
    if (classify(file.absolutePath)?.kind === "file") candidates.add(file.absolutePath);
  }
  if (codexImages) {
    try {
      const stat = await fs.lstat(codexImages);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        // Native generations are flat within the thread folder. Keep discovery
        // bounded and avoid scanning ~/.codex or other sessions recursively.
        const directory = await fs.opendir(codexImages);
        let visited = 0;
        for await (const entry of directory) {
          if (entry.isFile() && IMAGE_MIMES[path.extname(entry.name).slice(1).toLowerCase()])
            candidates.add(path.join(codexImages, entry.name));
          if (++visited >= 200) break;
        }
      }
    } catch { /* Older or remote sessions may not have a local native folder. */ }
  }
  const uploads = new Set(attachments.map((file) => file.path));
  for (const file of uploads) candidates.add(file);
  const result: AtlasGeneratedFile[] = [];
  for (const file of candidates) {
    const type = classify(file);
    if (!type) continue;
    // Renderer exports and Office preview sidecars are not independent deliverables.
    if (!uploads.has(file) && (/(?:^|\/)(?:rendered|renders|previews|thumbnails)(?:\/|$)/i.test(file) || /\.rendered\./i.test(file))) continue;
    try {
      const { real, stats } = await inspectSource(file, roots);
      result.push({ sourceKey: sourceKey(runId, real), runId, runTitle: run.title ?? "Conversation",
        origin: uploads.has(file) ? "attachment" : "generated",
        collectionId: run.collectionId, ...type, path: real, fileName: path.basename(real),
        byteSize: stats.size, modifiedAt: stats.mtime.toISOString() });
    } catch { /* Missing/incomplete files and symlinks are excluded from the projection. */ }
  }
  return [...new Map(result.map((item) => [item.sourceKey, item])).values()];
}
async function store(accountId: string, key: string, name: string, bytes: Buffer,
  sourceRunId: string | null, collectionId: string | null) {
  const previous = atlasRepo.bySource(accountId, key);
  if (previous) {
    if (previous.trashedAt) atlasRepo.update(previous.id, accountId, { trashedAt: null });
    return format(owned({ id: previous.id, accountId }));
  }
  const id = randomUUID();
  const type = classify(name);
  if (!type) throw new Error("Unsupported Atlas file type");
  const storageKey = await writeFile(id, name, bytes);
  try {
    atlasRepo.insert({ id, accountId, ...type, title: name, fileName: name, storageKey,
      byteSize: bytes.length, contentHash: fileHash(bytes), sourceRunId, sourceKey: key, collectionId });
    return format(owned({ id, accountId }));
  } catch (error) { await removeFiles(id); throw error; }
}
function once(key: string, action: () => Promise<AtlasItem>) {
  const existing = pendingSaves.get(key);
  if (existing) return existing;
  const promise = action().finally(() => pendingSaves.delete(key));
  pendingSaves.set(key, promise);
  return promise;
}

export const atlasService = {
  list(options: AtlasListOptions): AtlasListItem[] {
    const includePreview = options?.includePagePreview === true;
    return atlasRepo.list(required(options?.accountId, "Account"), includePreview)
      .map(({ item, preview }) => ({ ...format(item),
        ...(includePreview && item.kind === "page" ? { preview: preview ?? "" } : {}) }));
  },
  async generated(options: AtlasGeneratedOptions) {
    const accountId = required(options?.accountId, "Account");
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 25;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Invalid Atlas pagination");
    if (options.collectionId) await collection(options.collectionId, accountId);
    const rows = atlasRepo.generatedRuns(accountId, offset, limit + 1, options.collectionId);
    const items: AtlasGeneratedFile[] = [];
    // Four filesystem walks at a time, rather than one walk for every conversation.
    for (let i = 0; i < Math.min(rows.length, limit); i += 4) {
      const batch = await Promise.all(rows.slice(i, Math.min(i + 4, limit))
        .map((run) => generatedForRun(run.id, accountId)));
      items.push(...batch.flat());
    }
    return { items: items.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)),
      nextOffset: rows.length > limit ? offset + limit : null };
  },
  get(options: AtlasIdentity): AtlasItem | null {
    const { id, accountId } = identity(options);
    const item = atlasRepo.find(id, accountId);
    return item ? format(item) : null;
  },
  getPage(options: AtlasIdentity): AtlasPage | null {
    const { id, accountId } = identity(options);
    const item = atlasRepo.find(id, accountId);
    return item ? pageFor(item) : null;
  },
  async createPage(input: AtlasCreatePage, actor: "user" | "agent" = "user", sourceRunId: string | null = null) {
    const accountId = required(input?.accountId, "Account");
    const name = title(input?.title);
    const collectionId = await collection(input.collectionId, accountId);
    const content = await pageContent(input);
    await requirePageFiles(content.fileIds, accountId);
    const id = randomUUID();
    const item = { id, accountId, kind: "page" as const, title: name, collectionId, version: 1, sourceRunId };
    atlasRepo.commitPage(item, { id: randomUUID(), itemId: id, title: name, version: 1,
      blocksJson: JSON.stringify(content.blocks), markdown: content.markdown, actor, sourceRunId }, 0, content.fileIds, true);
    return pageFor(owned({ id, accountId }));
  },
  async savePage(input: AtlasSavePage, actor: "user" | "agent" = "user", sourceRunId: string | null = null) {
    const item = owned(input);
    if (item.kind !== "page" || item.trashedAt) throw new Error("Page is in Trash or unavailable");
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion !== item.version)
      throw new Error("This page changed elsewhere. Reload the latest version before saving.");
    if (input.blocks === undefined && input.markdown === undefined) throw new Error("Page content is required");
    const name = title(input.title);
    const content = await pageContent(input);
    await requirePageFiles(content.fileIds, item.accountId);
    const current = atlasRepo.revision(item.id, item.version);
    if (current?.blocksJson === JSON.stringify(content.blocks) && name === item.title) return pageFor(owned(input));
    atlasRepo.commitPage({ ...item, title: name }, { id: randomUUID(), itemId: item.id, title: name,
      version: item.version + 1, blocksJson: JSON.stringify(content.blocks), markdown: content.markdown,
      actor, sourceRunId }, input.expectedVersion, content.fileIds);
    return pageFor(owned(input));
  },
  revisions(options: AtlasIdentity) {
    const item = owned(options);
    if (item.kind !== "page") throw new Error("Atlas item is not a page");
    return atlasRepo.revisions(item.id).map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  },
  async restore(input: AtlasIdentity & { version: number; expectedVersion: number }) {
    const item = owned(input);
    const older = atlasRepo.revision(item.id, input.version);
    if (!older) throw new Error("Page revision not found");
    return this.savePage({ ...input, title: older.title, blocks: JSON.parse(older.blocksJson) });
  },
  async saveFile(input: AtlasSaveFile) {
    const accountId = required(input?.accountId, "Account");
    const requested = required(input?.path, "File path");
    const context = await runContext(input.runId, accountId);
    const { real } = await inspectSource(requested, context.roots);
    const key = sourceKey(input.runId, real);
    return once(`${accountId}:${key}`, async () => {
      const old = atlasRepo.bySource(accountId, key);
      if (old) {
        if (old.trashedAt) atlasRepo.update(old.id, accountId, { trashedAt: null });
        return format(owned({ id: old.id, accountId }));
      }
      const generated = await generatedForRun(input.runId, accountId);
      if (!generated.some((file) => file.sourceKey === key)) throw new Error("File is not a generated output of this conversation");
      const bytes = await readSource(real, context.roots);
      return store(accountId, key, safeName(path.basename(real)), bytes, input.runId, context.run.collectionId);
    });
  },
  async uploadFile(input: AtlasUploadFile) {
    const page = owned({ id: input.pageId, accountId: input.accountId });
    if (page.kind !== "page" || page.trashedAt) throw new Error("Page unavailable");
    const name = safeName(required(input.fileName, "File name"));
    if (typeof input.data !== "string" || input.data.length > 28 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))
      throw new Error("Invalid Page file (maximum 20 MB)");
    const bytes = Buffer.from(input.data, "base64");
    if (bytes.length > 20 * 1024 * 1024) throw new Error("Page file exceeds the 20 MB limit");
    const key = `page:${page.id}:${fileHash(bytes)}:${name}`;
    return once(`${page.accountId}:${key}`, () => store(page.accountId, key, name, bytes, null, page.collectionId));
  },
  async update(input: AtlasUpdateItem) {
    const item = owned(input);
    if (item.kind === "page" && input.title !== undefined) throw new Error("Rename a Page through its editor");
    const fields: Partial<AtlasRecord> = {};
    const metadata = input.metadata === undefined ? undefined : metadataPatch(input.metadata);
    if (metadata !== undefined) {
      if (item.kind !== "page" || item.trashedAt) throw new Error("Page unavailable");
      if (metadata?.coverFileId) {
        const cover = owned({ id: metadata.coverFileId, accountId: item.accountId });
        if (cover.kind !== "image" || !cover.storageKey || cover.trashedAt)
          throw new Error("Page cover image is unavailable");
        await requirePageFiles([cover.id], item.accountId);
      }
    }
    if (input.title !== undefined) fields.title = title(input.title);
    if (input.collectionId !== undefined) fields.collectionId = await collection(input.collectionId, item.accountId);
    if (input.isFavorite !== undefined) {
      if (typeof input.isFavorite !== "boolean") throw new Error("Invalid favorite state");
      fields.isFavorite = input.isFavorite;
    }
    if (input.trashed !== undefined) {
      if (typeof input.trashed !== "boolean") throw new Error("Invalid Trash state");
      fields.trashedAt = input.trashed ? new Date() : null;
    }
    atlasRepo.update(item.id, item.accountId, fields, metadata);
    return format(owned(input));
  },
  async remove(input: AtlasIdentity) {
    const item = owned(input);
    if (!item.trashedAt) throw new Error("Move this item to Trash before deleting it");
    // Deletion checks current covers and revision references in one transaction.
    atlasRepo.remove(item.id, item.accountId);
    if (item.storageKey) await removeFiles(item.id);
  },
  async isStoredFile(realPath: string) {
    if (!path.isAbsolute(realPath)) return false;
    try {
      const root = await fs.realpath(atlasRoot());
      const key = path.relative(root, realPath).split(path.sep).join("/");
      const item = atlasRepo.byStorageKey(key);
      return !!item && await fs.realpath(storagePath(key)) === realPath;
    } catch { return false; }
  },
};
