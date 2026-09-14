import { useCallback, useState } from "react";
import NumberFlow from "@number-flow/react";
import { Diff, Undo } from "@/components/ui/icons";
import { Alert, Text, toast } from "@/components/ui";
import {
  useResyncWorkspaceDiffMutation,
  useDiscardWorkspacePathsMutation,
  useLazyGetLatestWorkspaceDiffQuery,
  type ChangedFile,
} from "@/lib/redux/api";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { DIFF_ADDED_TEXT, DIFF_REMOVED_TEXT } from "@/features/workspace/lib/severity";
import { useOpenFileInEditor } from "@/features/workspace/hooks/use-open-file-in-editor";
import { useOpenDiffInEditor } from "@/features/workspace/hooks/use-open-diff-in-editor";
import { parseFileDiffSegment } from "@/features/workspace/lib/parse-diff";
import { describeDiscard } from "@/features/workspace/lib/describe-discard";
import { FileIconComponent } from "@/components/ui/icons";
import { PanelItem, PanelCollapse } from "../panel-item";
import type { GitActionsPanel } from "./use-git-actions-panel";

/** An Undo waiting on confirmation. `key` is the row it came from. */
interface DiscardRequest {
  key: string;
  files: ChangedFile[];
}

/**
 * The working tree: its totals on the row, its files inside, and Undo on both.
 */
export function ChangesSection({ panel }: { panel: GitActionsPanel }) {
  const {
    workspaceId,
    additions,
    deletions,
    changedFilePaths,
    hasChanges,
    refreshStatus,
    isSectionOpen,
    toggleSection,
  } = panel;

  const openFileInEditor = useOpenFileInEditor();
  const openDiffInEditor = useOpenDiffInEditor();

  const [isManualRefresh, setIsManualRefresh] = useState(false);
  /** Path being discarded, or "*" while the whole tree is. */
  const [discarding, setDiscarding] = useState<string | null>(null);
  /** The pending Undo, held until confirmed — discarding can't be undone. */
  const [confirmDiscard, setConfirmDiscard] = useState<DiscardRequest | null>(null);
  /** Path whose diff is being fetched, so its row can spin while it loads. */
  const [openingDiff, setOpeningDiff] = useState<string | null>(null);

  const [discardWorkspacePaths] = useDiscardWorkspacePathsMutation();
  // On demand only: the diff text is fetched when a file row is clicked, not
  // alongside the status this panel polls throughout a run.
  const [fetchLatestDiff] = useLazyGetLatestWorkspaceDiffQuery();
  // Recomputes + persists the canonical workspace diff and invalidates the
  // WorkspaceDiffs cache, so the sidebar workspace item (which reads that
  // stored diff) reflects the same numbers the panel shows live.
  const [resyncWorkspaceDiff] = useResyncWorkspaceDiffMutation();

  // Manual refresh: re-read the live panel status AND re-persist the workspace
  // diff (which refreshes the sidebar via cache invalidation). Tracked
  // separately from `isFetching` so only a click spins the icon — the live
  // refetches would otherwise flicker it for the whole run.
  const handleRefresh = useCallback(async () => {
    if (isManualRefresh) return;
    setIsManualRefresh(true);
    resyncWorkspaceDiff(workspaceId);
    try {
      await refreshStatus();
    } finally {
      setIsManualRefresh(false);
    }
  }, [workspaceId, isManualRefresh, refreshStatus, resyncWorkspaceDiff]);

  /**
   * Open a changed file as a diff. The row belongs to a list of *changes*, so a
   * click should show what changed rather than the whole current file — the
   * same thing the sidebar's Changes tab opens.
   *
   * The status payload carries paths and counts only, so the diff text is
   * pulled from the stored workspace diff and sliced down to this one file. A
   * snapshot that predates the change (or was never captured) yields no
   * segment; that's what the resync retry is for. If even that comes up empty —
   * a binary file, or one git no longer reports — the file itself opens, so a
   * click is never a no-op.
   */
  const handleOpenFileDiff = useCallback(
    async (filePath: string) => {
      if (openingDiff) return;
      setOpeningDiff(filePath);
      try {
        const cached = await fetchLatestDiff(workspaceId, true).unwrap();
        const segment = cached?.diffText
          ? parseFileDiffSegment(filePath, cached.diffText)
          : "";
        if (segment) {
          openDiffInEditor(filePath, segment);
          return;
        }

        await resyncWorkspaceDiff(workspaceId).unwrap();
        const fresh = await fetchLatestDiff(workspaceId, false).unwrap();
        const freshSegment = fresh?.diffText
          ? parseFileDiffSegment(filePath, fresh.diffText)
          : "";
        if (freshSegment) {
          openDiffInEditor(filePath, freshSegment);
          return;
        }
      } catch {
        // Fall through — the file view is always available.
      } finally {
        setOpeningDiff(null);
      }
      openFileInEditor(filePath);
    },
    [
      workspaceId,
      openingDiff,
      fetchLatestDiff,
      resyncWorkspaceDiff,
      openDiffInEditor,
      openFileInEditor,
    ],
  );

  /**
   * Run a confirmed Undo: restore those files to their HEAD state. One file
   * from a file row, every listed file from the summary row — the panel undoes
   * exactly what it is showing.
   */
  const handleDiscard = useCallback(
    async ({ key, files }: DiscardRequest) => {
      if (discarding || files.length === 0) return;
      const paths = files.map((f) => f.path);
      setDiscarding(key);
      try {
        await discardWorkspacePaths({ workspaceId, paths }).unwrap();
        toast.success(
          paths.length === 1
            ? `Reverted ${paths[0].split("/").pop()}`
            : `Reverted ${paths.length} files`,
        );
        refreshStatus();
      } catch (err) {
        toast.error(extractErrorMessage(err, "Failed to revert changes."));
      } finally {
        setDiscarding(null);
        setConfirmDiscard(null);
      }
    },
    [workspaceId, discarding, discardWorkspacePaths, refreshStatus],
  );

  return (
    <>
      <PanelItem
        icon={<Diff className="size-4" />}
        label="Changes"
        expandable
        expanded={isSectionOpen("changes")}
        onClick={() => toggleSection("changes")}
        disabled={!hasChanges}
        // Refresh moved onto the icon so the row itself is free to expand.
        onIconClick={handleRefresh}
        iconTitle="Refresh git state"
        loading={isManualRefresh}
        hoverAction={
          hasChanges
            ? {
                icon: <Undo className="size-3.5" />,
                title: "Revert every change in the working tree",
                onClick: () =>
                  setConfirmDiscard({ key: "*", files: changedFilePaths }),
                pending: discarding === "*",
              }
            : undefined
        }
        trailing={
          // Animated digits so a count ticking up mid-run reads as movement
          // rather than a silent swap — same treatment as the diff summary bar.
          <Text
            as="span"
            size="xxs"
            tone="inherit"
            weight="medium"
            className="flex items-center gap-1"
          >
            <NumberFlow value={additions} prefix="+" className={DIFF_ADDED_TEXT} />
            <NumberFlow value={deletions} prefix="-" className={DIFF_REMOVED_TEXT} />
          </Text>
        }
      />
      <PanelCollapse isOpen={isSectionOpen("changes")}>
        {/* Capped like the subagent list — a big changeset shouldn't push the
            actions below it off the screen. */}
        <div className="max-h-56 overflow-y-auto noscrollbar">
          {changedFilePaths.map((file) => (
            <ChangedFileRow
              key={file.path}
              file={file}
              onOpen={handleOpenFileDiff}
              opening={openingDiff === file.path}
              onDiscard={() =>
                setConfirmDiscard({ key: file.path, files: [file] })
              }
              discarding={discarding === file.path}
            />
          ))}
        </div>
      </PanelCollapse>

      {/* Portals to the body, so it isn't clipped by the panel's scroll box. */}
      <Alert
        isOpen={!!confirmDiscard}
        title={confirmDiscard ? describeDiscard(confirmDiscard.files).title : ""}
        description={
          confirmDiscard ? describeDiscard(confirmDiscard.files).description : ""
        }
        primaryButtonText="Revert"
        secondaryButtonText="Cancel"
        primaryButtonVariant="danger"
        onPrimary={() => confirmDiscard && handleDiscard(confirmDiscard)}
        onSecondary={() => setConfirmDiscard(null)}
        isPrimaryLoading={discarding !== null}
      />
    </>
  );
}

