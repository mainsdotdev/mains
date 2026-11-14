import { createHash } from "node:crypto";
import { promises as fs, type Stats } from "node:fs";
import type { AtlasMobileEntry, AtlasMobileFile, AtlasMobileFileRead, AtlasMobileFileReference, AtlasMobileFileRequest, AtlasMobileImage,
  AtlasMobileLibraryOptions, AtlasMobileLibraryPage, AtlasMobilePage, AtlasMobilePageRequest,
  AtlasMobilePageCoverRequest, AtlasMobilePageCover,
  AtlasMobilePageImageRequest, AtlasMobilePageImage,
  AtlasMobileSaveFile, AtlasMobileSaveBookmark, AtlasMobileSavedItem, AtlasMobileUpdateItem, AtlasMobileItemState,
  AtlasMobileBookmarkIdentity, AtlasMobileBookmark, AtlasMobileEditBookmark, AtlasMobileBookmarkEditResult,
  AtlasMobileTrashOptions, AtlasMobileTrashPage, AtlasMobileSetTrash, AtlasMobileTrashState,
  AtlasMobileTagsOptions, AtlasMobileTagsPage, AtlasMobileItemTags, AtlasMobileSetTags, AtlasMobileTagsResult } from "@mains/contracts/atlas-mobile";
import { MOBILE_OUTPUT_MAX_BYTES, outputFileType, type RunOutputChunk } from "@mains/contracts/run-outputs";
import { readRunFileChunk } from "../../../shared/file-chunks";
import { atlasService, generatedForRun } from "./atlas.service";
import { atlasRoot, inspectSource, sourceKey } from "./atlas.storage";
import { readImagePreview } from "../imageProxy";
import type { ArtifactImage } from "@mains/contracts/runs";
import { isAtlasLibraryItem, type AtlasSaveFile } from "@mains/contracts/atlas";
import { atlasRepo } from "./atlas.repo";

function required(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || value.includes("\0")) throw new Error("Invalid Atlas identity");
  return value;
}
function referenceOf(value: AtlasMobileFileReference): AtlasMobileFileReference {
  if (!value || typeof value !== "object") throw new Error("Invalid Atlas file reference");
  if (value.itemId !== undefined) {
    if (value.runId !== undefined || value.sourceKey !== undefined) throw new Error("Invalid Atlas file reference");
    return { itemId: required(value.itemId) };
  }
  const runId = required(value.runId), sourceKey = required(value.sourceKey);
  if (!/^[a-f0-9]{64}$/.test(sourceKey)) throw new Error("Invalid Atlas file reference");
  return { runId, sourceKey };
}
const signature = (accountId: string, reference: AtlasMobileFileReference, stat: Stats) => createHash("sha256")
  .update(JSON.stringify([accountId, reference, stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino, stat.dev])).digest("hex");

