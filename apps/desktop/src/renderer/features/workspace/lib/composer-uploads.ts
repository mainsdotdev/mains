import type { UploadedFile } from "@/components/ui";

function looksLikeImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|heic|svg)$/i.test(file.name);
}

/** Matches toolbar document picker: pdf, doc, docx, txt. */
function looksLikeDocumentFile(file: File): boolean {
  const mime = file.type.toLowerCase();
  if (
    mime === "application/pdf" ||
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "text/plain"
  ) return true;
  return /\.(pdf|doc|docx|txt)$/i.test(file.name);
}

export function addComposerUploads(
  files: Iterable<File>,
  uploadedFiles: UploadedFile[],
  onUploadedFilesChange?: (files: UploadedFile[]) => void,
  attachmentMode: "all" | "images" = "all",
): boolean {
  if (!onUploadedFilesChange) return false;
  const accepted = Array.from(files).filter((file) =>
    looksLikeImageFile(file) || (attachmentMode === "all" && looksLikeDocumentFile(file)));
  if (accepted.length === 0) return false;
  onUploadedFilesChange([...uploadedFiles, ...accepted.map((file) => {
    const isImage = looksLikeImageFile(file);
    return {
      file,
      type: isImage ? "image" as const : "document" as const,
      preview: isImage ? URL.createObjectURL(file) : undefined,
    };
  })]);
  return true;
}
