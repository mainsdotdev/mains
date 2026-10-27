import { CHANNELS } from "@mains/contracts/channels";
import { OUTPUT_CHUNK_BYTES, outputFileType, type ReadRunAttachmentPayload, type RunAttachmentFile, type RunOutputChunk } from "@mains/contracts/run-outputs";
import type { AttachmentFile } from "@mains/contracts/runs";
import { isDesktopOnlyOutput } from "../lib/output-presentation";
import type { WsTransport } from "./ws-transport";

type Transport = Pick<WsTransport, "invoke">;
export interface AttachmentFileHint { name: string; byteSize?: number; mimeType?: string }

// Old backends return the whole original in one frame. Keep compatibility well
// below the paired transport's 4 MiB frame limit; larger files need the new reader.
export const LEGACY_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
const LEGACY_CACHE_MAX_BYTES = 4 * 1024 * 1024;
const DESKTOP_UPDATE = "Update and restart Mains on your computer to open this attachment, then try again.";
const keyFor = (backendId: string, runId: string, attachmentId: string) => JSON.stringify([backendId, runId, attachmentId]);
const unavailable = (error: string, channel: string) => error === `Channel "${channel}" is not available to paired devices`;
type LegacyCopy = { file: RunAttachmentFile; bytes: Uint8Array; expiresAt: number };

export class AttachmentFileReader {
  private readonly legacy = new Map<string, LegacyCopy>();
  private generation = 0;

  clear(): void { this.generation++; this.legacy.clear(); }

  async describe(transport: Transport, backendId: string, runId: string, attachmentId: string, hint?: AttachmentFileHint | null): Promise<RunAttachmentFile> {
    const generation = this.generation;
    const result = await transport.invoke(CHANNELS.runArtifacts.describeAttachmentFile, [{ runId, attachmentId }]);
    if (result.success) {
      this.legacy.delete(keyFor(backendId, runId, attachmentId));
      return result.data as RunAttachmentFile;
    }
    if (!unavailable(result.error, CHANNELS.runArtifacts.describeAttachmentFile)) throw new Error(result.error);
    const byteSize = hint?.byteSize;
    if (!/^[a-f0-9]{64}$/.test(attachmentId) || !hint || typeof byteSize !== "number" || !Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > LEGACY_ATTACHMENT_MAX_BYTES) throw new Error(DESKTOP_UPDATE);
    if (isDesktopOnlyOutput(hint)) throw new Error("See on desktop");
    const original = await transport.invoke(CHANNELS.runArtifacts.readAttachmentFile, [{ runId, attachmentId }]);
    if (!original.success) throw new Error(unavailable(original.error, CHANNELS.runArtifacts.readAttachmentFile) ? DESKTOP_UPDATE : original.error);
    const data = original.data as AttachmentFile;
    if (!data || data.attachmentId !== attachmentId || data.type !== "document" || data.name !== hint.name || typeof data.mimeType !== "string" ||
      data.byteSize !== hint.byteSize || typeof data.base64 !== "string" || data.base64.length > Math.ceil(LEGACY_ATTACHMENT_MAX_BYTES / 3) * 4) throw new Error("This attachment changed. Reload the conversation and try again.");
    if (isDesktopOnlyOutput(data)) throw new Error("See on desktop");
    const bytes = Uint8Array.from(atob(data.base64), (character) => character.charCodeAt(0));
    if (bytes.length !== data.byteSize) throw new Error("Incomplete attachment download. Try again.");
    if (generation !== this.generation) throw new Error("The connected computer changed");
    // Durable originals are immutable; their identity is a stable legacy revision.
    const file: RunAttachmentFile = { runId, attachmentId, name: data.name, mimeType: data.mimeType, byteSize: data.byteSize, modifiedAt: 0, version: attachmentId, previewType: outputFileType(data.name).previewType };
    this.prune();
    this.legacy.set(keyFor(backendId, runId, attachmentId), { file, bytes, expiresAt: Date.now() + 60_000 });
    this.prune();
    return file;
  }

  async readChunk(transport: Transport, backendId: string, request: ReadRunAttachmentPayload): Promise<RunOutputChunk> {
    this.prune();
    const key = keyFor(backendId, request.runId, request.attachmentId);
    const copy = this.legacy.get(key);
    if (copy) {
      if (request.version !== copy.file.version || !Number.isSafeInteger(request.offset) || request.offset < 0 || request.offset > copy.bytes.length) throw new Error("The attachment changed. Open it again.");
      const bytes = copy.bytes.subarray(request.offset, request.offset + OUTPUT_CHUNK_BYTES);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const nextOffset = request.offset + bytes.length < copy.bytes.length ? request.offset + bytes.length : null;
      copy.expiresAt = Date.now() + 60_000;
      if (nextOffset === null) this.legacy.delete(key);
      return { base64: btoa(binary), offset: request.offset, nextOffset, version: copy.file.version, byteSize: copy.bytes.length };
    }
    if (request.version === request.attachmentId) throw new Error("This attachment download expired. Open the file again.");
    const result = await transport.invoke(CHANNELS.runArtifacts.readAttachmentChunk, [request]);
    if (!result.success) throw new Error(unavailable(result.error, CHANNELS.runArtifacts.readAttachmentChunk) ? DESKTOP_UPDATE : result.error);
    return result.data as RunOutputChunk;
  }

  private prune(): void {
    for (const [key, copy] of this.legacy) if (copy.expiresAt < Date.now()) this.legacy.delete(key);
    let bytes = [...this.legacy.values()].reduce((total, copy) => total + copy.bytes.length, 0);
    for (const [key, copy] of this.legacy) {
      if (bytes <= LEGACY_CACHE_MAX_BYTES) break;
      this.legacy.delete(key); bytes -= copy.bytes.length;
    }
  }
}
