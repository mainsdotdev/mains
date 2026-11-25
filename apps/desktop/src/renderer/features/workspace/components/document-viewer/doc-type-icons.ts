import type { ComponentType, SVGProps } from "react";
import { AudioFileIcon, ExcelFileIcon, MarkdownFileIcon, PdfFileIcon, PowerPointFileIcon, TextFileIcon, VideoFileIcon, WordFileIcon } from "@/components/ui/icons/file-icons";
import type { DocType } from "@/lib/document-viewer";

/** Shared file icon per viewer DocType. Lives outside `lib/document-viewer.ts` so
 * that module stays React-free for node-only unit tests. */
export const DOC_TYPE_ICONS: Record<
  DocType,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  docx: WordFileIcon,
  xlsx: ExcelFileIcon,
  pptx: PowerPointFileIcon,
  md: MarkdownFileIcon,
  pdf: PdfFileIcon,
  txt: TextFileIcon,
  audio: AudioFileIcon,
  video: VideoFileIcon,
};
