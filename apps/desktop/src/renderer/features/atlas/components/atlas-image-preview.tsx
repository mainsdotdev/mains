import type { AtlasGeneratedFile } from "@mains/contracts/atlas";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { ImagePreviewModal } from "@/features/workspace/components/image-preview-modal";

import { useAtlasFilePath } from "../hooks/use-atlas-file-path";

export function AtlasImagePreview({ title, path, accountId, id, generated, onClose }: {
  title: string;
  accountId?: string;
  id?: string;
  path: string | null;
  /** Another device's conversation file resolves through its synced record. */
  generated?: AtlasGeneratedFile;
  onClose: () => void;
}) {
  const resolved = useAtlasFilePath(accountId, id, path, generated);
  const src = useLocalImageUrl(resolved ?? "");
  return (
    <ImagePreviewModal
      name={title}
      src={src ?? ""}
      onClose={onClose}
      status={!src ? "Opening image…" : undefined}
    />
  );
}
