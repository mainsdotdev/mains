import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { ImagePreviewModal } from "@/features/workspace/components/image-preview-modal";

import { useAtlasFilePath } from "../hooks/use-atlas-file-path";

export function AtlasImagePreview({ title, path, accountId, id, onClose }: {
  title: string;
  accountId?: string;
  id?: string;
  path: string | null;
  onClose: () => void;
}) {
  const resolved = useAtlasFilePath(accountId, id, path);
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
