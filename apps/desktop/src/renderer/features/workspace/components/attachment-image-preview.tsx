import { useAttachmentImage } from "../lib/attachment-image";
import { ImagePreviewModal } from "./image-preview-modal";
import { appApi } from "@/lib/transport";
import { toast } from "@/components/ui";
import type { AttachmentFile } from "@mains/contracts/runs";

export function AttachmentImagePreview({ runId, attachmentId, name, fallbackSrc, onClose }: {
  runId: string;
  attachmentId: string;
  name: string;
  fallbackSrc?: string;
  onClose: () => void;
}) {
  const image = useAttachmentImage(runId, attachmentId, 1600, true);
  const download = async () => {
    try {
      const response = await appApi.runArtifacts.readAttachmentFile({ runId, attachmentId });
      if (!response.success) throw new Error(response.error);
      const original = response.data as AttachmentFile;
      const binary = atob(original.base64);
      const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: original.mimeType }));
      try {
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = original.name;
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
      } finally { URL.revokeObjectURL(url); }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not download attachment"); }
  };
  return <ImagePreviewModal name={name} src={image.src ?? fallbackSrc ?? ""} onClose={onClose} onDownload={download}
    status={image.error ?? (!image.src ? "Loading preview…" : undefined)} />;
}