async function resolveSaveSource(input: AtlasMobileSaveFile): Promise<{ input: AtlasSaveFile; validate: () => Promise<void> }> {
    const accountId = required(input?.accountId);
    if (typeof input.version !== "string" || !/^[a-f0-9]{64}$/.test(input.version)
      || Object.keys(input).some(key => !["accountId", "runId", "version", "artifactId", "attachmentId", "sourceKey", "itemId"].includes(key))) throw new Error("Invalid Atlas save source");
    if (input.itemId !== undefined) {
      if ([input.runId, input.artifactId, input.attachmentId, input.sourceKey].some(value => value !== undefined)) throw new Error("Invalid Atlas save source");
      const itemId = required(input.itemId);
      const validate = async () => {
        const file = await atlasMobile.describeFile({ accountId, reference: { itemId } });
        if (file.version !== input.version) throw new Error("This file changed. Open it again before saving to Atlas.");
      };
      return { input: { accountId, itemId }, validate };
    }
    const runId = required(input.runId);
    if (
      [input.artifactId, input.attachmentId, input.sourceKey].filter((value) => value !== undefined).length !== 1
      || input.artifactId !== undefined && (!Number.isSafeInteger(input.artifactId) || input.artifactId === 0)
      || input.attachmentId !== undefined && !/^[a-f0-9]{64}$/.test(input.attachmentId)
      || input.sourceKey !== undefined && !/^[a-f0-9]{64}$/.test(input.sourceKey)) throw new Error("Invalid Atlas save source");
    const { runsService } = await import("../runs");
    const resolve = async () => {
      const run = await runsService.getRunById(runId);
      if (!run || run.accountId !== accountId) throw new Error("Conversation not found");
      if (run.isReplica) throw new Error("Save this file to Atlas from its source computer");
      let path: string, version: string;
      if (input.attachmentId !== undefined) {
        const file = await runsService.describeAttachmentFile({ runId, attachmentId: input.attachmentId });
        path = await runsService.resolveAttachmentPath({ runId, attachmentId: input.attachmentId }); version = file.version;
      } else if (input.artifactId !== undefined) {
        const file = (await runsService.listOutputs({ runId, artifactId: input.artifactId })).items[0];
        const artifact = (await runsService.getOutputArtifacts(runId)).find((row) => row.id === input.artifactId);
        const selectedPath = artifact?.path ?? artifact?.metadata?.path;
        if (!file || typeof selectedPath !== "string") throw new Error("File is no longer a selected output of this conversation");
        path = selectedPath; version = file.version;
      } else {
        const reference = { runId, sourceKey: input.sourceKey! };
        const selected = await selectGenerated(accountId, reference);
        const file = await atlasMobile.describeFile({ accountId, reference });
        path = selected.selected.path; version = file.version;
      }
      if (version !== input.version) throw new Error("This file changed. Open it again before saving to Atlas.");
      return path;
    };
    const path = await resolve();
    return { input: { accountId, runId, path }, validate: async () => {
      if (await resolve() !== path) throw new Error("This file changed. Open it again before saving to Atlas.");
    } };
}

