import { CHANNELS } from "@mains/contracts/channels";
import { PR_ATTACHMENT_CHUNK_BYTES, type CreatePrResult } from "@mains/contracts/pr-attachments";
import { getTransport } from "@/lib/transport";

function base64Chunk(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the attachment."));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(blob);
  });
}

/** Files stay outside Redux. Stage bounded chunks on one backend, then use the existing PR mutation. */
export async function withPrAttachments(
  workspaceId: string,
  files: File[],
  create: (ids: string[]) => Promise<CreatePrResult>,
  progress: (message: string) => void,
  signal: AbortSignal,
): Promise<CreatePrResult> {
  const transport = getTransport();
  const ids: string[] = [];
  const assertCurrent = () => {
    if (signal.aborted || getTransport() !== transport) throw new Error("The workspace or backend changed. Please try again.");
  };
  try {
    for (const [index, file] of files.entries()) {
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
        if (!uploadId) ids.push(result.uploadId);
        uploadId = result.uploadId;
        const percent = Math.round(Math.min(offset + PR_ATTACHMENT_CHUNK_BYTES, file.size) / file.size * 100);
        progress(`Preparing attachment ${index + 1}/${files.length} · ${percent}%`);
      }
    }
    assertCurrent();
    progress("Creating pull request…");
    // No await between the backend guard and the RTK mutation's synchronous invocation.
    return await create(ids);
  } finally {
    // Creation releases files server-side. Best-effort cleanup must not delay the result on a disconnected transport.
    if (ids.length) void transport.invoke(CHANNELS.gitFlow.discardPrAttachments, [workspaceId, ids]).catch(() => undefined);
  }
}
