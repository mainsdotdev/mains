import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PR_ATTACHMENT_CHUNK_BYTES, PR_ATTACHMENT_LIMIT, validatePrMedia, type PrAttachmentChunk } from "@mains/contracts/pr-attachments";

const UPLOAD_TTL = 30 * 60_000;
interface Upload {
  workspaceId: string; name: string; size: number; written: number;
  directory: string; path: string; updatedAt: number; busy: boolean; claimed: boolean;
}

/** Backend-only temporary files; callers never supply a filesystem path. */
export function createPrAttachmentStorage() {
  const uploads = new Map<string, Upload>();
  const discard = async (workspaceId: string, ids: string[]) => {
    for (const id of ids) {
      const upload = uploads.get(id);
      if (!upload || upload.workspaceId !== workspaceId || upload.busy || upload.claimed) continue;
      uploads.delete(id);
      await rm(upload.directory, { recursive: true, force: true });
    }
  };
  const sweep = async () => {
    for (const [id, upload] of uploads) {
      if (Date.now() - upload.updatedAt > UPLOAD_TTL) await discard(upload.workspaceId, [id]);
    }
  };
  const timer = setInterval(() => { void sweep().catch(() => undefined); }, UPLOAD_TTL);
  timer.unref();

  return {
    async write(chunk: PrAttachmentChunk): Promise<{ uploadId: string }> {
      const error = typeof chunk.name === "string" ? validatePrMedia(chunk.name, chunk.size) : "Invalid attachment name.";
      if (error) throw new Error(error);
      if (typeof chunk.workspaceId !== "string" || !chunk.workspaceId || !Number.isSafeInteger(chunk.offset) || chunk.offset < 0 ||
        typeof chunk.data !== "string" || !chunk.data || chunk.data.length > Math.ceil(PR_ATTACHMENT_CHUNK_BYTES / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(chunk.data)) {
        throw new Error("Invalid attachment chunk.");
      }
      const bytes = Buffer.from(chunk.data, "base64");
      if (!bytes.length || bytes.length > PR_ATTACHMENT_CHUNK_BYTES || chunk.offset + bytes.length > chunk.size) throw new Error("Invalid attachment chunk size.");
      await sweep();
      let id = chunk.uploadId;
      let upload = id ? uploads.get(id) : undefined;
      if (!id) {
        if (chunk.offset !== 0) throw new Error("The attachment must start at offset zero.");
        if ([...uploads.values()].filter((entry) => entry.workspaceId === chunk.workspaceId).length >= PR_ATTACHMENT_LIMIT || uploads.size >= 200) {
          throw new Error("Too many pending PR attachments. Remove an attachment or try again later.");
        }
        // A generated directory scopes each file; '#' must not become gh alt-text syntax.
        // eslint-disable-next-line no-control-regex -- control characters are invalid filename content
        const name = chunk.name.replace(/[/\\#\x00-\x1f\x7f]/g, "_").slice(-180);
        id = randomUUID();
        upload = { workspaceId: chunk.workspaceId, name: chunk.name, size: chunk.size, written: 0,
          directory: "", path: "", updatedAt: Date.now(), busy: true, claimed: false };
        // Reserve the slot before the asynchronous directory creation.
        uploads.set(id, upload);
        try {
          upload.directory = await mkdtemp(join(tmpdir(), "mains-pr-media-"));
          upload.path = join(upload.directory, name);
        } catch (error) { uploads.delete(id); throw error; }
        upload.busy = false;
      }
      if (!upload || upload.workspaceId !== chunk.workspaceId || upload.name !== chunk.name || upload.size !== chunk.size) throw new Error("PR attachment not found. Please add the file again.");
      if (upload.busy || upload.claimed || upload.written !== chunk.offset) throw new Error("PR attachment chunks arrived out of order.");
      upload.busy = true;
      try {
        await writeFile(upload.path, bytes, { flag: chunk.offset === 0 ? "wx" : "a", mode: 0o600 });
        upload.written += bytes.length;
        upload.updatedAt = Date.now();
        return { uploadId: id! };
      } catch (error) {
        uploads.delete(id!);
        await rm(upload.directory, { recursive: true, force: true });
        throw error;
      } finally { upload.busy = false; }
    },
    claim(workspaceId: string, ids: string[]): { paths: string[]; references: Map<string, string>; release: () => Promise<void> } {
      if (!Array.isArray(ids) || ids.length > PR_ATTACHMENT_LIMIT || new Set(ids).size !== ids.length) throw new Error("Invalid PR attachments.");
      const selected = ids.map((id) => {
        const upload = uploads.get(id);
        if (!upload || upload.workspaceId !== workspaceId || upload.busy || upload.claimed || upload.written !== upload.size) throw new Error("PR attachment is incomplete or unavailable. Please try again.");
        return upload;
      });
      selected.forEach((upload) => { upload.claimed = true; });
      return { paths: selected.map((upload) => upload.path), references: new Map(ids.map((id, index) => [id, selected[index].path])), release: async () => {
        selected.forEach((upload) => { upload.claimed = false; });
        await discard(workspaceId, ids);
      } };
    },
    discard,
    async dispose() {
      clearInterval(timer);
      for (const [id, upload] of uploads) { upload.claimed = false; upload.busy = false; await discard(upload.workspaceId, [id]); }
    },
  };
}

export const prAttachmentStorage = createPrAttachmentStorage();
