import type { RefObject } from "react";
import { Attach, Picture, Document } from "../icons";
import DropdownWrapper from "../dropdown-wrapper";
import { Button } from "../button";

export interface UploadedFile {
  file: File;
  type: "image" | "document";
  preview?: string;
}

export const FILE_TYPES = {
  IMAGE: "image/*",
  DOCUMENT: ".pdf,.doc,.docx,.txt",
} as const;

interface FileUploadDropdownProps {
  isOpen: boolean;
  onToggle: () => void;
  onImageUpload: () => void;
  onDocumentUpload: () => void;
  dropdownRef: RefObject<HTMLDivElement | null>;
  openUpward?: boolean;
  variant?: "claude" | "copilot" | "codex" | "cursor";
}

/**
 * The attach button and its upload-type menu. Attached files render as preview
 * tiles above the prompt, not here.
 */
export function FileUploadDropdown({
  isOpen,
  onToggle,
  onImageUpload,
  onDocumentUpload,
  dropdownRef,
  openUpward = false,
  variant,
}: FileUploadDropdownProps) {
  if (variant === "codex") {
    return (
      <div className="relative flex shrink-0 items-center" ref={dropdownRef}>
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
      </div>
    );
  }

  return (
    <div className="relative flex shrink-0 items-center" ref={dropdownRef}>
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
