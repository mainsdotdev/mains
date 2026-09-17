import { useEffect, useState } from "react";
import { Button, Text, type UploadedFile } from "@/components/ui";
import { Close, FileIcon, FileIconComponent, Web } from "@/components/ui/icons";
import { useDocumentViewer } from "@/hooks/use-document-viewer";
import { classifyDocType, isTextDocType } from "@/lib/document-viewer";
import { useComposerContext } from "@/features/workspace/hooks/use-composer-context";
import type { ContextBrowserSelection } from "@/features/workspace/lib/composer-context";
import { ImagePreviewModal } from "./image-preview-modal";

/**
 * A draft attachment has no file on disk yet, so the viewer reads it through a
 * blob URL (one per file). Held outside the component so a remount of the
 * composer can't revoke a URL the viewer is still reading — it is revoked only
 * once its file leaves the composer.
 */
const draftDocumentUrls = new Map<File, string>();

function fileExtension(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : undefined;
}

function browserSelectionLabel(selection: ContextBrowserSelection): string {
  let host = selection.url;
  try {
    host = new URL(selection.url).hostname;
  } catch {
    // Keep the original URL as the useful fallback label.
  }
  const element = selection.componentName || selection.tagName || "selection";
  return `${element} · ${host}`;
}

function RemoveButton({
  name,
  onRemove,
}: {
  name: string;
  onRemove: () => void;
}) {
  return (
    <Button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      aria-label={`Remove ${name}`}
      className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary-950/60 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-primary-950/80 group-hover/attachment:opacity-100 focus-visible:opacity-100 cursor-pointer"
    >
      <Close className="size-3" />
    </Button>
  );
}

interface ComposerAttachmentsProps {
  files: UploadedFile[];
  onRemove: (index: number) => void;
}

/**
 * The uploaded images and documents of the next message, as a row of preview
 * tiles above the prompt. Images open in the preview modal; documents the
 * viewer can render open in the document viewer panel.
 */
export function ComposerAttachments({
  files,
  onRemove,
}: ComposerAttachmentsProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [browserPreviewId, setBrowserPreviewId] = useState<string | null>(null);
  const preview = previewIndex !== null ? files[previewIndex] : undefined;
  const { browserSelections, remove: removeContext } = useComposerContext();
  const browserPreview = browserSelections.find(
    (selection) => selection.id === browserPreviewId,
  );
  const browserPreviewSrc = browserPreview?.screenshotCaptureName
    ? `mains-capture://cap/${browserPreview.screenshotCaptureName}`
    : undefined;
  const { open: openDocument } = useDocumentViewer();
  const hasAttachments = files.length > 0 || browserSelections.length > 0;

  useEffect(() => {
    const present = new Set(files.map((f) => f.file));
    for (const [file, url] of draftDocumentUrls) {
      if (present.has(file)) continue;
      URL.revokeObjectURL(url);
      draftDocumentUrls.delete(file);
    }
  }, [files]);

  const openDraftDocument = (file: File) => {
    const docType = classifyDocType(file.name);
    // Text formats are read from disk by path, which a draft doesn't have.
    if (!docType || isTextDocType(docType)) return;
    let url = draftDocumentUrls.get(file);
    if (!url) {
      url = URL.createObjectURL(file);
      draftDocumentUrls.set(file, url);
    }
    openDocument({ path: url, fileName: file.name, docType });
  };

  return (
    <>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${hasAttachments ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex gap-2 overflow-x-auto noscrollbar px-5 pt-4">
            {browserSelections.map((selection) => {
              const src = selection.screenshotCaptureName
                ? `mains-capture://cap/${selection.screenshotCaptureName}`
                : undefined;
              const label = browserSelectionLabel(selection);

              return (
                <div
                  key={selection.id}
                  className="group/attachment relative size-24 shrink-0 overflow-hidden rounded-2xl border border-primary-200 bg-primary-100 dark:border-primary-800 dark:bg-primary-950 animate-blur-reveal"
                  title={label}
                >
                  {src ? (
                    <Button
                      type="button"
                      onClick={() => {
                        setPreviewIndex(null);
                        setBrowserPreviewId(selection.id);
                      }}
                      aria-label={`Preview ${label}`}
                      className="block size-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    >
                      <img
                        src={src}
                        alt={label}
                        draggable={false}
                        className="size-full object-cover"
                      />
                    </Button>
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <Web className="size-6 text-primary-400 dark:text-primary-600" />
                    </div>
                  )}
                  <RemoveButton
                    name={label}
                    onRemove={() => removeContext(selection)}
                  />
                </div>
              );
            })}

            {files.map((uploaded, index) => {
              const { file } = uploaded;
              const key = `${file.name}-${file.size}-${file.lastModified}-${index}`;

              if (uploaded.type === "image" && uploaded.preview) {
                return (
                  <div
                    key={key}
                    className="group/attachment relative size-24 shrink-0 overflow-hidden rounded-2xl border border-primary-200 dark:border-primary-800 animate-blur-reveal"
                    title={file.name}
                  >
                    <Button
                      type="button"
                      onClick={() => {
                        setBrowserPreviewId(null);
                        setPreviewIndex(index);
                      }}
                      aria-label={`Preview ${file.name}`}
                      className="block size-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    >
                      <img
                        src={uploaded.preview}
                        alt={file.name}
                        draggable={false}
                        className="size-full object-cover"
                      />
                    </Button>
                    <RemoveButton
                      name={file.name}
                      onRemove={() => onRemove(index)}
                    />
                  </div>
                );
              }

              const docType = classifyDocType(file.name);
              const canOpen = !!docType && !isTextDocType(docType);
              const content = (
                <>
                  <div className="flex flex-1 items-center justify-center">
                    <FileIcon className="size-6 text-primary-400 dark:text-primary-600" />
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 pb-2">
                    <FileIconComponent
                      fileName={file.name}
                      extension={fileExtension(file.name)}
                      className="size-3.5 shrink-0"
                    />
                    <Text
                      as="span"
                      size="xs"
                      tone="contrast"
                      className="truncate"
                    >
                      {file.name}
                    </Text>
                  </div>
                </>
              );

              return (
                <div
                  key={key}
                  className="group/attachment relative h-24 w-36 shrink-0 overflow-hidden rounded-2xl bg-primary-100 dark:bg-primary-950 animate-blur-reveal"
                  title={file.name}
                >
                  {canOpen ? (
                    <Button
                      type="button"
                      onClick={() => openDraftDocument(file)}
                      aria-label={`Open ${file.name}`}
                      className="flex size-full cursor-pointer flex-col text-left outline-none transition-colors hover:bg-primary-200/50 focus-visible:ring-2 focus-visible:ring-primary-400 dark:hover:bg-primary-900"
                    >
                      {content}
                    </Button>
                  ) : (
                    <div className="flex size-full flex-col">{content}</div>
                  )}
                  <RemoveButton
                    name={file.name}
                    onRemove={() => onRemove(index)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {preview?.preview && (
        <ImagePreviewModal
          name={preview.file.name}
          src={preview.preview}
          onClose={() => setPreviewIndex(null)}
        />
      )}
      {browserPreview && browserPreviewSrc && (
        <ImagePreviewModal
          name={browserSelectionLabel(browserPreview)}
          src={browserPreviewSrc}
          onClose={() => setBrowserPreviewId(null)}
        />
      )}
    </>
  );
}