export const atlasMobile = {
  tags(input: AtlasMobileTagsOptions): AtlasMobileTagsPage {
    const accountId = required(input?.accountId), page = input.page ?? 1;
    if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) throw new Error("Invalid tag page");
    const rows = atlasService.listTags({ accountId, query: input.query ?? "", offset: (page - 1) * 50, limit: 51 });
    return { items: rows.slice(0, 50), page, hasNext: rows.length > 50 };
  },

  readTags(input: AtlasMobileBookmarkIdentity): AtlasMobileItemTags {
    const accountId = required(input?.accountId), id = required(input?.id);
    const item = atlasService.get({ accountId, id });
    if (!item || item.trashedAt) throw new Error("Atlas item not found or in Trash");
    const tags = item.tags ?? [];
    if (tags.length > 60) throw new Error("This item has too many tags to edit on iPhone. Edit its tags on your computer.");
    const revision = createHash("sha256").update(JSON.stringify([accountId, item.id,
      tags.map(({ id, name, source }) => [id, name, source]).sort((a, b) => a[0].localeCompare(b[0]))])).digest("hex");
    return { id: item.id, requestedId: id, kind: item.kind, title: item.title, tags, revision };
  },

  setTags(input: AtlasMobileSetTags): AtlasMobileTagsResult {
    const accountId = required(input?.accountId), id = required(input?.id);
    if (Object.keys(input).some((key) => !["accountId", "id", "tags", "expectedRevision"].includes(key))
      || typeof input.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedRevision)) throw new Error("Invalid tag change");
    if (this.readTags({ accountId, id }).revision !== input.expectedRevision) throw new Error("These tags changed elsewhere. Reload them before saving your edits.");
    // Both the revision check and the existing transactional tag writer are synchronous.
    const item = atlasService.setTags({ accountId, id, tags: input.tags });
    return { id: item.id, requestedId: id, title: item.title, kind: item.kind, revision: this.readTags({ accountId, id }).revision };
  },

  trash(input: AtlasMobileTrashOptions): AtlasMobileTrashPage {
    const accountId = required(input?.accountId), page = input.page ?? 1;
    if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) throw new Error("Invalid Trash page");
    const rows = atlasService.list({ accountId, trashed: true, offset: (page - 1) * 50, limit: 51 });
    return { items: rows.slice(0, 50).map((item) => ({ id: item.id, title: item.title, kind: item.kind, collectionId: item.collectionId, trashedAt: item.trashedAt! })),
      page, hasNext: rows.length > 50 };
  },

  async setTrash(input: AtlasMobileSetTrash): Promise<AtlasMobileTrashState> {
    const accountId = required(input?.accountId), id = required(input?.id);
    if (typeof input.trashed !== "boolean" || Object.keys(input).some((key) => !["accountId", "id", "trashed"].includes(key))) throw new Error("Only Trash or Restore is supported by this command");
    const current = atlasService.get({ accountId, id });
    if (!current) throw new Error("Atlas item not found");
    // Setting a state is idempotent; repeated Trash preserves its original date.
    const item = !!current.trashedAt === input.trashed ? current : await atlasService.update({ accountId, id, trashed: input.trashed }, () => {
      if (!atlasService.get({ accountId, id })) throw new Error("Atlas item not found");
    });
    return { id: item.id, requestedId: id, title: item.title, kind: item.kind, trashed: !!item.trashedAt };
  },

  readBookmark(input: AtlasMobileBookmarkIdentity): AtlasMobileBookmark {
    const accountId = required(input?.accountId), id = required(input?.id);
    const item = atlasService.get({ accountId, id });
    if (!item || item.kind !== "bookmark" || item.trashedAt || !item.url) throw new Error("Bookmark not found or in Trash");
    const description = item.description ?? "", note = item.note ?? "";
    const revision = createHash("sha256").update(JSON.stringify([accountId, item.id, item.url, item.title, description, note])).digest("hex");
    return { id: item.id, requestedId: id, title: item.title, kind: "bookmark", url: item.url, description, note, revision,
      isFavorite: item.isFavorite, collectionId: item.collectionId, tags: (item.tags ?? []).slice(0, 60), hasImage: !!item.bookmarkImagePath };
  },

  async editBookmark(input: AtlasMobileEditBookmark): Promise<AtlasMobileBookmarkEditResult> {
    const accountId = required(input?.accountId), id = required(input?.id);
    if (Object.keys(input).some((key) => !["accountId", "id", "expectedRevision", "title", "description", "note"].includes(key))
      || typeof input.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedRevision)) throw new Error("Invalid bookmark edit");
    const fields: { title?: string; description?: string; note?: string } = {};
    for (const [field, limit] of [["title", 240], ["description", 2000], ["note", 10000]] as const) {
      const value = input[field];
      if (value === undefined) continue;
      if (typeof value !== "string" || value.length > limit || value.includes("\0") || field === "title" && !value.trim()) throw new Error(`Invalid bookmark ${field}`);
      fields[field] = value.trim();
    }
    if (!Object.keys(fields).length) throw new Error("Change the title, description or note before saving");
    const checkRevision = () => {
      if (this.readBookmark({ accountId, id }).revision !== input.expectedRevision) throw new Error("This bookmark changed elsewhere. Reload it before saving your edits.");
    };
    checkRevision();
    const original = this.readBookmark({ accountId, id });
    const item = await atlasService.saveBookmark({ accountId, id: original.id, url: original.url, ...fields }, checkRevision);
    return { id: item.id, requestedId: id, title: item.title, kind: item.kind, revision: this.readBookmark({ accountId, id: item.id }).revision };
  },

  async updateItem(input: AtlasMobileUpdateItem): Promise<AtlasMobileItemState> {
    const accountId = required(input?.accountId), id = required(input?.id);
    if (Object.keys(input).some((key) => !["accountId", "id", "isFavorite", "collectionId"].includes(key))
      || input.isFavorite === undefined && input.collectionId === undefined
      || input.isFavorite !== undefined && typeof input.isFavorite !== "boolean"
      || input.collectionId !== undefined && input.collectionId !== null && (typeof input.collectionId !== "string" || !input.collectionId.trim())) throw new Error("Only favorite and project changes are supported on iPhone");
    const assertActive = () => {
      const item = atlasService.get({ accountId, id });
      if (!item || item.trashedAt) throw new Error("Atlas item not found or in Trash");
    };
    assertActive();
    const item = await atlasService.update({ accountId, id,
      ...(input.isFavorite !== undefined ? { isFavorite: input.isFavorite } : {}),
      ...(input.collectionId !== undefined ? { collectionId: input.collectionId } : {}) }, assertActive);
    return { id: item.id, requestedId: id, kind: item.kind, title: item.title, isFavorite: item.isFavorite, collectionId: item.collectionId };
  },
  async saveBookmark(input: AtlasMobileSaveBookmark): Promise<AtlasMobileSavedItem> {
    const item = await atlasService.saveBookmark({ accountId: required(input?.accountId), url: input?.url,
      ...(input.collectionId !== undefined ? { collectionId: input.collectionId } : {}) });
    return { id: item.id, title: item.title, kind: item.kind };
  },

  async saveStatus(input: AtlasMobileSaveFile): Promise<{ saved: boolean }> {
    const selection = await resolveSaveSource(input);
    const source = selection.input;
    const key = source.itemId === undefined ? sourceKey(source.runId, await fs.realpath(source.path)) : null;
    await selection.validate();
    const item = source.itemId !== undefined ? atlasService.get({ accountId: source.accountId, id: source.itemId })
      : atlasRepo.bySource(source.accountId, key!);
    return { saved: !!item && !item.trashedAt && isAtlasLibraryItem({ sourceKey: item.sourceKey,
      metadata: typeof item.metadata === "string" ? JSON.parse(item.metadata) : item.metadata }) };
  },

  async saveFile(input: AtlasMobileSaveFile): Promise<AtlasMobileSavedItem> {
    const selection = await resolveSaveSource(input);
    const item = await atlasService.saveFile(selection.input, selection.validate);
    return { id: item.id, title: item.title, kind: item.kind };
  },

  async library(input: AtlasMobileLibraryOptions): Promise<AtlasMobileLibraryPage> {
    required(input?.accountId);
    // Whitelist options; callers cannot opt into full previews or file paths.
    const result = await atlasService.library({ accountId: input.accountId, type: input.type, scope: input.scope,
      collectionId: input.collectionId, query: input.query, tagId: input.tagId, page: input.page });
    const pageIDs = result.items.filter(entry => entry.kind === "page").map(entry => entry.key);
    // Read only bounded excerpts of the returned page, without resolving embedded files.
    const previews = new Map(pageIDs.length ? atlasService.list({ accountId: input.accountId, ids: pageIDs, includePagePreview: true, limit: 50 })
      .map(item => [item.id, Array.from(item.preview ?? "").slice(0, 240).join("")]) : []);
    const items = result.items.map((entry): AtlasMobileEntry => {
      const saved = entry.saved?.trashedAt ? undefined : entry.saved, generated = entry.generated;
      return { key: entry.key, kind: entry.kind, title: entry.title, date: entry.date, collectionId: entry.collectionId,
        isFavorite: saved?.isFavorite ?? false, savedItemId: saved?.id ?? null, savedCollectionId: saved?.collectionId ?? null,
        origin: generated?.origin ?? (generated ? "generated" : "saved"),
        sourceRunId: generated?.runId ?? saved?.sourceRunId ?? null,
        file: entry.kind === "file" || entry.kind === "image"
          ? saved ? { itemId: saved.id } : generated ? { runId: generated.runId, sourceKey: generated.sourceKey } : null : null,
        pageId: entry.kind === "page" ? saved?.id ?? null : null, icon: saved?.metadata?.icon ?? null,
        url: saved?.url ?? null, description: saved?.description ?? null, note: saved?.note ?? null, tags: (saved?.tags ?? []).slice(0, 60),
        fileName: (saved?.fileName ?? generated?.fileName)?.split(/[/\\]/).pop()?.slice(0, 240).replace(/[\uD800-\uDBFF]$/u, "") ?? null,
        mimeType: saved?.mimeType ?? generated?.mimeType ?? null,
        byteSize: saved?.byteSize ?? generated?.byteSize ?? null, preview: previews.get(entry.key) ?? null };
    });
    return { items, page: result.page, hasNext: result.hasNext };
  },

  readPage(input: AtlasMobilePageRequest): AtlasMobilePage {
    const accountId = required(input?.accountId), id = required(input?.id), offset = input.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2 * 1024 * 1024
      || (input.version !== undefined && (!Number.isSafeInteger(input.version) || input.version < 1))
      || (offset > 0 && input.version === undefined)) throw new Error("Invalid Atlas page position");
    const page = atlasService.getPage({ accountId, id });
    if (!page || page.item.trashedAt) throw new Error("Atlas page not found");
    if (input.version !== undefined && input.version !== page.item.version) throw new Error("This page changed. Refresh it to keep reading.");
    if (Buffer.byteLength(page.revision.markdown) > 2 * 1024 * 1024) throw new Error("This page exceeds the mobile reading limit");
    const scalars = Array.from(page.revision.markdown);
    if (offset > scalars.length) throw new Error("Invalid Atlas page position");
    const end = Math.min(offset + 16_384, scalars.length);
    const cover = page.item.metadata?.coverFileId ? atlasService.get({ accountId, id: page.item.metadata.coverFileId }) : null;
    return { id: page.item.id, title: page.item.title, icon: page.item.metadata?.icon ?? null, version: page.item.version,
      coverFileId: cover?.kind === "image" && !cover.trashedAt ? cover.id : null,
      markdown: scalars.slice(offset, end).join(""), offset, nextOffset: end < scalars.length ? end : null,
      sourceRunId: page.item.sourceRunId };
  },

  async readPageCover(input: AtlasMobilePageCoverRequest): Promise<AtlasMobilePageCover> {
    const accountId = required(input?.accountId), id = required(input?.id), coverFileId = required(input?.coverFileId);
    const checkPage = () => {
      const page = atlasService.get({ accountId, id });
      if (!page || page.kind !== "page" || page.trashedAt || page.metadata?.coverFileId !== coverFileId)
        throw new Error("Page cover changed or is unavailable");
      const cover = atlasService.get({ accountId, id: coverFileId });
      if (!cover || cover.kind !== "image" || cover.trashedAt) throw new Error("Page cover is unavailable");
    };
    checkPage();
    const request = { accountId, reference: { itemId: coverFileId } };
    return { pageId: id, coverFileId, ...await pageImagePreview(request, checkPage) };
  },

  async readPageImage(input: AtlasMobilePageImageRequest): Promise<AtlasMobilePageImage> {
    const accountId = required(input?.accountId), id = required(input?.id), fileId = required(input?.fileId);
    if (!Number.isSafeInteger(input.version) || input.version < 1) throw new Error("Invalid Page version");
    const checkPage = () => {
      const page = atlasService.getPage({ accountId, id });
      if (!page || page.item.trashedAt) throw new Error("Atlas page not found");
      if (page.item.version !== input.version) throw new Error("This page changed. Refresh it to keep reading.");
      if (!pageContainsImage(page.revision.blocks, fileId)) throw new Error("Image not found in this Page");
      const image = atlasService.get({ accountId, id: fileId });
      if (!image || image.kind !== "image" || image.trashedAt) throw new Error("Page image is unavailable");
    };
    checkPage();
    return { pageId: id, fileId, pageVersion: input.version,
      ...await pageImagePreview({ accountId, reference: { itemId: fileId } }, checkPage) };
  },

  async describeFile(input: AtlasMobileFileRequest): Promise<AtlasMobileFile> {
    return (await resolveFile(input)).file;
  },

  async readImage(input: AtlasMobileFileRequest): Promise<AtlasMobileImage> {
    const selection = await resolveFile(input, undefined, { bookmarkPreview: true });
    if (selection.file.previewType !== "image") throw new Error("Not an Atlas image");
    const image = await selection.image();
    // Recheck ownership, membership, Trash and version after asynchronous decoding,
    // including cache hits and hydrated replica files.
    const current = await resolveFile(input, undefined, { bookmarkPreview: true });
    if (current.file.version !== selection.file.version) throw new Error("Atlas image changed while loading");
    if (!["image/jpeg", "image/png"].includes(image.mime) || image.base64.length > 174_764
      || !image.base64.length || Buffer.from(image.base64, "base64").length > 128 * 1024
      || !Number.isInteger(image.width) || !Number.isInteger(image.height)
      || image.width! < 1 || image.height! < 1 || image.width! > 128 || image.height! > 128) throw new Error("Invalid Atlas thumbnail");
    return { reference: selection.file.reference, version: selection.file.version,
      mime: image.mime as AtlasMobileImage["mime"], base64: image.base64, width: image.width!, height: image.height! };
  },

  async readFile(input: AtlasMobileFileRead): Promise<RunOutputChunk> {
    if (typeof input?.version !== "string" || !/^[a-f0-9]{64}$/.test(input.version)
      || !Number.isSafeInteger(input.offset) || input.offset < 0) throw new Error("Invalid Atlas file position");
    const accountId = required(input?.accountId), reference = referenceOf(input.reference);
    const generated = reference.runId ? await selectGenerated(accountId, reference) : undefined;
    // These readers own verified hydration and their bounded download leases.
    // Re-describing a replica here would re-download/hash it for every chunk.
    if (generated?.selected.replica) {
      const { selected, runsService, run } = generated;
      const { attachmentId, artifactId } = selected.replica!;
      if (attachmentId) return runsService.readAttachmentChunk({ runId: run.id, attachmentId, offset: input.offset, version: input.version });
      if (artifactId !== undefined) return runsService.readOutputFile({ runId: run.id, artifactId, offset: input.offset, version: input.version });
      throw new Error("Atlas file is unavailable on its source device");
    }
    const selection = await resolveFile(input, generated);
    if (input.version !== selection.file.version) throw new Error("This file changed. Open it again to download.");
    return selection.read(input.offset, input.version);
  },
};

