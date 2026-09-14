import {
  useState,
  RefObject,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { Attach, Picture, Document, Close } from "../icons";
import DropdownWrapper from "../dropdown-wrapper";
import { Button } from "../button";
import Text from "../text";
import { cn } from "@/lib/cn";

/**
 * A filename, wherever it appears — the collapsed chip, a dropdown row, the
 * standalone preview. Eight sites rendered this by hand; one component is what
 * keeps them one size and one colour.
 */
function FileLabel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <Text as="span" size="xs" tone="contrast" className={cn("truncate", className)}>
      {children}
    </Text>
  );
}

export interface UploadedFile {
  file: File;
  type: "image" | "document";
  preview?: string;
}

export const FILE_TYPES = {
  IMAGE: "image/*",
  DOCUMENT: ".pdf,.doc,.docx,.txt",
} as const;

/** Beyond this many consecutive items of the same type, show one grouped chip + menu. */
const MAX_INLINE_PER_BLOCK = 1;

type FileSegment =
  | { kind: "documents"; indices: number[] }
  | { kind: "images"; indices: number[] };

function segmentUploadedFiles(files: UploadedFile[]): FileSegment[] {
  const segments: FileSegment[] = [];
  let i = 0;
  while (i < files.length) {
    if (files[i].type === "document") {
      let j = i;
      while (j < files.length && files[j].type === "document") j++;
      const indices: number[] = [];
      for (let k = i; k < j; k++) indices.push(k);
      segments.push({ kind: "documents", indices });
      i = j;
    } else {
      let j = i;
      while (j < files.length && files[j].type === "image") j++;
      const indices: number[] = [];
      for (let k = i; k < j; k++) indices.push(k);
      segments.push({ kind: "images", indices });
      i = j;
    }
  }
  return segments;
}

interface FileUploadDropdownProps {
  isOpen: boolean;
  onToggle: () => void;
  onImageUpload: () => void;
  onDocumentUpload: () => void;
  dropdownRef: RefObject<HTMLDivElement | null>;
  openUpward?: boolean;
  uploadedFiles: UploadedFile[];
  onRemoveFile: (index: number) => void;
  variant?: "claude" | "copilot" | "codex" | "cursor";
}

interface ImageGroupChipProps {
  indices: number[];
  uploadedFiles: UploadedFile[];
  onRemoveFile: (index: number) => void;
  openUpward: boolean;
}

