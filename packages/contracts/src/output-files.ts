export const OUTPUT_FILE_MAX_BYTES = 100 * 1024 * 1024;
export const DOCUMENT_PREVIEW_MAX_BYTES = 25 * 1024 * 1024;
export const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export type OutputRole = "deliverable" | "working" | "preview";
export type OutputDocumentType = "md" | "txt" | "pdf" | "docx" | "pptx" | "xlsx";
export const OUTPUT_DOCUMENT_TYPES: Readonly<Record<string, OutputDocumentType>> = {
  md: "md", markdown: "md", txt: "txt", csv: "txt", pdf: "pdf", docx: "docx", pptx: "pptx", xlsx: "xlsx",
};
export const OUTPUT_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);
export type OutputMediaType = "audio" | "video";
const MEDIA_MIME_TYPES: Readonly<Record<string, string>> = {
  wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac",
  aif: "audio/aiff", aiff: "audio/aiff", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};
export function outputMediaMimeType(extension: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(MEDIA_MIME_TYPES, extension) ? MEDIA_MIME_TYPES[extension] : undefined;
}
export function isOutputMediaType(type: string): type is OutputMediaType {
  return type === "audio" || type === "video";
}
export function documentPreviewLimit(type: OutputDocumentType | OutputMediaType): number {
  if (isOutputMediaType(type)) return OUTPUT_FILE_MAX_BYTES;
  return type === "md" || type === "txt" ? TEXT_PREVIEW_MAX_BYTES : DOCUMENT_PREVIEW_MAX_BYTES;
}