function pageContainsImage(blocks: unknown[], fileId: string): boolean {
  let count = 0;
  const visit = (rows: unknown[], depth: number): boolean => {
    if (depth > 20) return false;
    for (const value of rows) {
      if (++count > 2000) return false;
      if (!value || typeof value !== "object") continue;
      const block = value as { type?: unknown; props?: { url?: unknown }; children?: unknown };
      if (block.type === "image" && block.props?.url === `atlas-file://${fileId}`) return true;
      if (Array.isArray(block.children) && visit(block.children, depth + 1)) return true;
    }
    return false;
  };
  return visit(blocks, 0);
}

async function pageImagePreview(request: AtlasMobileFileRequest, checkPage: () => void) {
  const selection = await resolveFile(request);
  if (selection.file.previewType !== "image") throw new Error("Not an Atlas image");
  let image = await selection.image(768);
  // Busy/transparent PNGs may exceed the wire budget even after resizing.
  if (image.base64.length > 699_052 || Buffer.from(image.base64, "base64").length > 512 * 1024)
    image = await selection.image(256);
  checkPage();
  const current = await resolveFile(request);
  // File resolution can await hydration, so recheck the Page after it too.
  checkPage();
  if (current.file.version !== selection.file.version) throw new Error("Page image changed while loading");
  if (!["image/jpeg", "image/png"].includes(image.mime) || image.base64.length > 699_052
    || !image.base64.length || Buffer.from(image.base64, "base64").length > 512 * 1024
    || !Number.isInteger(image.width) || !Number.isInteger(image.height)
    || image.width! < 1 || image.height! < 1 || image.width! > 768 || image.height! > 768) throw new Error("Invalid Page image preview");
  return { version: selection.file.version, mime: image.mime as AtlasMobilePageImage["mime"],
    base64: image.base64, width: image.width!, height: image.height! };
}

