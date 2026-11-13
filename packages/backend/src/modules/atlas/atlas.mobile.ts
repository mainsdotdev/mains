import { createHash } from "node:crypto";
import { promises as fs, type Stats } from "node:fs";
import type { AtlasMobileEntry, AtlasMobileFile, AtlasMobileFileRead, AtlasMobileFileReference, AtlasMobileFileRequest,
  AtlasMobileLibraryOptions, AtlasMobileLibraryPage, AtlasMobilePage, AtlasMobilePageRequest,
  AtlasMobileSaveFile, AtlasMobileSaveBookmark, AtlasMobileSavedItem } from "@mains/contracts/atlas-mobile";
import { MOBILE_OUTPUT_MAX_BYTES, outputFileType, type RunOutputChunk } from "@mains/contracts/run-outputs";
import { readRunFileChunk } from "../../../shared/file-chunks";
import { atlasService, generatedForRun } from "./atlas.service";
import { atlasRoot, inspectSource } from "./atlas.storage";

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

export const atlasMobile = {
  async saveBookmark(input: AtlasMobileSaveBookmark): Promise<AtlasMobileSavedItem> {
    const item = await atlasService.saveBookmark({ accountId: required(input?.accountId), url: input?.url,
      ...(input.collectionId !== undefined ? { collectionId: input.collectionId } : {}) });
    return { id: item.id, title: item.title, kind: item.kind };
  },

  async saveFile(input: AtlasMobileSaveFile): Promise<AtlasMobileSavedItem> {
    const accountId = required(input?.accountId), runId = required(input?.runId);
    if (typeof input.version !== "string" || !/^[a-f0-9]{64}$/.test(input.version)
      || [input.artifactId, input.attachmentId, input.sourceKey].filter((value) => value !== undefined).length !== 1
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
        const file = await this.describeFile({ accountId, reference });
        path = selected.selected.path; version = file.version;
      }
      if (version !== input.version) throw new Error("This file changed. Open it again before saving to Atlas.");
      return path;
    };
    const path = await resolve();
    const item = await atlasService.saveFile({ accountId, runId, path }, async () => {
      if (await resolve() !== path) throw new Error("This file changed. Open it again before saving to Atlas.");
    });
    return { id: item.id, title: item.title, kind: item.kind };
  },

  async library(input: AtlasMobileLibraryOptions): Promise<AtlasMobileLibraryPage> {
    required(input?.accountId);
    // Whitelist options; callers cannot opt into full previews or file paths.
    const result = await atlasService.library({ accountId: input.accountId, type: input.type, scope: input.scope,
      collectionId: input.collectionId, query: input.query, tagId: input.tagId, page: input.page });
    const items = result.items.map((entry): AtlasMobileEntry => {
      const saved = entry.saved?.trashedAt ? undefined : entry.saved, generated = entry.generated;
      return { key: entry.key, kind: entry.kind, title: entry.title, date: entry.date, collectionId: entry.collectionId,
        isFavorite: saved?.isFavorite ?? false, origin: generated?.origin ?? (generated ? "generated" : "saved"),
        sourceRunId: generated?.runId ?? saved?.sourceRunId ?? null,
        file: entry.kind === "file" || entry.kind === "image"
          ? saved ? { itemId: saved.id } : generated ? { runId: generated.runId, sourceKey: generated.sourceKey } : null : null,
        pageId: entry.kind === "page" ? saved?.id ?? null : null, icon: saved?.metadata?.icon ?? null,
        url: saved?.url ?? null, description: saved?.description ?? null, note: saved?.note ?? null };
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
    return { id: page.item.id, title: page.item.title, icon: page.item.metadata?.icon ?? null, version: page.item.version,
      markdown: scalars.slice(offset, end).join(""), offset, nextOffset: end < scalars.length ? end : null,
      sourceRunId: page.item.sourceRunId };
  },

  async describeFile(input: AtlasMobileFileRequest): Promise<AtlasMobileFile> {
    return (await resolveFile(input)).file;
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

async function selectGenerated(accountId: string, reference: AtlasMobileFileReference) {
  const { runsService } = await import("../runs");
  const run = await runsService.getRunById(reference.runId!);
  if (!run || run.accountId !== accountId || run.mode !== "work" || run.isArchived) throw new Error("Atlas conversation not found");
  const selected = (await generatedForRun(run.id, accountId, false)).find((file) => file.sourceKey === reference.sourceKey);
  if (!selected) throw new Error("File not found in this conversation’s Atlas outputs");
  return { run, selected, runsService };
}

async function resolveFile(input: AtlasMobileFileRequest, generated?: Awaited<ReturnType<typeof selectGenerated>>): Promise<{ file: AtlasMobileFile; read: (offset: number, version: string) => Promise<RunOutputChunk> }> {
  const accountId = required(input?.accountId), reference = referenceOf(input?.reference);
  let sourcePath: string;
  if (reference.itemId) {
    const item = atlasService.get({ accountId, id: reference.itemId });
    if (!item || item.trashedAt || !["file", "image"].includes(item.kind)) throw new Error("Atlas file not found");
    sourcePath = (await inspectSource(await atlasService.resolveFile({ accountId, id: reference.itemId }), [atlasRoot()])).real;
  } else {
    const { runsService, run, selected } = generated ?? await selectGenerated(accountId, reference);
    if (selected.replica) {
      const replica = selected.replica;
      if (replica.attachmentId) {
        const descriptor = await runsService.describeAttachmentFile({ runId: run.id, attachmentId: replica.attachmentId });
        return { file: { ...descriptor, reference }, read: (offset, version) => runsService.readAttachmentChunk({ runId: run.id, attachmentId: replica.attachmentId!, offset, version }) };
      }
      if (replica.artifactId !== undefined) {
        const descriptor = (await runsService.listOutputs({ runId: run.id, artifactId: replica.artifactId })).items[0];
        if (!descriptor) throw new Error("Atlas output is unavailable on its source device");
        return { file: { ...descriptor, reference }, read: (offset, version) => runsService.readOutputFile({ runId: run.id, artifactId: replica.artifactId!, offset, version }) };
      }
      throw new Error("Atlas file is unavailable on its source device");
    }
    sourcePath = selected.path;
  }
  const stat = await fs.lstat(sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(sourcePath) !== sourcePath
    || stat.size > MOBILE_OUTPUT_MAX_BYTES) throw new Error("Atlas file is unavailable or exceeds 100 MB");
  const name = sourcePath.replace(/\\/g, "/").split("/").pop()!;
  const file = { reference, name, byteSize: stat.size, modifiedAt: stat.mtimeMs,
    version: signature(accountId, reference, stat), ...outputFileType(name) };
  return { file, read: (offset, version) => readRunFileChunk({ ...file, runId: "atlas" }, sourcePath, { offset, version }, (stats) => signature(accountId, reference, stats)) };
}
