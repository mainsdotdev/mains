import { useId, useRef, useState, type FormEvent } from "react";
import {
  Body,
  Button,
  Caption,
  getSegmentedTabId,
  Input,
  Modal,
  SegmentedTabs,
  Text,
} from "@/components/ui";
import { Plus } from "@/components/ui/icons";
import { useCapabilities } from "@/lib/platform";

type ProjectTab = "clone" | "create";

interface AddProjectModalProps {
  activeTab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
  isAddingLocal: boolean;
  isCloning: boolean;
  isCreating: boolean;
  addLocalShortcut?: string;
  onAddLocal: () => void;
  onClone: (url: string, targetPath: string) => void;
  onCreate: (name: string, parentPath?: string) => void;
  onClose: () => void;
}

const PROJECT_TABS: ReadonlyArray<{ value: ProjectTab; label: string }> = [
  { value: "clone", label: "Clone from URL" },
  { value: "create", label: "Create new project" },
];

const INVALID_NAME = /[\\/:*?"<>|]|^\.+$|^\s|\s$/;

export default function AddProjectModal({
  activeTab,
  onTabChange,
  isAddingLocal,
  isCloning,
  isCreating,
  addLocalShortcut,
  onAddLocal,
  onClone,
  onCreate,
  onClose,
}: AddProjectModalProps) {
  const { nativeDialogs } = useCapabilities();
  const titleId = useId();
  const tabsId = useId();
  const panelId = useId();
  const primaryInputRef = useRef<HTMLInputElement>(null);

  const [url, setUrl] = useState("");
  const [clonePath, setClonePath] = useState(() =>
    nativeDialogs ? window.api.platform.homedir + "/Desktop" : "",
  );
  const [name, setName] = useState("");
  const [parentPath, setParentPath] = useState("");

  const isClone = activeTab === "clone";
  const isBusy = isAddingLocal || isCloning || isCreating;
  const trimmedName = name.trim();
  const invalidName = !trimmedName || INVALID_NAME.test(trimmedName);
  const createLocation = parentPath.trim()
    ? parentPath.trim() + "/" + (trimmedName || "<name>")
    : "~/Desktop/" + (trimmedName || "<name>");

  const browseForPath = async (setPath: (path: string) => void) => {
    try {
      const result = await window.api.workspace.selectDirectory();
      if (result?.success && result.data) setPath(result.data);
    } catch {
      // The picker was cancelled.
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isBusy) return;
    if (isClone) {
      if (url.trim() && clonePath.trim()) onClone(url.trim(), clonePath.trim());
    } else if (!invalidName) {
      onCreate(trimmedName, parentPath.trim() || undefined);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      aria-labelledby={titleId}
      initialFocusRef={primaryInputRef}
      closeOnEscape={!isBusy}
      closeOnBackdrop={!isBusy}
      className="w-full max-w-2xl rounded-3xl px-6 pt-5 pb-6"
    >
      <Body as="h2" id={titleId} weight="semibold">
        Add Project
      </Body>
      <Caption className="mt-1 block">
        Bring in a repository or start a new one.
      </Caption>

      <SegmentedTabs
        id={tabsId}
        value={activeTab}
        onChange={onTabChange}
        options={PROJECT_TABS}
        panelId={panelId}
        aria-label="Project setup method"
        disabled={isBusy}
        className="mt-5 w-fit max-w-full"
      />

      <form
        id={panelId}
        role="tabpanel"
        aria-labelledby={getSegmentedTabId(tabsId, activeTab)}
        onSubmit={handleSubmit}
        className="pt-5"
      >
        <div className="space-y-4">
          <div>
            <Caption className="mb-1.5 block">
              {isClone ? "Git URL" : "Project Name"}
            </Caption>
            <Input
              ref={primaryInputRef}
              type="text"
              value={isClone ? url : name}
              onChange={(event) =>
                isClone ? setUrl(event.target.value) : setName(event.target.value)
              }
              placeholder={
                isClone
                  ? "https://github.com/user/repo.git"
                  : "my-new-project"
              }
              aria-label={isClone ? "Git URL" : "Project name"}
              autoCapitalize={isClone ? "none" : undefined}
              autoComplete={isClone ? "url" : "off"}
              spellCheck={false}
              disabled={isBusy}
            />
          </div>

          <div>
            <Caption className="mb-1.5 block">
              {isClone ? "Clone Location" : "Project Location"}
            </Caption>
            <div className="flex gap-2">
              <Input
                type="text"
                value={isClone ? clonePath : parentPath}
                onChange={(event) =>
                  isClone
                    ? setClonePath(event.target.value)
                    : setParentPath(event.target.value)
                }
                placeholder={isClone ? "/path/to/directory" : "Desktop (default)"}
                aria-label={isClone ? "Clone location" : "Project location"}
                className="flex-1"
                disabled={isBusy}
              />
              <Button
                variant="secondary"
                onClick={() =>
                  void browseForPath(isClone ? setClonePath : setParentPath)
                }
                disabled={!nativeDialogs || isBusy}
                tooltip={nativeDialogs ? undefined : "Type a path on the backend"}
                className="shrink-0 rounded-xl"
              >
                Browse
              </Button>
            </div>
            <Caption
              className="mt-1.5 block truncate"
              title={isClone ? undefined : `Will be created at ${createLocation} on the main branch.`}
            >
              {isClone
                ? "The repository will be cloned to this location."
                : `Will be created at ${createLocation} on the main branch.`}
            </Caption>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isBusy}>
            Cancel
          </Button>
          <Button
            isLoading={isCloning}
            type="submit"
            variant="submit"
            disabled={
              isBusy ||
              (isClone ? !url.trim() || !clonePath.trim() : invalidName)
            }
          >
            {isClone
              ? isCloning ? "Cloning..." : "Clone"
              : isCreating ? "Creating..." : "Create"}
          </Button>
        </div>
      </form>

      <div className="mt-5 border-t border-primary-200/70 pt-4 dark:border-primary-800/70">
        <Button
          variant="subtle"
          fullWidth
          onClick={onAddLocal}
          disabled={!nativeDialogs || isBusy}
          tooltip={nativeDialogs ? undefined : "Available in the desktop app"}
          className="gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-primary-100/60 dark:hover:bg-primary-800/40"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl glass-outline">
            <Plus className="size-4 text-primary-700 dark:text-primary-300" />
          </span>
          <span className="min-w-0 flex-1">
            <Text as="span" size="s" weight="medium" className="block">
              {isAddingLocal ? "Adding..." : "Add from local"}
            </Text>
            <Caption as="span" className="block">
              {nativeDialogs
                ? "Choose an existing folder on your computer"
                : "Available in the desktop app"}
            </Caption>
          </span>
          {addLocalShortcut && (
            <Caption className="shrink-0">{addLocalShortcut}</Caption>
          )}
        </Button>
      </div>
    </Modal>
  );
}
