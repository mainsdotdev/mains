import { lazy, Suspense, useState } from "react";
import { Button, Text, toast } from "@/components/ui";
import { Diff, FileIconComponent, Undo } from "@/components/ui/icons";
import { extractErrorMessage } from "@/lib/extract-error-message";
import {
  useGetRunTurnChangesDiffQuery,
  useUndoRunTurnChangesMutation,
  type RunTurnChanges,
  type TurnFileChange,
} from "@/lib/redux/api";
import { DIFF_ADDED_TEXT, DIFF_REMOVED_TEXT } from "../lib/severity";

const DiffViewer = lazy(() =>
  import("./diff-viewer").then((m) => ({ default: m.DiffViewer })),
);

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "tif",
  "tiff",
  "webp",
]);

interface TurnChangesCardProps {
  runId: string;
  turnId: number;
  changes: RunTurnChanges;
  /** False while the run is live — the agent may still be editing these files. */
  canUndo: boolean;
}

function splitPath(filePath: string): { dir: string; name: string } {
  const slash = filePath.lastIndexOf("/");
  return slash === -1
    ? { dir: "", name: filePath }
    : { dir: filePath.slice(0, slash + 1), name: filePath.slice(slash + 1) };
}

function isImagePath(filePath: string): boolean {
  const name = splitPath(filePath).name;
  const dot = name.lastIndexOf(".");
  return dot > 0 && IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/**
 * One file's section of the turn patch. Matched on the whole header line, so a
 * path that prefixes another (`a.ts` / `a.ts.map`) never picks up its neighbour.
 */
function fileSection(diffText: string, file: TurnFileChange): string {
  const header = `diff --git a/${file.oldPath ?? file.path} b/${file.path}\n`;
  return (
    diffText.split(/^(?=diff --git )/m).find((s) => s.startsWith(header)) ?? ""
  );
}

function LineCounts({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  return (
    <span className="shrink-0 tabular-nums">
      <span className={DIFF_ADDED_TEXT}>+{additions}</span>{" "}
      <span className={DIFF_REMOVED_TEXT}>-{deletions}</span>
    </span>
  );
}

function FileDiffPanel({
  file,
  diffText,
  isLoading,
  loadError,
  onRetry,
  sharedScroll = false,
}: {
  file: TurnFileChange;
  /** undefined until loaded; null when the turn has no stored patch. */
  diffText: string | null | undefined;
  isLoading: boolean;
  /** Why the patch request failed — kept apart from a patch that doesn't exist. */
  loadError?: string;
  onRetry: () => void;
  /** Multiple files share one vertical scroller; single-file previews stay capped. */
  sharedScroll?: boolean;
}) {
  const section = diffText ? fileSection(diffText, file) : "";
  let notice: string | null = null;
  if (isLoading) notice = "Loading diff...";
  else if (loadError) notice = `Couldn't load this diff: ${loadError}`;
  else if (diffText === undefined) notice = "Loading diff...";
  else if (diffText === null) notice = "This turn's diff is no longer stored.";
  else if (file.binary)
    notice = isImagePath(file.path)
      ? "Image changed — no line diff available."
      : "Binary file — no preview.";
  else if (!section) notice = "This file's diff was too large to store.";

  return (
    <div
      className={`border-t border-primary-200/60 dark:border-primary-800/60 ${
        sharedScroll ? "" : "max-h-96 overflow-auto rounded-b-2xl"
      }`}
    >
      {notice ? (
        <Text
          as="div"
          size="xs"
          tone="subtle"
          className={`flex items-center gap-3 px-4 py-3 ${isLoading ? "shine-text" : ""}`}
        >
          <span className="min-w-0">{notice}</span>
          {loadError && !isLoading && (
            <Button
              onClick={onRetry}
              className="shrink-0 underline underline-offset-2 hover:text-primary-900 dark:hover:text-primary-100"
            >
              Retry
            </Button>
          )}
        </Text>
      ) : (
        <Suspense fallback={null}>
          <DiffViewer diffText={section} filePath={file.path} />
        </Suspense>
      )}
    </div>
  );
}

/**
 * What one agent turn did to the working tree — the transcript's "Edited N
 * files" card. Review expands per-file diffs from the stored patch; Undo
 * reverse-applies that patch. See CONTEXT.md "turn changes".
 */
export function TurnChangesCard({
  runId,
  turnId,
  changes,
  canUndo,
}: TurnChangesCardProps) {
  const { files } = changes;
  const [openPaths, setOpenPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Finished runs don't re-sync their turns, so a successful undo is also held
  // locally until the next load brings `undoneAt` back from the row.
  const [undoneLocally, setUndoneLocally] = useState(false);
  const isUndone = Boolean(changes.undoneAt) || undoneLocally;

  const [undoChanges, { isLoading: isUndoing }] =
    useUndoRunTurnChangesMutation();
  const {
    data: diff,
    isFetching,
    error,
    refetch,
  } = useGetRunTurnChangesDiffQuery(
    { runId, turnId },
    { skip: openPaths.size === 0 },
  );
  const loadError = error
    ? extractErrorMessage(error, "Unknown error")
    : undefined;
  const diffText = diff === undefined ? undefined : (diff?.diffText ?? null);

  const title =
    files.length === 1
      ? `Edited ${splitPath(files[0].path).name}`
      : `Edited ${files.length} files`;
  const allOpen = files.length > 0 && files.every((f) => openPaths.has(f.path));
  const singleFileOpen = files.length === 1 && openPaths.has(files[0].path);
  const hasContentBelowHeader = files.length > 1 || singleFileOpen;
  const binaryFiles = files.filter((file) => file.binary);
  const allFilesBinary =
    files.length > 0 && binaryFiles.length === files.length;
  let binarySummary: string | null = null;
  if (binaryFiles.length > 0) {
    if (!allFilesBinary) {
      binarySummary = `${binaryFiles.length} binary ${binaryFiles.length === 1 ? "file" : "files"}`;
    } else if (binaryFiles.every((file) => isImagePath(file.path))) {
      binarySummary =
        binaryFiles.length === 1
          ? "Image changed"
          : `${binaryFiles.length} images changed`;
    } else {
      binarySummary =
        binaryFiles.length === 1
          ? "Binary file changed"
          : `${binaryFiles.length} binary files changed`;
    }
  }

  const toggleFile = (filePath: string) =>
    setOpenPaths((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });

  const toggleReview = () =>
    setOpenPaths(allOpen ? new Set() : new Set(files.map((f) => f.path)));

  const handleUndo = async () => {
    try {
      await undoChanges({ runId, turnId }).unwrap();
      setUndoneLocally(true);
      toast.success(
        files.length === 1
          ? `Reverted ${splitPath(files[0].path).name}`
          : `Reverted ${files.length} files`,
      );
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to undo these changes."));
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl">
      <div
        className={`flex items-center gap-3 px-3 py-2.5 glass-card ${
          hasContentBelowHeader ? "rounded-t-2xl" : "rounded-2xl"
        }`}
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900">
          <Diff className="size-4 text-primary-600 dark:text-primary-400" />
        </div>
        <div className="min-w-0 flex-1">
          <Text as="div" size="s" weight="medium" className="truncate">
            {title}
          </Text>
          <Text
            as="div"
            size="xs"
            tone="subtle"
            className="flex items-center gap-2"
          >
            {!allFilesBinary && (
              <LineCounts
                additions={changes.additions}
                deletions={changes.deletions}
              />
            )}
            {binarySummary && <span>{binarySummary}</span>}
            {isUndone && <span>Undone</span>}
            {!isUndone && changes.truncated && <span>Too large to undo</span>}
          </Text>
        </div>
        {!isUndone && (
          <Button
            onClick={handleUndo}
            disabled={isUndoing || !canUndo}
            title={
              canUndo
                ? "Undo this turn's file changes"
                : "Undo is available when the run finishes"
            }
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-s text-primary-700 hover:bg-primary-100 dark:text-primary-300 dark:hover:bg-primary-900"
          >
            Undo
            <Undo className="size-3.5" />
          </Button>
        )}
        <Button className="text-xs" variant="primary" onClick={toggleReview}>
          {allOpen ? "Hide" : "Review"}
        </Button>
      </div>

      {files.length > 1 ? (
        <div className="max-h-[70vh] overflow-y-auto rounded-b-2xl border-x border-b border-primary-200 dark:border-primary-800">
          {files.map((file) => {
            const { dir, name } = splitPath(file.path);
            const dot = name.lastIndexOf(".");
            const extension = dot > 0 ? name.slice(dot + 1) : undefined;
            const open = openPaths.has(file.path);
            return (
              <div key={file.path} className="last:rounded-b-2xl">
                <Button
                  onClick={() => toggleFile(file.path)}
                  aria-expanded={open}
                  className="sticky top-0 z-10 flex w-full items-center gap-2 bg-primary px-3 py-1.5 text-left hover:bg-primary-100/95 dark:bg-primary-950 dark:hover:bg-primary-900/95"
                >
                  <FileIconComponent
                    fileName={name}
                    extension={extension}
                    className="size-4 shrink-0"
                  />
                  <Text
                    as="span"
                    size="s"
                    tone="subtle"
                    className="min-w-0 flex-1 truncate"
                  >
                    <span className="opacity-60">{dir}</span>
                    {name}
                  </Text>
                  {file.binary ? (
                    <Text as="span" size="xs" tone="subtle">
                      {isImagePath(file.path) ? "image" : "binary"}
                    </Text>
                  ) : (
                    <Text as="span" size="xs" tone="inherit">
                      <LineCounts
                        additions={file.additions}
                        deletions={file.deletions}
                      />
                    </Text>
                  )}
                </Button>
                {open && (
                  <FileDiffPanel
                    file={file}
                    diffText={diffText}
                    isLoading={isFetching}
                    loadError={loadError}
                    onRetry={refetch}
                    sharedScroll
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        files[0] &&
        singleFileOpen && (
          <div className="overflow-hidden rounded-b-2xl border-x border-b border-primary-200 dark:border-primary-800">
            <FileDiffPanel
              file={files[0]}
              diffText={diffText}
              isLoading={isFetching}
              loadError={loadError}
              onRetry={refetch}
            />
          </div>
        )
      )}
    </div>
  );
}
