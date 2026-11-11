import { ResourceCleanupError } from "../../runtime/resource-lifecycle";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PR_ATTACHMENT_CHUNK_BYTES, PR_ATTACHMENT_LIMIT, validatePrMedia, type PrAttachmentChunk } from "@mains/contracts/pr-attachments";

const UPLOAD_TTL = 30 * 60_000;
interface Upload {
  workspaceId: string; name: string; size: number; written: number;
  directory: string; path: string; updatedAt: number;
  phase: "receiving" | "writing" | "claimed" | "cleaning"; removing?: Promise<void>;
}

/** Backend-only temporary files; callers never supply a filesystem path. */
export function createPrAttachmentStorage() {
  const uploads = new Map<string, Upload>();
  const claims = new Set<Promise<void>>();
  const writes = new Set<Promise<unknown>>();
  const bodies = new Set<string>();
  let phase: "open" | "closing" | "closed" = "open", closing: Promise<void> | undefined;
  const track = <T>(pending: Promise<T>): Promise<T> => {
    writes.add(pending);
    void pending.then(() => writes.delete(pending), () => writes.delete(pending));
    return pending;
  };
  const purgeBody = async (directory: string) => {
    await rm(directory, { recursive: true, force: true }); bodies.delete(directory);
  };
  const discard = async (workspaceId: string, ids: string[]) => {
    for (const id of ids) {
      const upload = uploads.get(id);
      if (!upload || upload.workspaceId !== workspaceId || (upload.phase === "writing" || upload.phase === "claimed")) continue;
      upload.phase = "cleaning";
      if (!upload.removing) {
        const pending = rm(upload.directory, { recursive: true, force: true }).then(() => { if (uploads.get(id) === upload) uploads.delete(id); });
        upload.removing = pending;
        void pending.catch(() => { if (upload.removing === pending) upload.removing = undefined; });
      }
      await upload.removing;
    }
  };
  const sweep = async () => {
    for (const [id, upload] of uploads) {
      if (Date.now() - upload.updatedAt > UPLOAD_TTL) await discard(upload.workspaceId, [id]);
    }
  };
  const timer = setInterval(() => { void sweep().catch(() => undefined); }, UPLOAD_TTL);
  timer.unref();

  async function writeAdmitted(chunk: PrAttachmentChunk): Promise<{ uploadId: string }> {
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
        directory: "", path: "", updatedAt: Date.now(), phase: "writing" };
      // Reserve the slot before the asynchronous directory creation.
      uploads.set(id, upload);
      try {
        upload.directory = await mkdtemp(join(tmpdir(), "mains-pr-media-"));
        upload.path = join(upload.directory, name);
      } catch (error) { uploads.delete(id); throw error; }
      if (upload.phase === "writing") upload.phase = "receiving";
    }
    if (!upload || upload.workspaceId !== chunk.workspaceId || upload.name !== chunk.name || upload.size !== chunk.size) throw new Error("PR attachment not found. Please add the file again.");
    if (upload.phase !== "receiving" || upload.written !== chunk.offset) throw new Error("PR attachment chunks arrived out of order.");
    upload.phase = "writing";
    try {
      await writeFile(upload.path, bytes, { flag: chunk.offset === 0 ? "wx" : "a", mode: 0o600 });
      upload.written += bytes.length;
      upload.updatedAt = Date.now();
      return { uploadId: id! };
    } catch (error) {
      upload.phase = "cleaning";
      await discard(chunk.workspaceId, [id!]).catch(() => undefined);
      throw error;
    } finally { if (upload.phase === "writing") upload.phase = "receiving"; }
  }

  const storage = {
    write(chunk: PrAttachmentChunk): Promise<{ uploadId: string }> {
      if (phase !== "open") return Promise.reject(new Error("PR attachment storage is closed"));
      return track(writeAdmitted(chunk));
    },
    claim(workspaceId: string, ids: string[]): { paths: string[]; references: Map<string, string>; release: (options?: { retain?: boolean }) => Promise<void> } {
      if (phase !== "open") throw new Error("PR attachment storage is closed");
      if (!Array.isArray(ids) || ids.length > PR_ATTACHMENT_LIMIT || new Set(ids).size !== ids.length) throw new Error("Invalid PR attachments.");
      const selected = ids.map((id) => {
        const upload = uploads.get(id);
        if (!upload || upload.workspaceId !== workspaceId || upload.phase !== "receiving" || upload.written !== upload.size) throw new Error("PR attachment is incomplete or unavailable. Please try again.");
        return upload;
      });
      selected.forEach((upload) => { upload.phase = "claimed"; });
      let finish!: () => void, releasing: Promise<void> | undefined;
      const held = new Promise<void>((resolve) => { finish = resolve; }); claims.add(held);
      return { paths: selected.map((upload) => upload.path), references: new Map(ids.map((id, index) => [id, selected[index].path])), release: (options) => {
        if (releasing) return releasing;
        const pending = (async () => {
          try {
            const retain = options?.retain && phase === "open";
            if (retain && selected.some((upload) => upload.phase === "cleaning")) throw new Error("PR attachment cleanup already started");
            selected.forEach((upload) => { upload.phase = retain ? "receiving" : "cleaning"; upload.updatedAt = Date.now(); });
            if (!retain) await discard(workspaceId, ids);
          }
          finally { claims.delete(held); finish(); }
        })();
        releasing = pending;
        void pending.catch(() => { if (releasing === pending) releasing = undefined; });
        return pending;
      } };
    },
    discard,
    get accepting() { return phase === "open"; },
    get disposed() { return phase === "closed"; },
    withBody<T>(body: string, work: (bodyPath: string) => Promise<T>): Promise<T> {
      if (phase !== "open") return Promise.reject(new Error("PR attachment storage is closed"));
      return track((async () => {
        const directory = await mkdtemp(join(tmpdir(), "mains-pr-body-")); bodies.add(directory);
        try {
          const file = join(directory, "body.md");
          await writeFile(file, body, { mode: 0o600 });
          return await work(file);
        } finally {
          await purgeBody(directory).catch((error) => { console.error("[GitFlow] PR body cleanup pending:", error); });
        }
      })());
    },
    dispose(): Promise<void> {
      if (closing) return closing;
      phase = "closing";
      clearInterval(timer);
      const pending = (async () => {
        await Promise.allSettled([...writes]);
        await Promise.all([...claims]);
        const results = await Promise.allSettled([
          ...[...uploads].map(([id, upload]) => discard(upload.workspaceId, [id])),
          ...[...bodies].map(purgeBody),
        ]);
        const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
        if (errors.length) throw new ResourceCleanupError(errors, "PR temporary file cleanup failed", storage.dispose);
        phase = "closed";
      })();
      closing = pending; void pending.catch(() => { if (closing === pending) closing = undefined; });
      return pending;
    },
  };
  return storage;
}

export let prAttachmentStorage = createPrAttachmentStorage();
export function openPrAttachmentStorage(): void {
  if (prAttachmentStorage.disposed) prAttachmentStorage = createPrAttachmentStorage();
  else if (!prAttachmentStorage.accepting) throw new Error("PR temporary file cleanup is still pending");
}
