import { useId, useRef, useState, type MouseEvent } from "react";
import {
  Alert,
  Body,
  Button,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSub,
  Input,
  Modal,
} from "@/components/ui";
import {
  Archive,
  Clipboard,
  Edit,
  Fork,
  OpenWith,
  Option,
  Pin,
  Trash,
} from "@/components/ui/icons";
import { useAppSelector } from "@/lib/redux/hooks";
import {
  useGetAccountQuery,
  useGetRunByIdQuery,
  useListCollectionsQuery,
} from "@/lib/redux/api";
import { useModeConfig } from "@/hooks/use-mode-config";
import { ProjectIcon } from "@/components/layout/sidebar/project-icon";
import { isRunTab } from "../lib/repo-utils";
import { useChatActions } from "../hooks/use-chat-actions";

/** Same rule the sidebar row prints by: title, else the goal's first line. */
function chatTitle(run: { title: string | null; goal: string | null }): string {
  const title = run.title?.trim();
  if (title) return title;
  const goalLine = run.goal?.split("\n").find((line) => line.trim())?.trim();
  return goalLine || "Untitled chat";
}

/**
 * Fixed so the menu can be right-aligned under its trigger: `position.x` is the
 * menu's left edge, and the width is only measured after the first paint.
 * Comfortably wider than the longest row ("Copy recent message"), so the
 * measured width matches and the alignment does not drift.
 */
const MENU_WIDTH = 240;

function MenuSeparator() {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className="mx-1.5 my-1 h-px bg-primary-200/70 dark:bg-primary-700/40"
    />
  );
}

/**
 * Everything the open chat can have done to it, from the window's top-right —
 * the sidebar row's menu reachable without hunting for the row, and the only
 * one at all in Work and Chat, where there is no tab strip to hang it on.
 *
 * Renders nothing in Code: that mode's runs belong to a workspace, whose own
 * menus already own these verbs.
 */
