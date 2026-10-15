export const OUTPUT_FILE_MAX_BYTES = 100 * 1024 * 1024;
export const DOCUMENT_PREVIEW_MAX_BYTES = 25 * 1024 * 1024;
export const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export type OutputRole = "deliverable" | "working" | "preview";
export type OutputDocumentType = "md" | "txt" | "pdf" | "docx" | "pptx" | "xlsx";
export const OUTPUT_DOCUMENT_TYPES: Readonly<Record<string, OutputDocumentType>> = {
  md: "md", markdown: "md", txt: "txt", csv: "txt", pdf: "pdf", docx: "docx", pptx: "pptx", xlsx: "xlsx",
};
export const OUTPUT_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);
export function documentPreviewLimit(type: OutputDocumentType): number {
  return type === "md" || type === "txt" ? TEXT_PREVIEW_MAX_BYTES : DOCUMENT_PREVIEW_MAX_BYTES;
}
