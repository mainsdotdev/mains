import type { ComponentType, SVGProps } from "react";
import { Word, Excel, Powerpoint } from "@/components/ui/icons";
import { MarkdownFileIcon } from "@/components/ui/icons/file-icons";
import type { DocType } from "@/lib/document-viewer";

/** Brand icon per viewer DocType. Lives outside `lib/document-viewer.ts` so
 * that module stays React-free for node-only unit tests. */
export const DOC_TYPE_ICONS: Record<
  DocType,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  docx: Word,
  xlsx: Excel,
  pptx: Powerpoint,
  md: MarkdownFileIcon,
};