export function ChatActionsMenu() {
  const { mode } = useModeConfig();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // The open tab, with none of the session panel's fallback to the run a file
  // was opened from: this menu acts on the chat in front of the user, and an
  // empty composer is not one — "new-run" and "editor" both mean no chat yet.
  const sessionRunId = useAppSelector((state) =>
    isRunTab(state.workspace.activeTab) ? state.workspace.activeTab : null,
  );
  const { data: account } = useGetAccountQuery();
  // `currentData`, never `data`: RTK Query's `data` keeps the last successful
  // result once the hook skips or its arg changes, so closing a chat for the
  // new-chat screen would leave this menu on screen — still pointing at the
  // chat that was left. `currentData` empties with the tab.
  const { currentData: run } = useGetRunByIdQuery(sessionRunId ?? "", {
    skip: !sessionRunId,
  });
  const { data: collections } = useListCollectionsQuery(
    { accountId: account?.id ?? "" },
    { skip: !account },
  );
  const {
    renameChat,
    toggleChatPin,
    moveChat,
    forkChat,
    copyLastMessage,
    archiveChat,
    deleteChat,
  } = useChatActions();

  if (mode === "developer" || !run) return null;

  const label = chatTitle(run);
  const isPinned = run.pinnedAt !== null;

  const openMenu = (event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.right - MENU_WIDTH, y: rect.bottom + 4 });
    setIsMenuOpen(true);
  };

  /** Every item closes the menu first — none of them leaves it standing. */
  const act = (action: () => void) => () => {
    setIsMenuOpen(false);
    action();
  };

  const commitRename = () => {
    if (renameDraft === null) return;
    const next = renameDraft.trim();
    setRenameDraft(null);
    if (next && next !== label) void renameChat(run, next);
  };

  const confirmDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteChat(run);
      setIsConfirmingDelete(false);
    } catch {
      // The hook already reported it; keep the dialog open to retry.
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Button
        ref={triggerRef}
        tooltip="Chat options"
        tooltipPosition="left"
        onClick={openMenu}
        aria-label="Chat options"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        className="flex items-center rounded-full p-1.5 cursor-pointer text-primary-700 dark:text-primary-300 hover:bg-primary-100/80 dark:hover:bg-primary/10 transition-all duration-300 ease-out"
      >
        <Option className="size-3.75" />
      </Button>
      <DropdownMenu
        isOpen={isMenuOpen}
        aria-label="Chat actions"
        position={menuPosition}
        minWidth={MENU_WIDTH}
        origin="top-right"
        onClose={() => setIsMenuOpen(false)}
      >
        <DropdownMenuItem onClick={act(() => setRenameDraft(label))}>
          <Edit className="size-3.5" />
          <span>Rename</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={act(() => void toggleChatPin(run))}>
          <Pin className="size-3.5" />
          <span>{isPinned ? "Unpin" : "Pin"}</span>
        </DropdownMenuItem>
        <DropdownMenuSub
          label={
            <>
              <OpenWith className="size-3.5" />
              <span>Move</span>
            </>
          }
        >
          <DropdownMenuItem
            selected={run.collectionId === null}
            indicator="none"
            onClick={act(() => void moveChat(run, null))}
          >
            {/* Holds the icon column open so every label starts at the same
                place — "no project" has no icon to show. */}
            <span className="size-3.5 shrink-0" />
            <span>No project</span>
          </DropdownMenuItem>
          {(collections ?? []).map((collection) => (
            <DropdownMenuItem
              key={collection.id}
              selected={run.collectionId === collection.id}
              indicator="none"
              onClick={act(() => void moveChat(run, collection.id))}
            >
              <ProjectIcon
                icon={collection.icon}
                projectName={collection.name}
              />
              <span className="truncate">{collection.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuSub>
        <MenuSeparator />
        <DropdownMenuItem onClick={act(() => void forkChat(run))}>
          <Fork className="size-3.5" />
          <span>Fork</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={act(() => void copyLastMessage(run))}>
          <Clipboard className="size-3.5" />
          <span>Copy recent message</span>
        </DropdownMenuItem>
        <MenuSeparator />
        <DropdownMenuItem onClick={act(() => void archiveChat(run))}>
          <Archive className="size-3.5" />
          <span>Archive</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="danger"
          onClick={act(() => setIsConfirmingDelete(true))}
        >
          <Trash className="size-3.5" />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenu>

      <Modal
        isOpen={renameDraft !== null}
        onClose={() => setRenameDraft(null)}
        aria-labelledby={titleId}
        initialFocusRef={renameInputRef}
        className="max-w-md w-full rounded-4xl px-6 pt-5 pb-6"
      >
        <Body as="h2" id={titleId} weight="medium" className="mb-4">
          Rename chat
        </Body>
        <Input
          ref={renameInputRef}
          value={renameDraft ?? ""}
          onChange={(event) => setRenameDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          aria-label="Chat title"
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename();
          }}
        />
        <div className="mt-5 flex gap-3">
          <Button
            className="flex-1"
            variant="primary"
            onClick={() => setRenameDraft(null)}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="submit"
            onClick={commitRename}
            disabled={!renameDraft?.trim()}
          >
            Save
          </Button>
        </div>
      </Modal>

      <Alert
        isOpen={isConfirmingDelete}
        title={`Delete ${label}?`}
        // Names the reversible neighbour, so the choice between the two menu
        // entries is clear at the moment it matters.
        description="This chat and its messages are permanently deleted. Archive instead to keep it recoverable from Settings → Archive."
        primaryButtonText="Delete"
        secondaryButtonText="Cancel"
        primaryButtonVariant="danger"
        isPrimaryLoading={isDeleting}
        onPrimary={() => void confirmDelete()}
        onSecondary={() => setIsConfirmingDelete(false)}
      />
    </>
  );
}
