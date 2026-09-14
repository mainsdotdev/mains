import { useId, useState } from "react";
import { Caption, Button, Body, Input, Modal } from "@/components/ui";
import { useCapabilities } from "@/lib/platform";

interface CloneRepoModalProps {
  isOpen: boolean;
  isCloning: boolean;
  onClone: (url: string, targetPath: string) => void;
  onClose: () => void;
}

export default function CloneRepoModal({
  isOpen,
  isCloning,
  onClone,
  onClose,
}: CloneRepoModalProps) {
  const { nativeDialogs } = useCapabilities();
  const titleId = useId();
  const [url, setUrl] = useState("");
  const [clonePath, setClonePath] = useState("");

  const [prevIsOpen, setPrevIsOpen] = useState(false);
  if (isOpen && !prevIsOpen) {
    setPrevIsOpen(true);
    setUrl("");
    // On web there's no local homedir; let the user type a backend path.
    setClonePath(
      nativeDialogs ? `${window.api.platform.homedir}/Desktop` : "",
    );
  }
  if (!isOpen && prevIsOpen) {
    setPrevIsOpen(false);
  }

  const handleBrowse = async () => {
    try {
      const result = await window.api.workspace.selectDirectory();
      if (result?.success && result.data) {
        setClonePath(result.data);
      }
    } catch {
      // User cancelled
    }
  };

  const handleSubmit = () => {
    if (!url.trim() || !clonePath.trim()) return;
    onClone(url.trim(), clonePath.trim());
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      aria-labelledby={titleId}
      closeOnEscape={!isCloning}
      closeOnBackdrop={!isCloning}
      className="max-w-md w-full rounded-4xl px-6 pt-5 pb-6"
    >
      <Body as="h2" id={titleId} weight="medium" className="mb-2">
        Clone Repository
      </Body>

      <div className="space-y-4">
        {/* Git URL */}
        <div>
          <Caption className="mb-1.5 block">Git URL</Caption>
          <Input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/user/repo.git"
            aria-label="Git URL"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
          />
        </div>

        {/* Clone Location */}
        <div>
          <Caption className="mb-1.5 block">Clone Location</Caption>
          <div className="flex gap-2">
            <Input
              type="text"
              value={clonePath}
              onChange={(e) => setClonePath(e.target.value)}
              placeholder="/path/to/directory"
              aria-label="Clone location"
              className="flex-1"
            />
            <Button
              variant="primary"
              onClick={handleBrowse}
              disabled={!nativeDialogs}
              tooltip={nativeDialogs ? undefined : "Type a path on the backend"}
              className="shrink-0 rounded-xl"
            >
              Browse
            </Button>
          </div>
        </div>
      </div>

      <div className="flex gap-3 mt-5">
        <Button
          className="flex-1"
          variant="secondary"
          onClick={onClose}
          disabled={isCloning}
        >
          Cancel
        </Button>
        <Button
          className="flex-1"
          variant="submit"
          onClick={handleSubmit}
          disabled={isCloning || !url.trim() || !clonePath.trim()}
        >
          {isCloning ? "Cloning..." : "Clone"}
        </Button>
      </div>
    </Modal>
  );
}