async function selectGenerated(accountId: string, reference: AtlasMobileFileReference) {
  const { runsService } = await import("../runs");
  const run = await runsService.getRunById(reference.runId!);
  if (!run || run.accountId !== accountId || run.mode !== "work" || run.isArchived) throw new Error("Atlas conversation not found");
  const selected = (await generatedForRun(run.id, accountId, false)).find((file) => file.sourceKey === reference.sourceKey);
  if (!selected) throw new Error("File not found in this conversation’s Atlas outputs");
  return { run, selected, runsService };
}

async function resolveFile(input: AtlasMobileFileRequest, generated?: Awaited<ReturnType<typeof selectGenerated>>,
  { bookmarkPreview = false }: { bookmarkPreview?: boolean } = {}): Promise<{
  file: AtlasMobileFile; read: (offset: number, version: string) => Promise<RunOutputChunk>; image: (maxSide?: number) => Promise<ArtifactImage>;
}> {
  const accountId = required(input?.accountId), reference = referenceOf(input?.reference);
  let sourcePath: string;
  let canSaveToLibrary = false;
  if (reference.itemId) {
    const item = atlasService.get({ accountId, id: reference.itemId });
    if (!item || item.trashedAt || !["file", "image", ...(bookmarkPreview ? ["bookmark"] : [])].includes(item.kind)) throw new Error("Atlas file not found");
    canSaveToLibrary = item.sourceKey?.startsWith("page:") === true && !isAtlasLibraryItem(item);
    sourcePath = (await inspectSource(await atlasService.resolveFile({ accountId, id: reference.itemId }), [atlasRoot()])).real;
  } else {
    const { runsService, run, selected } = generated ?? await selectGenerated(accountId, reference);
    if (selected.replica) {
      const replica = selected.replica;
      if (replica.attachmentId) {
        const descriptor = await runsService.describeAttachmentFile({ runId: run.id, attachmentId: replica.attachmentId });
        return { file: { ...descriptor, reference }, read: (offset, version) => runsService.readAttachmentChunk({ runId: run.id, attachmentId: replica.attachmentId!, offset, version }),
          image: (maxSide = 128) => runsService.readAttachmentImage({ runId: run.id, attachmentId: replica.attachmentId!, maxSide }) };
      }
      if (replica.artifactId !== undefined) {
        const descriptor = (await runsService.listOutputs({ runId: run.id, artifactId: replica.artifactId })).items[0];
        if (!descriptor) throw new Error("Atlas output is unavailable on its source device");
        return { file: { ...descriptor, reference }, read: (offset, version) => runsService.readOutputFile({ runId: run.id, artifactId: replica.artifactId!, offset, version }),
          image: (maxSide = 128) => runsService.readArtifactImage({ runId: run.id, artifactId: replica.artifactId!, maxSide }) };
      }
      throw new Error("Atlas file is unavailable on its source device");
    }
    sourcePath = selected.path;
  }
  const stat = await fs.lstat(sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(sourcePath) !== sourcePath
    || stat.size > MOBILE_OUTPUT_MAX_BYTES) throw new Error("Atlas file is unavailable or exceeds 100 MB");
  const name = sourcePath.replace(/\\/g, "/").split("/").pop()!;
  const file = { reference, name, byteSize: stat.size, modifiedAt: stat.mtimeMs, canSaveToLibrary,
    version: signature(accountId, reference, stat), ...outputFileType(name) };
  return { file, read: (offset, version) => readRunFileChunk({ ...file, runId: "atlas" }, sourcePath, { offset, version }, (stats) => signature(accountId, reference, stats)),
    image: async (maxSide = 128) => {
      const preview = await readImagePreview(sourcePath, maxSide, { preserveAlpha: true });
      return { mime: preview.mime, base64: preview.bytes.toString("base64"), width: preview.width, height: preview.height };
    } };
}
