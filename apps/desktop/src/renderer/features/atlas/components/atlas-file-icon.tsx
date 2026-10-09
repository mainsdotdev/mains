import type { AtlasKind } from "@mains/contracts/atlas";
import { Document, Picture } from "@/components/ui/icons";
import { DOC_TYPE_ICONS } from "@/features/workspace/components/document-viewer/doc-type-icons";
import { classifyDocType } from "@/lib/document-viewer";

export function AtlasFileIcon({ kind, fileName, path, className }: {
  kind: AtlasKind;
  fileName?: string | null;
  path?: string | null;
  className?: string;
}) {
  const docType = classifyDocType(fileName ?? "") ?? classifyDocType(path ?? "");
  const Icon = kind === "image" ? Picture : docType ? DOC_TYPE_ICONS[docType] : Document;
  return <Icon aria-hidden="true" className={className} />;
}