function ImageGroupChip({
  indices,
  uploadedFiles,
  onRemoveFile,
  openUpward,
}: ImageGroupChipProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handle = (e: MouseEvent) => {
      const t = e.target as Node;
      if (groupRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

  const previewIndices = indices.slice(0, 3);
  const count = indices.length;

  const rowRemove = useCallback(
    (index: number) => {
      onRemoveFile(index);
    },
    [onRemoveFile],
  );

  return (
    <div className="relative mr-1 shrink-0" ref={groupRef}>
      <Button
        type="button"
        tooltip={`${count} images — click to manage`}
        tooltipPosition="top"
        onClick={() => setMenuOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 rounded-2xl px-1.5 py-1 transition-colors",
          "bg-primary-100 dark:bg-primary-800 hover:bg-primary-200/40 dark:hover:bg-primary-700/80",
        )}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={`${count} images attached, open list`}
      >
        <div className="flex items-center pl-0.5">
          {previewIndices.map((idx, stackIdx) => (
            <div
              key={idx}
              className={cn(
                "relative h-5 w-5 overflow-hidden rounded ring-2 ring-primary-100 dark:ring-primary-800",
                stackIdx > 0 && "-ml-2",
              )}
            >
              <img
                src={uploadedFiles[idx].preview}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
          ))}
        </div>
        <FileLabel className="max-w-24 pr-0.5">
          {count} images
        </FileLabel>
      </Button>

      <DropdownWrapper
        isOpen={menuOpen}
        aria-label="Attached images"
        openUpward={openUpward}
        minWidth="min-w-56"
        usePortal
        triggerRef={groupRef}
        dropdownRef={panelRef}
        matchTriggerWidth={false}
      >
        <div className="max-h-48 overflow-y-auto py-1" aria-label="Attached images">
          {indices.map((index) => {
            const uploadedFile = uploadedFiles[index];
            return (
              <div
                key={`${uploadedFile.file.name}-${uploadedFile.file.size}-${index}`}
                className="flex items-center gap-2 px-2 py-1.5"
                role="menuitem"
              >
                <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded">
                  <img
                    src={uploadedFile.preview}
                    alt={uploadedFile.file.name}
                    className="h-full w-full object-cover"
                  />
                </div>
                <FileLabel className="min-w-0 flex-1 text-left">
                  {uploadedFile.file.name}
                </FileLabel>
                <Button
                  type="button"
                  onClick={() => rowRemove(index)}
                  className="shrink-0 rounded-full p-1 hover:bg-primary-200/40 dark:hover:bg-primary-600/40"
                  aria-label={`Remove ${uploadedFile.file.name}`}
                >
                  <Close className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" />
                </Button>
              </div>
            );
          })}
        </div>
      </DropdownWrapper>
    </div>
  );
}

interface DocumentGroupChipProps {
  indices: number[];
  uploadedFiles: UploadedFile[];
  onRemoveFile: (index: number) => void;
  openUpward: boolean;
}

function DocumentGroupChip({
  indices,
  uploadedFiles,
  onRemoveFile,
  openUpward,
}: DocumentGroupChipProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handle = (e: MouseEvent) => {
      const t = e.target as Node;
      if (groupRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

  const stackIndices = indices.slice(0, 3);
  const count = indices.length;

  const rowRemove = useCallback(
    (index: number) => {
      onRemoveFile(index);
    },
    [onRemoveFile],
  );

  return (
    <div className="relative mr-1 shrink-0" ref={groupRef}>
      <Button
        type="button"
        tooltip={`${count} documents — click to manage`}
        tooltipPosition="top"
        onClick={() => setMenuOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 rounded-2xl px-1.5 py-1 transition-colors",
          "bg-primary-100 dark:bg-primary-800 hover:bg-primary-200/40 dark:hover:bg-primary-700/80",
        )}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={`${count} documents attached, open list`}
      >
        <div className="flex items-center pl-0.5">
          {stackIndices.map((idx, stackIdx) => (
            <div
              key={idx}
              className={cn(
                "relative flex h-5 w-5 items-center justify-center overflow-hidden rounded bg-primary-200/50 ring-2 ring-primary-100 dark:bg-primary-700/60 dark:ring-primary-800",
                stackIdx > 0 && "-ml-2",
              )}
            >
              <Document className="size-3 text-primary-950 dark:text-primary" />
            </div>
          ))}
        </div>
        <FileLabel className="max-w-24 pr-0.5">
          {count} documents
        </FileLabel>
      </Button>

      <DropdownWrapper
        isOpen={menuOpen}
        aria-label="Attached documents"
        openUpward={openUpward}
        minWidth="min-w-56"
        usePortal
        triggerRef={groupRef}
        dropdownRef={panelRef}
        matchTriggerWidth={false}
      >
        <div className="max-h-48 overflow-y-auto py-1" aria-label="Attached documents">
          {indices.map((index) => {
            const uploadedFile = uploadedFiles[index];
            return (
              <div
                key={`${uploadedFile.file.name}-${uploadedFile.file.size}-${index}-doc`}
                className="flex items-center gap-2 px-2 py-1.5"
                role="menuitem"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary-200/40 ring-2 ring-primary-200 dark:bg-primary-700/50 dark:ring-primary-700/60">
                  <Document className="size-4 text-primary-950 dark:text-primary" />
                </div>
                <FileLabel className="min-w-0 flex-1 text-left">
                  {uploadedFile.file.name}
                </FileLabel>
                <Button
                  type="button"
                  onClick={() => rowRemove(index)}
                  className="shrink-0 rounded-full p-1 hover:bg-primary-200/40 dark:hover:bg-primary-600/40"
                  aria-label={`Remove ${uploadedFile.file.name}`}
                >
                  <Close className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" />
                </Button>
              </div>
            );
          })}
        </div>
      </DropdownWrapper>
    </div>
  );
}

export function FileUploadDropdown({
  isOpen,
  onToggle,
  onImageUpload,
  onDocumentUpload,
  dropdownRef,
  openUpward = false,
  uploadedFiles,
  onRemoveFile,
  variant,
}: FileUploadDropdownProps) {
  const [hoveredFileIndex, setHoveredFileIndex] = useState<number | null>(null);

  const segments = segmentUploadedFiles(uploadedFiles);

  const renderDocumentChip = (index: number) => {
    const uploadedFile = uploadedFiles[index];
    return (
      <div
        key={`doc-${index}-${uploadedFile.file.name}-${uploadedFile.file.size}`}
        className="relative shrink-0"
        onMouseEnter={() => setHoveredFileIndex(index)}
        onMouseLeave={() => setHoveredFileIndex(null)}
      >
        <div className="mr-1 flex items-center gap-2 rounded-2xl bg-primary-100 px-2 py-1.5 dark:bg-primary-800">
          {hoveredFileIndex === index ? (
            <Button
              type="button"
              onClick={() => onRemoveFile(index)}
              className="flex cursor-pointer items-center gap-2"
              aria-label="Remove document"
            >
              <Close className="h-4 w-4 text-primary-600 dark:text-primary-400" />
              <FileLabel className="max-w-25">
                {uploadedFile.file.name}
              </FileLabel>
            </Button>
          ) : (
            <>
              <Document className="h-4 w-4 text-primary-950 dark:text-primary" />
              <FileLabel className="max-w-25">
                {uploadedFile.file.name}
              </FileLabel>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderDefaultImageChip = (index: number) => {
    const uploadedFile = uploadedFiles[index];
    return (
      <div
        key={`img-${index}-${uploadedFile.file.name}-${uploadedFile.file.size}`}
        className="relative shrink-0"
        onMouseEnter={() => setHoveredFileIndex(index)}
        onMouseLeave={() => setHoveredFileIndex(null)}
      >
        <div className="mr-1 flex items-center gap-2 rounded-2xl bg-primary-100 px-1.5 py-1 dark:bg-primary-800">
          <div className="group relative h-5 w-5 overflow-hidden rounded">
            <img
              src={uploadedFile.preview}
              alt={uploadedFile.file.name}
              className="h-full w-full object-cover"
            />

            {hoveredFileIndex === index && (
              <Button
                type="button"
                onClick={() => onRemoveFile(index)}
                className="absolute inset-0 flex cursor-pointer items-center justify-center bg-primary-950/50 transition-opacity"
                aria-label="Remove image"
              >
                <Close className="h-4 w-4 text-primary-600 dark:text-primary-400" />
              </Button>
            )}
          </div>
          <FileLabel className="max-w-25">
            {uploadedFile.file.name}
          </FileLabel>
        </div>
      </div>
    );
  };

  const renderCodexImageChip = (index: number) => {
    const uploadedFile = uploadedFiles[index];
    return (
      <div
        key={`img-${index}-${uploadedFile.file.name}-${uploadedFile.file.size}`}
        className="group relative shrink-0"
      >
        <div className="mr-1 flex items-center gap-2 rounded-2xl bg-primary-100 px-1.5 py-1 dark:bg-primary-800">
          <div className="relative h-5 w-5 overflow-hidden rounded">
            <img
              src={uploadedFile.preview}
              alt={uploadedFile.file.name}
              className="h-full w-full object-cover"
            />
            <Button
              type="button"
              onClick={() => onRemoveFile(index)}
              className="absolute inset-0 flex cursor-pointer items-center justify-center bg-primary-950/50 opacity-0 transition-opacity group-hover:opacity-100"
              aria-label="Remove image"
            >
              <Close className="h-4 w-4 text-primary-600 dark:text-primary-400" />
            </Button>
          </div>
          <FileLabel className="max-w-25">
            {uploadedFile.file.name}
          </FileLabel>
        </div>
      </div>
    );
  };

  const renderDocumentSegmentList = (indices: number[]): ReactNode[] => {
    if (indices.length > MAX_INLINE_PER_BLOCK) {
      return [
        <DocumentGroupChip
          key={`doc-group-${indices[0]}-${indices[indices.length - 1]}`}
          indices={indices}
          uploadedFiles={uploadedFiles}
          onRemoveFile={onRemoveFile}
          openUpward={openUpward}
        />,
      ];
    }
    return indices.map((index) => renderDocumentChip(index));
  };

  const renderImageSegmentList = (
    indices: number[],
  ): ReactNode[] => {
    if (indices.length > MAX_INLINE_PER_BLOCK) {
      return [
        <ImageGroupChip
          key={`img-group-${indices[0]}-${indices[indices.length - 1]}`}
          indices={indices}
          uploadedFiles={uploadedFiles}
          onRemoveFile={onRemoveFile}
          openUpward={openUpward}
        />,
      ];
    }
    return indices.map((index) =>
      variant === "codex"
        ? renderCodexImageChip(index)
        : renderDefaultImageChip(index),
    );
  };

  if (variant === "codex") {
    return (
      <div
        className="relative flex min-w-0 max-w-[min(100%,28rem)] animate-blur-reveal items-center "
        ref={dropdownRef}
      >
        <Button
          type="button"
          tooltip="Upload image"
          tooltipPosition="top"
          onClick={onImageUpload}
          className="shrink-0 rounded-full p-2 transition-colors hover:bg-primary-200/30 dark:hover:bg-primary-300/20 cursor-pointer"
          aria-label="Upload image"
        >
          <Picture className="size-4 text-primary-950 dark:text-primary" />
        </Button>
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto">
          {segments.flatMap((segment) => {
            if (segment.kind === "documents") {
              return renderDocumentSegmentList(segment.indices);
            }
            return renderImageSegmentList(segment.indices);
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex min-w-0 max-w-[min(100%,28rem)] animate-blur-reveal items-center"
      ref={dropdownRef}
    >
      <Button
        type="button"
        tooltip="Upload file or photo"
        tooltipPosition="top"
        onClick={onToggle}
        className="shrink-0 cursor-pointer rounded-full p-2 transition-colors hover:bg-primary-200/30 dark:hover:bg-primary-800"
        aria-label="Upload file"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <Attach className="text-primary-950 dark:text-primary size-4" />
      </Button>

      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto">
        {segments.flatMap((segment) => {
          if (segment.kind === "documents") {
            return renderDocumentSegmentList(segment.indices);
          }
          return renderImageSegmentList(segment.indices);
        })}
      </div>

      <DropdownWrapper
        isOpen={isOpen}
        aria-label="Upload type"
        openUpward={openUpward}
      >
        {[
          { label: "Images", Icon: Picture, onClick: onImageUpload },
          { label: "Documents", Icon: Document, onClick: onDocumentUpload },
        ].map(({ label, Icon, onClick }) => (
          <Button
            key={label}
            type="button"
            onClick={onClick}
            role="menuitem"
            className="flex w-full cursor-pointer items-center px-3 py-2 text-left text-sm text-primary-900 first:rounded-t-xl last:rounded-b-xl hover:bg-primary-200/30 dark:text-primary-100 dark:hover:bg-primary-800"
          >
            <Icon className="mr-2 size-3.5" />
            {label}
          </Button>
        ))}
      </DropdownWrapper>
    </div>
  );
}
