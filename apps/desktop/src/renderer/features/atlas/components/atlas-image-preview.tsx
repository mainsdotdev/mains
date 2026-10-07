import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { ImagePreviewModal } from "@/features/workspace/components/image-preview-modal";

export function AtlasImagePreview({ title, path, onClose }: {
  title: string;
  path: string | null;
  onClose: () => void;
}) {
  const src = useLocalImageUrl(path ?? "");
  return (
    <ImagePreviewModal
      name={title}
      src={src ?? ""}
      onClose={onClose}
      status={!src ? "Opening image…" : undefined}
    />
  );
}
