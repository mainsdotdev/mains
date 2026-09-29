import { useState } from "react";
import { Button } from "@/components/ui";
import { Picture } from "@/components/ui/icons";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { ImagePreviewModal } from "../image-preview-modal";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader } from "./_shared";

export interface ImageViewParams {
  path?: string;
}

/** Codex imageView is an inspection step, not a generated-image deliverable. */
export function ImageViewDisplay({
  params,
  isCompact = false,
}: {
  params: ImageViewParams;
  isCompact?: boolean;
}) {
  const imagePath = params.path ?? "";
  const fileName = imagePath.split("/").pop() || "image";
  const url = useLocalImageUrl(imagePath);
  const [isExpanded, setIsExpanded] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);

  return (
    <div>
      <ToolHeader
        icon={<Picture className="size-4" />}
        verb="Viewed"
        hasDetails={!!imagePath}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((open) => !open)}
        isCompact={isCompact}
      >
        <span className={`truncate ${TOOL_ROW_TEXT}`}>{fileName}</span>
      </ToolHeader>
      {imagePath && (
        <ToolCollapse isExpanded={isExpanded}>
          <Button
            type="button"
            onClick={() => url && setPreviewOpen(true)}
            className="my-1 block overflow-hidden rounded-lg border border-primary-200/60 dark:border-primary-800/60"
            title={`Preview ${fileName}`}
          >
            {url && !thumbFailed ? (
              <img
                src={url}
                alt={fileName}
                className="block max-h-32 max-w-32 object-contain"
                loading="lazy"
                onError={() => setThumbFailed(true)}
              />
            ) : (
              <span className="flex h-24 w-24 items-center justify-center">
                <Picture className="size-6 text-primary-500" />
              </span>
            )}
          </Button>
        </ToolCollapse>
      )}
      {previewOpen && url && !thumbFailed && (
        <ImagePreviewModal
          name={fileName}
          src={url}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}
