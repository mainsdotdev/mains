import { useId, useRef, useState } from "react";
import { Caption, Button, Body, Input, Modal } from "@/components/ui";
import { useCapabilities } from "@/lib/platform";

interface CreateProjectModalProps {
  isOpen: boolean;
  isCreating: boolean;
  onCreate: (name: string, parentPath?: string) => void;
  onClose: () => void;
}

const INVALID_NAME = /[\\/:*?"<>|]|^\.+$|^\s|\s$/;

export default function CreateProjectModal({
  isOpen,
  isCreating,
  onCreate,
  onClose,
}: CreateProjectModalProps) {
  const { nativeDialogs } = useCapabilities();
  const titleId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [parentPath, setParentPath] = useState("");

  const [prevIsOpen, setPrevIsOpen] = useState(false);
  if (isOpen && !prevIsOpen) {
    setPrevIsOpen(true);
    setName("");
    setParentPath("");
  }
  if (!isOpen && prevIsOpen) {
    setPrevIsOpen(false);
  }

  const trimmed = name.trim();
  const isInvalid = trimmed.length === 0 || INVALID_NAME.test(trimmed);

  const handleBrowse = async () => {
    try {
      const result = await window.api.workspace.selectDirectory();
      if (result?.success && result.data) {
        setParentPath(result.data);
      }
    } catch {
      // User cancelled
    }
  };

  const handleSubmit = () => {
    if (isInvalid) return;
    onCreate(trimmed, parentPath.trim() || undefined);
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      aria-labelledby={titleId}
      initialFocusRef={nameInputRef}
      closeOnEscape={!isCreating}
      closeOnBackdrop={!isCreating}
      className="max-w-md w-full rounded-4xl px-6 pt-5 pb-6"
    >
      <Body as="h2" id={titleId} weight="medium" className="mb-2">
        Create New Project
      </Body>

      <div className="space-y-4">
        <div>
          <Caption className="mb-1.5 block">
            Project Name
          </Caption>
          <Input
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-new-project"
            aria-label="Project name"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
          />
        </div>

        <div>
          <Caption className="mb-1.5 block">
            Project Location
          </Caption>
          <div className="flex gap-2">
            <Input
              type="text"
              value={parentPath}
              onChange={(e) => setParentPath(e.target.value)}
              placeholder="Desktop (default)"
              aria-label="Project location"
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
            />
            <Button
              variant="secondary"
              onClick={handleBrowse}
              disabled={!nativeDialogs || isCreating}
              tooltip={nativeDialogs ? undefined : "Type a path on the backend"}
              className="shrink-0 rounded-xl"
            >
              Browse
            </Button>
          </div>
          <Caption className="mt-1.5 block break-all">
            Will be created at{" "}
            {parentPath.trim()
              ? `${parentPath.trim()}/${trimmed || "<name>"}`
              : `~/Desktop/${trimmed || "<name>"}`}{" "}
            on the main branch.
          </Caption>
        </div>
      </div>

      <div className="flex gap-3 mt-5">
        <Button
          className="flex-1"
          variant="primary"
          onClick={onClose}
          disabled={isCreating}
        >
          Cancel
        </Button>
        <Button
          className="flex-1"
          variant="submit"
          onClick={handleSubmit}
          disabled={isCreating || isInvalid}
        >
          {isCreating ? "Creating..." : "Create"}
        </Button>
      </div>
    </Modal>
  );
}
