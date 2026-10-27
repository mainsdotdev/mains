import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AtlasCreatePage, AtlasGeneratedOptions, AtlasGeneratedFile, AtlasIdentity,
  AtlasItem, AtlasLibraryEntry, AtlasLibraryOptions, AtlasLibraryPage, AtlasListItem, AtlasListOptions, AtlasPage, AtlasPageRevision, AtlasSaveFile, AtlasSavePage, AtlasUpdateItem,
  AtlasUploadFile, AtlasResolveConflict, AtlasMetadataPatch } from "@mains/contracts/atlas";
import { CHANNELS } from "@mains/contracts/channels";
import { emit } from "../../ipc-kit/event-bus";
import { ATLAS_LIBRARY_PAGE_SIZE } from "@mains/contracts/atlas";
import { collectionsService } from "../collections";
import { bridgeService } from "../bridge";
import { getBackendRuntime } from "../../runtime/backend-runtime";
import { atlasRepo, type AtlasRecord, type RevisionRecord } from "./atlas.repo";
import { pageContent } from "./atlas.blocks";
import { continuesSession, historyCheckpoints } from "./atlas.history";
import { metadataPatch, readMetadata } from "./atlas.metadata";
import { ATLAS_COVER_SOURCE_PREFIX, coverPreset, isCoverId } from "@mains/contracts/atlas-covers";
import { readCoverPreset } from "./atlas.covers";
import { atlasRoot, fileHash, imageContentHash, inspectSource, readSource, removeFiles, restoreFile, safeName, sourceKey, storagePath, writeFile } from "./atlas.storage";

