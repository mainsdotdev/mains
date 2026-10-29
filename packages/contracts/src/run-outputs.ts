export const OUTPUT_CHUNK_BYTES = 128 * 1024;
export const MOBILE_OUTPUT_MAX_BYTES = 100 * 1024 * 1024;

export type OutputPreviewType = "image" | "markdown" | "text" | "native" | "unsupported";
export interface RunFileDescriptor {
  runId: string;
  name: string;
  mimeType: string;
  byteSize: number;
  modifiedAt: number;
  /** Revision of this selected file, checked on every chunk. */
  version: string;
  previewType: OutputPreviewType;
}
export interface RunOutput extends RunFileDescriptor { artifactId: number }
export interface RunAttachmentFile extends RunFileDescriptor { attachmentId: string }
export type RunFile = RunOutput | RunAttachmentFile;
export interface ReadRunAttachmentPayload { runId: string; attachmentId: string; version: string; offset: number }
export interface ListRunOutputsPayload { runId: string; offset?: number; artifactId?: number }
export interface RunOutputsPage { items: RunOutput[]; nextOffset: number | null }
export interface ReadRunOutputPayload { runId: string; artifactId: number; version: string; offset: number }
export interface RunOutputChunk { base64: string; offset: number; nextOffset: number | null; byteSize: number; version: string }

export function outputFileType(name: string): { mimeType: string; previewType: OutputPreviewType } {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const types: Record<string, { mimeType: string; previewType: OutputPreviewType }> = {
    md: { mimeType: "text/markdown", previewType: "markdown" }, markdown: { mimeType: "text/markdown", previewType: "markdown" },
    txt: { mimeType: "text/plain", previewType: "text" }, csv: { mimeType: "text/csv", previewType: "text" },
    pdf: { mimeType: "application/pdf", previewType: "native" },
    docx: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", previewType: "native" },
    doc: { mimeType: "application/msword", previewType: "native" },
    xlsx: { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", previewType: "native" },
    pptx: { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", previewType: "native" },
  };
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "heic"].includes(extension)) {
    return { mimeType: `image/${extension === "jpg" ? "jpeg" : extension === "svg" ? "svg+xml" : extension}`, previewType: "image" };
  }
  return types[extension] ?? { mimeType: "application/octet-stream", previewType: "unsupported" };
}
