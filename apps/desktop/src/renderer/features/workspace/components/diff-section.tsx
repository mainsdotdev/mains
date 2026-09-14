import { useCallback, useMemo, useState } from "react";
import { useAppDispatch } from "@/lib/redux/hooks";
import {
  useGetLatestWorkspaceDiffQuery,
  useListReviewFindingsByWorkspaceQuery,
  useDiscardWorkspacePathsMutation,
  type WorkspaceDiff,
  type FindingSeverity,
} from "@/lib/redux/api";
import { setPendingGoal, setPendingAutoExecute, setPendingReviewTarget } from "@/lib/redux/slices/workspaceSlice";
import { useWorkspaceVariant } from "@/hooks/use-workspace-variant";
import { FileIconComponent } from "@/components/ui/icons";
import {
  Diff,
  CircleDot,
  Chat,
  Codex,
  Refresh,
  Undo,
} from "@/components/ui/icons";
import { Alert, Button, Caption, Text, toast } from "@/components/ui";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { DIFF_ADDED_TEXT, DIFF_REMOVED_TEXT, SEVERITY_TEXT } from "../lib/severity";
import {
  parseFileDiffSegment,
  parsePerFileStats,
  type FileChangeStatus,
} from "../lib/parse-diff";
import { normalizePath, pathsMatch } from "../lib/path-utils";
import { describeDiscard, type DiscardTarget } from "../lib/describe-discard";

interface DiffSectionProps {
  workspaceId: string;
  onSelectDiffFile: (filePath: string, diffText: string) => void;
}

/** Status badge for the diff (insertions/deletions) */
function DiffStats({ stats }: { stats: WorkspaceDiff["stats"] }) {
  if (!stats?.shortstat) return null;

  const insertions = stats.shortstat.match(/(\d+) insertion/)?.[1];
  const deletions = stats.shortstat.match(/(\d+) deletion/)?.[1];

  return (
    <Text as="div" size="xxs" tone="inherit" className="flex items-center gap-1.5 tabular-nums">
      {insertions && (
        <span className={DIFF_ADDED_TEXT}>
          +{insertions}
        </span>
      )}
      {deletions && (
        <span className={DIFF_REMOVED_TEXT}>-{deletions}</span>
      )}
    </Text>
  );
}

/**
 * Single-letter git status per file row, in the slot the per-file +/- counts
 * used to occupy. Every row carries one, so it reads as a column rather than
 * an exception marker — the totals in the header cover the line arithmetic.
 */
const STATUS_LETTER: Record<
  FileChangeStatus,
  { label: string; title: string; className: string }
> = {
  added: {
    label: "A",
    title: "Added",
    className: "text-success",
  },
  untracked: {
    label: "U",
    title: "Untracked",
    className: "text-success",
  },
  modified: {
    label: "M",
    title: "Modified",
    className: "text-warning",
  },
  deleted: {
    label: "D",
    title: "Deleted",
    className: "text-danger",
  },
  renamed: {
    label: "R",
    title: "Renamed",
    className: "text-accent",
  },
};

function FileStatusLetter({
  status,
  title,
  className = "",
}: {
  status: FileChangeStatus;
  title?: string;
  /** Lets the row fade the letter out while its Undo takes the slot. */
  className?: string;
}) {
  const letter = STATUS_LETTER[status];
  return (
    <span
      title={title ?? letter.title}
      // Fixed width so the letters line up into a column regardless of name length.
      className={`shrink-0 w-3 text-center text-xxs font-medium tabular-nums ${letter.className} ${className}`}
    >
      {letter.label}
    </span>
  );
}

/** Finding severity indicator dots */
function FindingBadges({ counts }: { counts: Record<FindingSeverity, number> }) {
  return (
    <Text as="div" size="t" tone="inherit" className="flex items-center gap-1 tabular-nums shrink-0">
      {counts.critical > 0 && (
        <span className="flex items-center gap-0.5">
          <CircleDot className={`size-2 ${SEVERITY_TEXT.critical}`} />
          <span className={SEVERITY_TEXT.critical}>{counts.critical}</span>
        </span>
      )}
      {counts.warning > 0 && (
        <span className="flex items-center gap-0.5">
          <CircleDot className={`size-2 ${SEVERITY_TEXT.warning}`} />
          <span className={SEVERITY_TEXT.warning}>{counts.warning}</span>
        </span>
      )}
      {counts.info > 0 && (
        <span className="flex items-center gap-0.5">
          <CircleDot className={`size-2 ${SEVERITY_TEXT.info}`} />
          <span className={SEVERITY_TEXT.info}>{counts.info}</span>
        </span>
      )}
    </Text>
  );
}