/**
 * One changed file: name, its directory, and its own +/-.
 *
 * The name leads and the directory follows it muted — a panel this narrow
 * truncates a full path down to nothing, and the name is what identifies the
 * file. Zero counts are omitted rather than shown as "+0", so a pure deletion
 * reads as one number instead of two.
 */
function ChangedFileRow({
  file,
  onOpen,
  opening,
  onDiscard,
  discarding,
}: {
  file: ChangedFile;
  onOpen: (filePath: string) => void;
  /** Its diff is being fetched — the icon spins until the tab opens. */
  opening: boolean;
  onDiscard: () => void;
  discarding: boolean;
}) {
  const name = file.path.split("/").pop() || file.path;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1) : undefined;

  return (
    <PanelItem
      icon={
        <FileIconComponent
          fileName={name}
          extension={extension}
          className="size-4"
        />
      }
      label={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{name}</span>
        </span>
      }
      trailing={
        <Text
          as="span"
          size="xxs"
          tone="inherit"
          weight="medium"
          className="flex items-center gap-1"
        >
          {file.additions > 0 && (
            <span className={DIFF_ADDED_TEXT}>+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span className={DIFF_REMOVED_TEXT}>-{file.deletions}</span>
          )}
        </Text>
      }
      hoverAction={{
        icon: <Undo className="size-3.5" />,
        title: file.isNew
          ? `Delete ${file.path}`
          : `Revert ${file.path} to its committed state`,
        onClick: onDiscard,
        pending: discarding,
      }}
      loading={opening}
      title={`Open the diff for ${file.path}`}
      onClick={() => onOpen(file.path)}
    />
  );
}
