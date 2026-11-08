import { CHANNELS } from "@mains/contracts/channels";
import { PR_ATTACHMENT_CHUNK_BYTES, type CreatePrResult } from "@mains/contracts/pr-attachments";
import { getTransport, onTransportChange } from "@/lib/transport";

function base64Chunk(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the attachment."));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(blob);
  });
}

interface Staging {
  workspaceId: string; files: File[]; transport: ReturnType<typeof getTransport>;
  ids: string[]; ready: boolean; retired: boolean; pending?: Promise<CreatePrResult>; cleanup(): void;
}
const retries = new Map<string, Staging>();

/** Retain complete uploads for an equal logical retry. A view/transport change
 * retires the owner permanently, including a switch back to the same backend. */
export function withPrAttachments(
  workspaceId: string,
  files: File[],
  create: (ids: string[]) => Promise<CreatePrResult>,
  progress: (message: string) => void,
  signal: AbortSignal,
  operationId?: string,
): Promise<CreatePrResult> {
  const transport = getTransport();
  let staging = operationId ? retries.get(operationId) : undefined;
  if (staging && (staging.workspaceId !== workspaceId || staging.transport !== transport || staging.files.length !== files.length || files.some((file, i) => staging!.files[i] !== file))) {
    return Promise.reject(new Error("PR request inputs changed. Start a new request."));
  }
  if (staging?.pending) return staging.pending;
  if (!staging) {
    const entry: Staging = { workspaceId, files: [...files], transport, ids: [], ready: false, retired: false, cleanup() {
      entry.retired = true;
      off(); signal.removeEventListener("abort", entry.cleanup);
      if (operationId && retries.get(operationId) === entry) retries.delete(operationId);
      if (entry.ids.length) void transport.invoke(CHANNELS.gitFlow.discardPrAttachments, [workspaceId, [...entry.ids]]).catch(() => undefined);
    } };
    const off = onTransportChange(entry.cleanup);
    signal.addEventListener("abort", entry.cleanup, { once: true });
    staging = entry;
    if (operationId) retries.set(operationId, entry);
  }
  const entry = staging;
  const assertCurrent = () => {
    if (entry.retired || signal.aborted || getTransport() !== transport) throw new Error("The workspace or backend changed. Please try again.");
  };
  const pending = (async () => {
    let accepted = false;
    try {
      if (!entry.ready) for (const [index, file] of files.entries()) {
        let uploadId: string | undefined;
        for (let offset = 0; offset < file.size; offset += PR_ATTACHMENT_CHUNK_BYTES) {
          assertCurrent();
          const data = await base64Chunk(file.slice(offset, offset + PR_ATTACHMENT_CHUNK_BYTES));
          assertCurrent();
          const response = await transport.invoke(CHANNELS.gitFlow.stagePrAttachment, [{
            workspaceId, uploadId, name: file.name, size: file.size, offset, data,
          }]);
          if (!response.success) throw new Error(response.error);
          const result = response.data as { uploadId: string };
          if (!uploadId) entry.ids.push(result.uploadId);
          uploadId = result.uploadId;
          assertCurrent();
          const percent = Math.round(Math.min(offset + PR_ATTACHMENT_CHUNK_BYTES, file.size) / file.size * 100);
          progress(`Preparing attachment ${index + 1}/${files.length} · ${percent}%`);
        }
      }
      entry.ready = true;
      assertCurrent();
      progress("Creating pull request…");
      const result = await create([...entry.ids]);
      accepted = true;
      return result;
    } finally {
      // Legacy callers do not supply a logical retry identity.
      if (accepted || !operationId || !entry.ready || entry.retired || signal.aborted) entry.cleanup();
    }
  })();
  entry.pending = pending;
  const finished = () => { if (entry.pending === pending) entry.pending = undefined; };
  void pending.then(finished, finished);
  return pending;
}