export function DiffSection({
  workspaceId,
  onSelectDiffFile,
}: DiffSectionProps) {
  const dispatch = useAppDispatch();
  const variant = useWorkspaceVariant();
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);

  const { currentData: diff, isFetching } = useGetLatestWorkspaceDiffQuery(
    workspaceId,
    { skip: !workspaceId },
  );

  const diffText = diff?.diffText;
  const untrackedFiles = diff?.untrackedFiles;
  const fileStats = useMemo(
    () => (diffText ? parsePerFileStats(diffText, untrackedFiles) : {}),
    [diffText, untrackedFiles],
  );

  const { data: allFindings } = useListReviewFindingsByWorkspaceQuery(
    { workspaceId },
    { skip: !workspaceId },
  );

  const diffFiles = diff?.files;
  const findingsByFile = useMemo(() => {
    const map: Record<string, Record<FindingSeverity, number>> = {};
    if (!allFindings) return map;
    for (const f of allFindings) {
      if (f.isApproved) continue;
      const fNorm = normalizePath(f.file);
      // This list is the changed files and nothing else, so a finding on a file
      // the diff doesn't touch has no row to attach to — it stays in the review
      // panel rather than inventing an entry here.
      const matchedFile = diffFiles?.find((dp: string) => pathsMatch(normalizePath(dp), fNorm));
      if (!matchedFile) continue;
      if (!map[matchedFile]) map[matchedFile] = { critical: 0, warning: 0, info: 0 };
      const sev = (
        ["critical", "warning", "info"].includes(f.severity)
          ? f.severity
          : "info"
      ) as FindingSeverity;
      map[matchedFile][sev]++;
    }
    return map;
  }, [allFindings, diffFiles]);

  const [discardWorkspacePaths] = useDiscardWorkspacePathsMutation();
  /** Path being reverted — its row keeps the spinner until the call settles. */
  const [discarding, setDiscarding] = useState<string | null>(null);
  /** The pending Undo, held until confirmed — discarding can't be undone. */
  const [confirmDiscard, setConfirmDiscard] = useState<DiscardTarget | null>(null);

  /**
   * Restore one file to its HEAD state. The mutation invalidates this
   * workspace's diff cache and the main process re-records the snapshot, so the
   * list drops the row on its own — nothing to refetch by hand here.
   */
  const handleDiscard = useCallback(
    async (target: DiscardTarget) => {
      if (discarding) return;
      setDiscarding(target.path);
      try {
        await discardWorkspacePaths({
          workspaceId,
          paths: [target.path],
        }).unwrap();
        toast.success(`Reverted ${target.path.split("/").pop()}`);
      } catch (err) {
        toast.error(extractErrorMessage(err, "Failed to revert changes."));
      } finally {
        setDiscarding(null);
        setConfirmDiscard(null);
      }
    },
    [workspaceId, discarding, discardWorkspacePaths],
  );

  const handleReviewChanges = () => {
    if (variant === "codex") {
      dispatch(setPendingReviewTarget({ type: "uncommittedChanges" }));
      return;
    }
    dispatch(setPendingGoal("Review code changes in this workspace"));
    dispatch(setPendingAutoExecute(true));
  };

  if (isFetching) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Text as="span" size="xs" tone="subtle">
          Loading changes...
        </Text>
      </div>
    );
  }

  if (!diff || !diff.files || diff.files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 px-4 text-center">
          <Diff className="w-4 h-4 dark:text-primary-300 text-primary-700" />
          <Caption>
            No changes detected.
          </Caption>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Action buttons */}
      <div className="shrink-0 flex items-center gap-2 mb-2">
        <Button
          onClick={handleReviewChanges}
          className="flex-1 flex items-center glass-outline justify-center gap-1.5 py-2 px-3 text-xs font-medium rounded-xl bg-primary-100/50 dark:bg-primary/5 hover:bg-primary-100 dark:hover:bg-primary/10 text-primary-900 dark:text-primary-100 transition-colors"
        >
          {variant === "codex" ? <Codex className="w-3.5 h-3.5" /> : <Chat className="w-3.5 h-3.5" />}
          Review Changes
        </Button>
      </div>

      {/* Stats header */}
      <div className="shrink-0 flex items-center justify-between px-1 py-1.5 mb-1">
        <Text as="span" size="xxs" tone="default">
          {diff.files.length} file{diff.files.length !== 1 ? "s" : ""} changed
        </Text>
        <DiffStats stats={diff.stats} />
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto noscrollbar space-y-1">
        {diff.files.map((filePath, index) => {
          const fileName = filePath.split("/").pop() || filePath;
          const dirPath = filePath.includes("/")
            ? filePath.substring(0, filePath.lastIndexOf("/"))
            : "";
          const isSelected = selectedDiffFile === filePath;
          const stat = fileStats[filePath];
          const status = stat?.status ?? "modified";
          const isDeleted = status === "deleted";
          const isNew = status === "added" || status === "untracked";
          const isDiscarding = discarding === filePath;

          return (
            // A row with two actions can't be one button — a button inside a
            // button is invalid — so the strip is a div and the zones answer to
            // different clicks, same shape as the git panel's change rows.
            <div
              key={filePath}
              className={`group w-full flex items-center gap-2 px-2 py-1 rounded-xl duration-200 transition-all animate-slide-in ${
                isSelected
                  ? "bg-primary/80 dark:bg-primary/5 glass-outline"
                  : "bg-transparent hover:bg-primary/20 dark:hover:bg-primary/5"
              }`}
              style={{ animationDelay: `${index * 0.02}s` }}
            >
              <Button
                // The path truncates in place, so the full one lives on hover.
                title={filePath}
                onClick={() => {
                  const segment = parseFileDiffSegment(filePath, diff.diffText);
                  setSelectedDiffFile(filePath);
                  onSelectDiffFile(filePath, segment || diff.diffText);
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <FileIconComponent
                  fileName={fileName}
                  extension={fileName.split(".").pop()}
                  className={`w-4 h-4 shrink-0 ${isDeleted ? "opacity-50" : ""}`}
                />
                <div className="flex items-baseline gap-1.5 min-w-0 flex-1">
                  <Text
                    as="span"
                    size="xs"
                    weight="medium"
                    tone={isDeleted ? "muted" : "default"}
                    // shrink-[0.25]: both children may truncate, but the path —
                    // longer and less identifying — gives up room first.
                    className={`min-w-0 shrink-[0.25] truncate ${
                      isDeleted
                        ? "line-through decoration-primary-800/50 dark:decoration-primary/50"
                        : ""
                    }`}
                  >
                    {fileName}
                  </Text>
                  {dirPath && (
                    <Text as="span" size="xxs" tone="subtle" className="min-w-0 truncate">
                      {dirPath}
                    </Text>
                  )}
                </div>
                {findingsByFile[filePath] && (
                  <FindingBadges counts={findingsByFile[filePath]} />
                )}
              </Button>
              {/* Stacked rather than swapped: Undo sits over the status letter,
                  so revealing it can't shift the row under the cursor. */}
              <span className="relative flex size-4 shrink-0 items-center justify-center">
                <FileStatusLetter
                  status={status}
                  title={stat?.oldPath ? `Renamed from ${stat.oldPath}` : undefined}
                  className={`transition-opacity ${
                    isDiscarding ? "opacity-0" : "group-hover:opacity-0"
                  }`}
                />
                <Button
                  onClick={() => setConfirmDiscard({ path: filePath, isNew })}
                  disabled={isDiscarding}
                  title={
                    isNew
                      ? `Delete ${filePath}`
                      : `Revert ${filePath} to its committed state`
                  }
                  aria-label={
                    isNew
                      ? `Delete ${filePath}`
                      : `Revert ${filePath} to its committed state`
                  }
                  className={`absolute inset-0 flex items-center justify-center rounded-md text-primary-600 transition-opacity hover:text-primary-900 focus-visible:opacity-100 dark:text-primary-400 dark:hover:text-primary-100 ${
                    isDiscarding ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  {isDiscarding ? (
                    <Refresh className="size-3.5 animate-spin" />
                  ) : (
                    <Undo className="size-3.5" />
                  )}
                </Button>
              </span>
            </div>
          );
        })}
      </div>

      {/* Portals to the body, so it isn't clipped by this list's scroll box. */}
      <Alert
        isOpen={!!confirmDiscard}
        title={confirmDiscard ? describeDiscard([confirmDiscard]).title : ""}
        description={
          confirmDiscard ? describeDiscard([confirmDiscard]).description : ""
        }
        primaryButtonText="Revert"
        secondaryButtonText="Cancel"
        primaryButtonVariant="danger"
        onPrimary={() => confirmDiscard && handleDiscard(confirmDiscard)}
        onSecondary={() => setConfirmDiscard(null)}
        isPrimaryLoading={discarding !== null}
      />
    </div>
  );
}