interface PagePresentation {
  metadata?: AtlasMetadataPatch | null;
  coverPreset?: string | null;
}

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
  const metadata = readMetadata(row.metadata);
  if (metadata?.coverFileId) metadata.coverFileId = atlasRepo.find(metadata.coverFileId, row.accountId)?.id ?? metadata.coverFileId;
  return { ...item, metadata, path: storageKey ? storagePath(storageKey) : null,
    trashedAt: row.trashedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
function revision(row: RevisionRecord): AtlasPageRevision {
  const { blocksJson, ...rest } = row;
  return { ...rest, ...atlasRepo.provenance(row.id), blocks: JSON.parse(blocksJson), createdAt: row.createdAt.toISOString() };
}
function pageFor(item: AtlasRecord): AtlasPage {
  if (item.kind !== "page") throw new Error("Atlas item is not a page");
  const current = item.currentRevisionId ? atlasRepo.revisionById(item.id, item.currentRevisionId) : null;
  if (!current) throw new Error("Page revision not found");
  return { item: format(item), revision: revision(current), conflicts: atlasRepo.conflicts(item.id, current.id)
    .map((row) => { const { blocks: _blocks, markdown: _markdown, ...summary } = revision(row); return summary; }) };
}
/**
 * Keep only what history shows. Replicated Pages are skipped inside the repo: their revisions are frozen
 * because other backends may build on them. Best effort, since a failed cleanup must never fail a save.
 */
function pruneHistory(item: AtlasRecord) {
  try {
    if (item.kind !== "page" || !item.currentRevisionId || atlasRepo.anyReplicated(item.id)) return;
    const rows = atlasRepo.revisions(item.id, -1);
    const pinned = new Set([item.currentRevisionId, ...atlasRepo.conflicts(item.id, item.currentRevisionId).map((row) => row.id)]);
    const kept = new Set(historyCheckpoints(rows, pinned).map((row) => row.id));
    const drop = rows.filter((row) => !kept.has(row.id)).map((row) => row.id);
    if (!drop.length) return;
    const byId = new Map(rows.map((row) => [row.id, row]));
    const survivor = (start: string | null) => {
      for (let id = start, steps = 0; id && steps <= rows.length; id = byId.get(id)?.parentRevisionId ?? null, steps++)
        if (kept.has(id)) return id;
      return null;
    };
    const relink = rows.filter((row) => kept.has(row.id)).flatMap((row) => {
      const parentRevisionId = survivor(row.parentRevisionId), mergedRevisionId = survivor(row.mergedRevisionId);
      return parentRevisionId === row.parentRevisionId && mergedRevisionId === row.mergedRevisionId ? []
        : [{ id: row.id, parentRevisionId, mergedRevisionId }];
    });
    atlasRepo.prune(item.id, drop, relink);
  } catch (error) {
    console.warn("[Atlas] Could not prune page history:", error);
  }
}
async function collection(id: string | null | undefined, accountId: string) {
  if (!id) return null;
  const value = await collectionsService.get({ id: required(id, "Project"), accountId });
  if (!value || value.isArchived) throw new Error("Project not found or archived");
  return id;
}
async function requirePageFiles(ids: string[], accountId: string) {
  const canonical: string[] = [];
  for (const id of ids) {
    const file = owned({ id, accountId });
    if (!file.storageKey || file.kind === "page") throw new Error("Embedded Atlas file not found");
    try {
      const stats = await fs.lstat(storagePath(file.storageKey));
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("Embedded Atlas file is missing");
    } catch (error) {
      // References are metadata. An authenticated immutable manifest is enough
      // to edit offline without downloading every historical embed again.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !atlasRepo.hasFileManifest(file.id)) throw error;
    }
    canonical.push(file.id);
  }
  return [...new Set(canonical)];
}
async function runContext(runId: string, accountId: string) {
  // Lazy seam: provider tools also call Atlas while runs owns their lifecycle.
  const { runsService } = await import("../runs");
  const run = await runsService.getRunById(required(runId, "Conversation"));
  if (!run || run.accountId !== accountId) throw new Error("Conversation not found");
  const root = run.isReplica ? null : await runsService.getRunExecutionRoot(runId);
  const imageRoot = path.join(getBackendRuntime().getPath("userData"), "generated-images", runId);
  // Codex's native image files are outside the execution cwd. Admit only this
  // account-owned run's thread, never the shared directory of all Codex threads.
  const codexImages = !run.isReplica && run.providerId === "codex" && run.sessionId && /^[\w-]+$/.test(run.sessionId)
    ? path.join(os.homedir(), ".codex", "generated_images", run.sessionId) : null;
  const attachments = run.isReplica ? [] : await runsService.listRunAttachmentFiles(runId);
  return { run, runsService, codexImages, attachments,
    roots: [...(root ? [root] : []), imageRoot, ...(codexImages ? [codexImages] : []),
      ...attachments.map((file) => path.dirname(file.path))] };
}
/** Another device's conversation offers the uploads and selected outputs Bridge synced
 * from it. Only their records are read: a card downloads its file when it opens. */
async function replicaFilesForRun({ run, runsService }: Awaited<ReturnType<typeof runContext>>): Promise<AtlasGeneratedFile[]> {
  const common = { runId: run.id, runTitle: run.title ?? "Conversation", collectionId: run.collectionId };
  const backendId = run.ownerBackendId ?? "";
  const replicaKey = (...identity: unknown[]) => createHash("sha256").update(JSON.stringify([run.id, ...identity])).digest("hex");
  const result: AtlasGeneratedFile[] = [];
  for (const { attachment, isBrowserAnnotation } of runsService.listRunAttachmentRecords(run.id)) {
    const type = classify(attachment.name);
    if (isBrowserAnnotation || !type) continue;
    result.push({ ...common, ...type, origin: "attachment", contentHash: attachment.contentHash,
      sourceKey: replicaKey("attachment", attachment.id), path: attachment.name, fileName: attachment.name,
      byteSize: attachment.byteSize, modifiedAt: attachment.createdAt.toISOString(),
      replica: { backendId, attachmentId: attachment.id } });
  }
  for (const output of await runsService.getOutputArtifacts(run.id)) {
    const source = output.metadata?.path;
    const type = typeof source === "string" ? classify(source) : null;
    if (typeof source !== "string" || !type) continue;
    const modified = Number(output.metadata?.modifiedAt);
    // The source device keys its own copy by this path, so a file it saved to Atlas is not listed twice.
    result.push({ ...common, ...type, origin: "generated",
      sourceKey: path.isAbsolute(source) ? sourceKey(run.id, source) : replicaKey("output", output.id), path: source,
      fileName: typeof output.metadata?.fileName === "string" ? output.metadata.fileName : path.basename(source),
      byteSize: Number(output.metadata?.byteSize) || 0,
      modifiedAt: (modified > 0 ? new Date(modified) : output.createdAt).toISOString(),
      replica: { backendId, artifactId: output.id } });
  }
  return [...new Map(result.map((item) => [item.sourceKey, item])).values()];
}
async function generatedForRun(runId: string, accountId: string, hashImages = true): Promise<AtlasGeneratedFile[]> {
  const context = await runContext(runId, accountId);
  const { run, runsService, roots, attachments } = context;
  // Generated discovery walks this backend's execution folders.
  if (run.isReplica) return replicaFilesForRun(context);
  const candidates = new Set<string>();
  for (const artifact of await runsService.getOutputArtifacts(runId)) {
    if (artifact.metadata?.outputSelected && artifact.path) candidates.add(artifact.path);
  }
  const uploads = new Map(attachments.map((file) => [file.path, file]));
  for (const [file, attachment] of uploads) if (!attachment.isBrowserAnnotation) candidates.add(file);
  const result: AtlasGeneratedFile[] = [];
  for (const file of candidates) {
    if (uploads.get(file)?.isBrowserAnnotation) continue;
    const type = classify(file);
    if (!type) continue;
    try {
      const { real, stats } = await inspectSource(file, roots);
      result.push({ sourceKey: sourceKey(runId, real), runId, runTitle: run.title ?? "Conversation",
        origin: uploads.has(file) ? "attachment" : "generated",
        ...(type.kind === "image" ? { contentHash: uploads.get(file)?.contentHash ?? (hashImages ? await imageContentHash(real, stats) : undefined) } : {}),
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
    emit(CHANNELS.atlas.changed, {});
    return format(owned({ id: previous.id, accountId }));
  }
  const id = randomUUID();
  const type = classify(name);
  if (!type) throw new Error("Unsupported Atlas file type");
  const storageKey = await writeFile(id, name, bytes);
  try {
    atlasRepo.insert({ id, accountId, ...type, title: name, fileName: name, storageKey,
      byteSize: bytes.length, contentHash: fileHash(bytes), sourceRunId, sourceKey: key, collectionId });
    emit(CHANNELS.atlas.changed, {});
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

/** Finish fallible cover preparation before writing Page content or presentation. */
async function prepareMetadata(accountId: string, input: PagePresentation) {
  let metadata = input.metadata === undefined ? undefined : metadataPatch(input.metadata);
  if (input.coverPreset !== undefined) {
    if (input.coverPreset !== null && !isCoverId(input.coverPreset))
      throw new Error(`Unknown cover "${input.coverPreset}". Call AtlasListCovers for the available ids.`);
    let coverFileId: string | null = null;
    if (input.coverPreset !== null) {
      const preset = input.coverPreset;
      const key = `${ATLAS_COVER_SOURCE_PREFIX}${preset}`;
      const cover = await once(`${accountId}:${key}`, async () => {
        const bytes = await readCoverPreset(preset);
        const previous = atlasRepo.bySource(accountId, key);
        if (previous?.storageKey && !await restoreFile(previous.storageKey, bytes, previous.contentHash))
          // An older app may have shipped different bytes for this preset. Keep its immutable identity.
          await bridgeService.resolveFile("atlas_items", previous.id, "storage_key");
        return store(accountId, key, coverPreset(preset)!.file, bytes, null, null);
      });
      coverFileId = cover.id;
    }
    metadata = { ...metadata, coverFileId };
  }
  if (metadata?.coverFileId) {
    const cover = owned({ id: metadata.coverFileId, accountId });
    if (cover.kind !== "image" || !cover.storageKey || cover.trashedAt) throw new Error("Page cover image is unavailable");
    await requirePageFiles([cover.id], accountId);
  }
  return metadata;
}

function savedEntry(item: AtlasListItem): AtlasLibraryEntry {
  return { key: item.id, kind: item.kind, title: item.title, date: item.updatedAt,
    collectionId: item.collectionId, path: item.path, contentHash: item.contentHash, saved: item };
}

function matchesLibrary(entry: AtlasLibraryEntry, options: AtlasLibraryOptions, query: string) {
  return (!options.type || options.type === "all" || entry.kind === options.type)
    && (!options.collectionId || entry.collectionId === options.collectionId)
    && `${entry.title} ${entry.generated?.runTitle ?? ""}`.toLocaleLowerCase().includes(query);
}

async function* savedLibraryEntries(options: AtlasLibraryOptions, query: string) {
  if (options.scope === "generated" || options.scope === "uploads") return;
  for (let offset = 0; ; offset += ATLAS_LIBRARY_PAGE_SIZE) {
    const items = atlasService.list({ accountId: options.accountId, offset, limit: ATLAS_LIBRARY_PAGE_SIZE,
      kind: options.type === "all" ? undefined : options.type, collectionId: options.collectionId,
      trashed: false, ...(options.scope === "favorites" ? { isFavorite: true } : {}) });
    for (const item of items) {
      // Bundled cover images are presentation, not library content.
      if (item.sourceKey?.startsWith(ATLAS_COVER_SOURCE_PREFIX)) continue;
      const entry = savedEntry(item);
      if (matchesLibrary(entry, options, query)) yield entry;
    }
    if (items.length < ATLAS_LIBRARY_PAGE_SIZE) return;
  }
}

async function* generatedLibraryEntries(options: AtlasLibraryOptions, query: string) {
  if (options.type === "page" || options.scope === "saved" || options.scope === "favorites") return;
  const preferredImages = options.scope === "all"
    ? new Set(atlasRepo.imageIdentities(options.accountId, options.collectionId)
      .filter((item) => item.title.toLocaleLowerCase().includes(query)).map((item) => item.contentHash).filter(Boolean))
    : new Set<string>();
  // Continue through older conversations only as the requested page needs
  // them. An empty conversation or a filtered batch cannot hide later files.
  const batchSize = 25;
  for (let offset = 0; ; offset += batchSize) {
    const runs = atlasRepo.generatedRuns(options.accountId, offset, batchSize, options.collectionId);
    const files: AtlasGeneratedFile[] = [];
    for (let index = 0; index < runs.length; index += 4) {
      const batch = await Promise.all(runs.slice(index, index + 4)
        .map((run) => generatedForRun(run.id, options.accountId, false)));
      files.push(...batch.flat());
    }
    files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.sourceKey.localeCompare(b.sourceKey));
    for (const file of files) {
      if (options.scope === "generated" && file.origin === "attachment") continue;
      if (options.scope === "uploads" && file.origin !== "attachment") continue;
      const entry: AtlasLibraryEntry = { key: file.sourceKey, kind: file.kind, title: file.fileName,
        date: file.modifiedAt, collectionId: file.collectionId, path: file.replica ? null : file.path, generated: file };
      if (!matchesLibrary(entry, options, query)) continue;
      const saved = atlasRepo.bySource(options.accountId, file.sourceKey);
      if (options.scope === "all" && saved && (saved.trashedAt || matchesLibrary(savedEntry(format(saved)), options, query))) continue;
      if (file.kind === "image" && !file.contentHash && !file.replica) {
        try { file.contentHash = await imageContentHash(file.path, await fs.stat(file.path)); }
        catch { continue; }
      }
      if (file.kind === "image" && options.scope === "all" && file.contentHash && preferredImages.has(file.contentHash)) continue;
      entry.contentHash = file.contentHash;
      if (options.scope !== "all" && saved) entry.saved = format(saved);
      yield entry;
    }
    if (runs.length < batchSize) return;
  }
}

async function* libraryEntries(options: AtlasLibraryOptions, query: string) {
  const saved = savedLibraryEntries(options, query);
  const generated = generatedLibraryEntries(options, query);
  let [left, right] = await Promise.all([saved.next(), generated.next()]);
  const seenImages = new Set<string>();
  while (!left.done || !right.done) {
    const takeSaved = !left.done && (right.done || left.value.date >= right.value.date);
    const entry = takeSaved ? left.value! : right.value!;
    if (entry.kind !== "image" || !entry.contentHash || !seenImages.has(entry.contentHash)) {
      if (entry.kind === "image" && entry.contentHash) seenImages.add(entry.contentHash);
      yield entry;
    }
    if (takeSaved) left = await saved.next(); else right = await generated.next();
  }
}

export const atlasService = {
  list(options: AtlasListOptions): AtlasListItem[] {
    const accountId = required(options?.accountId, "Account");
    if ((options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000))
      || (options.offset !== undefined && (!Number.isSafeInteger(options.offset) || options.offset < 0))
      || (options.ids !== undefined && (!Array.isArray(options.ids) || options.ids.length > 1000 || options.ids.some((id) => typeof id !== "string")))
      || (options.kind !== undefined && !["page", "file", "image"].includes(options.kind))
      || (options.trashed !== undefined && typeof options.trashed !== "boolean")
      || (options.isFavorite !== undefined && typeof options.isFavorite !== "boolean")
      || (options.collectionId !== undefined && typeof options.collectionId !== "string"))
      throw new Error("Invalid Atlas pagination or filters");
    if (options.ids?.length === 0) return [];
    const includePreview = options?.includePagePreview === true;
    return atlasRepo.list({ ...options, accountId, includePagePreview: includePreview })
      .map(({ item, preview }) => ({ ...format(item),
        ...(item.kind === "image" && item.contentHash ? { contentHash: item.contentHash } : {}),
        ...(includePreview && item.kind === "page" ? { preview: preview ?? "" } : {}) }));
  },
  async library(input: AtlasLibraryOptions): Promise<AtlasLibraryPage> {
    const accountId = required(input?.accountId, "Account");
    const requestedPage = input.page ?? 1;
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || requestedPage > 100000
      || (input.type !== undefined && !["all", "page", "file", "image"].includes(input.type))
      || (input.scope !== undefined && !["all", "saved", "favorites", "generated", "uploads"].includes(input.scope))
      || (input.query !== undefined && (typeof input.query !== "string" || input.query.length > 4096)))
      throw new Error("Invalid Atlas pagination");
    if (input.collectionId) await collection(input.collectionId, accountId);
    const options = { ...input, accountId, scope: input.scope ?? "all" };
    const query = (input.query ?? "").toLocaleLowerCase().trim();
    const start = (requestedPage - 1) * ATLAS_LIBRARY_PAGE_SIZE;
    const end = start + ATLAS_LIBRARY_PAGE_SIZE;
    let index = 0;
    let items: AtlasLibraryEntry[] = [];
    let lastPage: AtlasLibraryEntry[] = [];
    let hasNext = false;
    for await (const entry of libraryEntries(options, query)) {
      if (index === end) { hasNext = true; break; }
      if (index % ATLAS_LIBRARY_PAGE_SIZE === 0) lastPage = [];
      lastPage.push(entry);
      if (index >= start) items.push(entry);
      index++;
    }
    const page = hasNext ? requestedPage : Math.max(1, Math.ceil(index / ATLAS_LIBRARY_PAGE_SIZE));
    if (page < requestedPage) items = lastPage;
    const previewImages: Record<string, string> = {};
    if (input.includePagePreview === true) {
      const ids = items.filter((entry) => entry.kind === "page").map((entry) => entry.key);
      const previews = new Map(this.list({ accountId, ids, includePagePreview: true }).map((item) => [item.id, item]));
      for (const entry of items) {
        if (entry.kind !== "page" || !entry.saved) continue;
        entry.saved = previews.get(entry.key) ?? entry.saved;
        for (const match of (entry.saved.preview ?? "").matchAll(/atlas-file:\/\/([^\s)>]+)/g)) {
          const image = atlasRepo.find(match[1], accountId);
          if (image?.kind === "image" && image.storageKey) {
            try { previewImages[match[0]] = await this.resolveFile({ id: image.id, accountId }); }
            catch { /* A missing preview must not hide the Page's text. */ }
          }
        }
      }
    }
    return { items, page, hasNext, previewImages };
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
  async resolveFile(options: AtlasIdentity): Promise<string> {
    const item = owned(options);
    if (!item.storageKey || item.kind === "page") throw new Error("Atlas file unavailable");
    const local = storagePath(item.storageKey);
    try {
      const stats = await fs.lstat(local);
      if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("Invalid Atlas file");
      // inspectSource also excludes symlinked parent directories.
      await inspectSource(local, [atlasRoot()]);
      return local;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return bridgeService.resolveFile("atlas_items", item.id, "storage_key");
    }
  },
  getRevision(options: AtlasIdentity & { revisionId: string }): AtlasPageRevision {
    const item = owned(options);
    const row = atlasRepo.revisionById(item.id, required(options.revisionId, "Revision"));
    if (!row) throw new Error("Page revision not found");
    return revision(row);
  },
  async createPage(input: AtlasCreatePage & PagePresentation, actor: "user" | "agent" = "user", sourceRunId: string | null = null) {
    const accountId = required(input?.accountId, "Account");
    const name = title(input?.title);
    const collectionId = await collection(input.collectionId, accountId);
    const content = await pageContent(input);
    const fileIds = await requirePageFiles(content.fileIds, accountId);
    const metadata = await prepareMetadata(accountId, input);
    const id = randomUUID();
    const item = { id, accountId, kind: "page" as const, title: name, collectionId, version: 1, sourceRunId };
    atlasRepo.commitPage(item, { id: randomUUID(), itemId: id, title: name, version: 1,
      blocksJson: JSON.stringify(content.blocks), markdown: content.markdown, actor, sourceRunId }, 0, fileIds, true, metadata);
    emit(CHANNELS.atlas.changed, {});
    return pageFor(owned({ id, accountId }));
  },
  /** Autosaves from the user fold into their session's revision; agents and restores always add one. */
  async savePage(input: AtlasSavePage & PagePresentation, actor: "user" | "agent" | "restore" = "user", sourceRunId: string | null = null) {
    const item = owned(input);
    if (item.kind !== "page" || item.trashedAt) throw new Error("Page is in Trash or unavailable");
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion !== item.version)
      throw new Error("This page changed elsewhere. Reload the latest version before saving.");
    if (input.blocks === undefined && input.markdown === undefined) throw new Error("Page content is required");
    const name = title(input.title);
    const content = await pageContent(input);
    const fileIds = await requirePageFiles(content.fileIds, item.accountId);
    const metadata = await prepareMetadata(item.accountId, input);
    const latest = owned(input);
    if (latest.version !== input.expectedVersion || latest.trashedAt)
      throw new Error("This page changed elsewhere. Reload the latest version before saving.");
    const current = latest.currentRevisionId ? atlasRepo.revisionById(item.id, latest.currentRevisionId) : null;
    if (current?.blocksJson === JSON.stringify(content.blocks) && name === latest.title) {
      if (metadata === undefined) return pageFor(latest);
      atlasRepo.update(item.id, item.accountId, {}, metadata);
    } else {
      const coalesce = actor === "user" && !!current
        && continuesSession(current, { actor, sourceRunId }, latest.updatedAt, new Date());
      atlasRepo.commitPage({ ...item, title: name }, { id: randomUUID(), itemId: item.id, title: name,
        version: item.version + 1, blocksJson: JSON.stringify(content.blocks), markdown: content.markdown,
        actor, sourceRunId }, input.expectedVersion, fileIds, false, metadata, coalesce);
    }
    pruneHistory(owned(input));
    emit(CHANNELS.atlas.changed, {});
    return pageFor(owned(input));
  },
  revisions(options: AtlasIdentity) {
    const item = owned(options);
    if (item.kind !== "page") throw new Error("Atlas item is not a page");
    const pinned = new Set(item.currentRevisionId
      ? [item.currentRevisionId, ...atlasRepo.conflicts(item.id, item.currentRevisionId).map((row) => row.id)] : []);
    return historyCheckpoints(atlasRepo.revisions(item.id), pinned)
      .map((row) => ({ ...row, ...atlasRepo.provenance(row.id), createdAt: row.createdAt.toISOString() }));
  },
  async restore(input: AtlasIdentity & { revisionId?: string; version?: number; expectedVersion: number }) {
    const item = owned(input);
    const older = input.revisionId ? atlasRepo.revisionById(item.id, input.revisionId)
      : input.version === undefined ? null : atlasRepo.revision(item.id, input.version);
    if (!older) throw new Error("Page revision not found");
    return this.savePage({ ...input, title: older.title, blocks: JSON.parse(older.blocksJson) }, "restore");
  },
  async resolveConflict(input: AtlasResolveConflict): Promise<AtlasPage> {
    const item = owned(input);
    if (item.kind !== "page" || item.trashedAt || item.version !== input.expectedVersion)
      throw new Error("This page changed elsewhere. Reload the latest version before resolving.");
    if (input.choice !== "current" && input.choice !== "other") throw new Error("Invalid conflict resolution");
    const current = item.currentRevisionId ? atlasRepo.revisionById(item.id, item.currentRevisionId) : null;
    const other = atlasRepo.conflicts(item.id, current?.id ?? "").find((row) => row.id === input.revisionId);
    if (!current || !other) throw new Error("This conflict changed elsewhere. Reload the latest version before resolving.");
    const selected = input.choice === "current" ? current : other;
    const content = await pageContent({ blocks: JSON.parse(selected.blocksJson) });
    const fileIds = await requirePageFiles(content.fileIds, item.accountId);
    atlasRepo.commitPage({ ...item, title: selected.title }, { id: randomUUID(), itemId: item.id,
      version: 0, title: selected.title, blocksJson: JSON.stringify(content.blocks), markdown: content.markdown,
      actor: "user", mergedRevisionId: other.id }, input.expectedVersion, fileIds);
    emit(CHANNELS.atlas.changed, {});
    return pageFor(owned(input));
  },
  async saveFile(input: AtlasSaveFile) {
    const accountId = required(input?.accountId, "Account");
    const requested = required(input?.path, "File path");
    const context = await runContext(input.runId, accountId);
    if (context.run.isReplica) throw new Error("Save this file from its source backend");
    const { real } = await inspectSource(requested, context.roots);
    const key = sourceKey(input.runId, real);
    return once(`${accountId}:${key}`, async () => {
      const old = atlasRepo.bySource(accountId, key);
      if (old) {
        if (old.trashedAt) atlasRepo.update(old.id, accountId, { trashedAt: null });
        emit(CHANNELS.atlas.changed, {});
        return format(owned({ id: old.id, accountId }));
      }
      // Hidden annotation captures remain available for an explicit user save.
      const attachment = context.attachments.some((file) => file.path === real);
      if (!attachment && !(await generatedForRun(input.runId, accountId)).some((file) => file.sourceKey === key))
        throw new Error("File is not a generated output of this conversation");
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
  async update(input: AtlasUpdateItem & PagePresentation) {
    const item = owned(input);
    if (item.kind === "page" && input.title !== undefined) throw new Error("Rename a Page through its editor");
    const fields: Partial<AtlasRecord> = {};
    if ((input.metadata !== undefined || input.coverPreset !== undefined) && (item.kind !== "page" || item.trashedAt))
      throw new Error("Page unavailable");
    const metadata = await prepareMetadata(item.accountId, input);
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
    emit(CHANNELS.atlas.changed, {});
    return format(owned(input));
  },
  /** Use a bundled cover: its image is saved once per account and shared by every Page that picks it. */
  async setCoverPreset(input: AtlasIdentity & { preset: string }) {
    const page = owned(input);
    if (page.kind !== "page" || page.trashedAt) throw new Error("Page unavailable");
    if (!isCoverId(input.preset)) throw new Error(`Unknown cover "${input.preset}"`);
    return this.update({ accountId: page.accountId, id: page.id, coverPreset: input.preset });
  },
  async remove(input: AtlasIdentity) {
    const item = owned(input);
    if (!item.trashedAt) throw new Error("Move this item to Trash before deleting it");
    // Deletion checks current covers and revision references in one transaction.
    atlasRepo.remove(item.id, item.accountId);
    emit(CHANNELS.atlas.changed, {});
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
