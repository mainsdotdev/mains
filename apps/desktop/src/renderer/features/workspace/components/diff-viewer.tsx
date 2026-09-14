import { useMemo, useState, useEffect, useCallback } from "react";
import { useAppDispatch } from "@/lib/redux/hooks";
import { PatchDiff, type DiffLineAnnotation } from "@pierre/diffs/react";
import {
  useListReviewFindingsByWorkspaceQuery,
  useGetWorkspaceQuery,
  useUpdateReviewFindingMutation,
} from "@/lib/redux/api";
import { setPendingGoal, setPendingAutoExecute } from "@/lib/redux/slices/workspaceSlice";
import { expandDiffForFindings } from "../lib/expand-diff";
import { normalizePatchForPatchDiff } from "../lib/patch-utils";
import { normalizePath, pathsMatch } from "../lib/path-utils";
import type { FileContentResponse, ServiceResponse } from "@/features/workspace/types/file-explorer";
import { ImagePreviewModal } from "./image-preview-modal";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { useIsDarkMode } from "@/hooks/use-is-dark-mode";
import { DIFF_TYPOGRAPHY_STYLE, patchDiffOptions } from "@/lib/diff-style";
import { useDiffHighlighterReady } from "@/lib/diff-highlighter";
import { Button, Text } from "@/components/ui";
import type { FindingSeverity } from "@/lib/redux/api";
import {
  asFindingSeverity,
  SEVERITY_HEX_LIGHT,
  SEVERITY_HEX_DARK,
  type SeverityHex,
} from "../lib/severity";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

function isImagePath(filePath: string | undefined): boolean {
  if (!filePath) return false;
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

function ImageDiffView({ absPath, fileName }: { absPath: string; fileName: string }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = useLocalImageUrl(absPath);

  return (
    <div className="h-full overflow-auto px-2  ">
      <div className="mx-auto ">
        {error ? (
          <Text as="div" size="xs" tone="danger" className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 break-all">
            <Text as="div" size="inherit" tone="inherit" weight="medium" className="mb-1">Image failed to load</Text>
            <div className="opacity-70">{error}</div>
            <div className="mt-1 font-mono opacity-60">{absPath}</div>
          </Text>
        ) : url ? (
          <Button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="block w-full overflow-hidden  cursor-pointer"
            title={absPath}
          >
            <img
              src={url}
              alt={fileName}
              className="w-full max-h-[70vh] object-contain"
              loading="lazy"
              onError={(e) => {
                setError(`Failed to load (src=${(e.currentTarget as HTMLImageElement).src})`);
              }}
            />
          </Button>
        ) : null}
        {previewOpen && url && (
          <ImagePreviewModal name={fileName} src={url} onClose={() => setPreviewOpen(false)} />
        )}
      </div>
    </div>
  );
}

interface Finding {
  id: string;
  lineStart: number | null;
  lineEnd: number | null;
  severity: string;
  file: string;
  message: string;
  reason: string;
  suggestion: string | null;
  isApproved: boolean;
}

interface FindingMeta {
  findings: Finding[];
}

interface DiffViewerProps {
  diffText: string;
  filename?: string;
  className?: string;
  workspaceId?: string;
  filePath?: string;
}

// ── FindingAnnotation (module-scope) ─────────────────────

interface FindingAnnotationOptions {
  colors: Record<FindingSeverity, SeverityHex>;
  textColor: string;
  mutedColor: string;
  suggestionColor: string;
  onApprove: (id: string) => void;
  onFix: (finding: Finding) => void;
}

function makeFindingAnnotation({ colors, textColor, mutedColor, suggestionColor, onApprove, onFix }: FindingAnnotationOptions) {
  return function FindingAnnotation({ metadata }: DiffLineAnnotation<FindingMeta>) {
    const { findings } = metadata!;

    return (
      <div className="finding-annotation" style={findings.length === 0 ? { display: "none" } : undefined}>
        {findings.map((f) => {
          const sev = asFindingSeverity(f.severity);
          const c = colors[sev];
          return (
            <div
              key={`${sev}-${f.lineStart}-${f.message}`}
              className="finding-card py-2 my-2 mx-2 border-b last:border-b-0 dark:border-primary/10 border-primary/20"
              style={{ backgroundColor: c.line }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <span
                    className="px-1 py-0.5 text-xxs rounded-sm capitalize mr-2"
                    style={{ backgroundColor: c.pillBg, color: c.pill }}
                  >
                    {sev}
                  </span>
                  <span className="finding-message" style={{ color: textColor }}>
                    {f.message}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    onClick={() => onApprove(f.id)}
                    className="px-2 cursor-pointer py-0.5 text-xxs rounded-sm font-medium transition-colors bg-success/10 text-success"
                  >
                    ✓ Approve
                  </Button>
                  <Button
                    onClick={() => onFix(f)}
                    className="px-2 cursor-pointer py-0.5 text-xxs rounded-sm font-medium transition-colors bg-accent/10 text-accent"
                  >
                    Fix
                  </Button>
                </div>
              </div>
              {f.reason && (
                <p className="finding-reason" style={{ color: mutedColor }}>
                  {f.reason}
                </p>
              )}
              {f.suggestion && (
                <p className="mt-2" style={{ color: suggestionColor }}>
                  <span className="">Suggestion: </span>
                  {f.suggestion}
                </p>
              )}
            </div>
          );
        })}
      </div>
    );
  };
}

// ── Component ─────────────────────────────────────────────

export function DiffViewer({
  diffText,
  className = "",
  workspaceId,
  filePath,
}: DiffViewerProps) {
  const isDarkMode = useIsDarkMode();
  const dispatch = useAppDispatch();
  const [updateFinding] = useUpdateReviewFindingMutation();
  // Don't mount PatchDiff before the highlighter is live — it renders nothing
  // and doesn't repaint when the highlighter lands, so the pane would stay
  // blank until an unrelated re-render (opening another file) revived it.
  const highlighterReady = useDiffHighlighterReady();

  const { data: allFindings } = useListReviewFindingsByWorkspaceQuery(
    { workspaceId: workspaceId! },
    { skip: !workspaceId },
  );

  const { data: workspace } = useGetWorkspaceQuery(workspaceId!, { skip: !workspaceId });

  const fileFindings = useMemo(() => {
    if (!allFindings || !filePath) return [];
    const target = normalizePath(filePath);
    return allFindings.filter((f) => pathsMatch(normalizePath(f.file), target) && !f.isApproved);
  }, [allFindings, filePath]);

  // Keep the buffered source text keyed to the filePath it came from. Reading
  // at render time with `cache.path !== filePath` makes the previous file's
  // multi-MB split-lines array drop out automatically when the target
  // changes — no effect-setState churn and no stale retention.
  const [fileLinesCache, setFileLinesCache] = useState<{
    path: string | null;
    lines: string[] | null;
  }>({ path: null, lines: null });
  const fileLines =
    filePath && fileLinesCache.path === filePath ? fileLinesCache.lines : null;

  const findingLineNumbers = useMemo(
    () => fileFindings.map((f) => (f.lineStart != null && f.lineStart >= 1 ? f.lineStart : 1)),
    [fileFindings],
  );

  useEffect(() => {
    if (findingLineNumbers.length === 0 || !workspace?.rootPath || !filePath) return;

    let cancelled = false;
    window.api.fileExplorer
      .readFileText({ filePath: `${workspace.rootPath}/${filePath}` })
      .then((result: ServiceResponse<FileContentResponse>) => {
        if (!cancelled && result.success && result.data && !result.data.isBinary) {
          setFileLinesCache({
            path: filePath,
            lines: result.data.content.split("\n"),
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [findingLineNumbers.length, workspace?.rootPath, filePath]);

  const singleFilePatch = useMemo(
    () => normalizePatchForPatchDiff(diffText, filePath),
    [diffText, filePath],
  );

  const expandedDiff = useMemo(() => {
    if (!fileLines || findingLineNumbers.length === 0) return singleFilePatch;
    return expandDiffForFindings(singleFilePatch, findingLineNumbers, fileLines);
  }, [singleFilePatch, findingLineNumbers, fileLines]);

  const lineAnnotations = useMemo(() => {
    if (fileFindings.length === 0) return undefined;

    const byLine = new Map<number, Finding[]>();
    for (const f of fileFindings) {
      const line = f.lineStart != null && f.lineStart >= 1 ? f.lineStart : 1;
      const arr = byLine.get(line) ?? [];
      arr.push(f);
      byLine.set(line, arr);
    }

    const annotations: DiffLineAnnotation<FindingMeta>[] = [];
    for (const [lineNumber, findings] of byLine) {
      annotations.push({
        side: "additions",
        lineNumber,
        metadata: { findings },
      });
    }
    return annotations;
  }, [fileFindings]);

  const colors = isDarkMode ? SEVERITY_HEX_DARK : SEVERITY_HEX_LIGHT;
  const textColor = isDarkMode ? "#fff" : "#1c1917";
  const mutedColor = isDarkMode ? "#dad8ce" : "#78716c";
  const suggestionColor = isDarkMode ? "#86efac" : "#16a34a";

  const handleApprove = useCallback(
    (id: string) => {
      updateFinding({ id, payload: { isApproved: true } });
    },
    [updateFinding],
  );

  const handleFix = useCallback(
    (finding: Finding) => {
      const lines = [
        `Fix the following issue in \`${finding.file}\`${finding.lineStart ? ` (line ${finding.lineStart}${finding.lineEnd && finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : ""})` : ""}:`,
        ``,
        `**${finding.severity.toUpperCase()}**: ${finding.message}`,
        finding.reason ? `\nReason: ${finding.reason}` : "",
        finding.suggestion ? `\nSuggestion: ${finding.suggestion}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      dispatch(setPendingGoal(lines));
      dispatch(setPendingAutoExecute(true));
    },
    [dispatch],
  );

  const renderAnnotation = useMemo(
    () => makeFindingAnnotation({ colors, textColor, mutedColor, suggestionColor, onApprove: handleApprove, onFix: handleFix }),
    [colors, textColor, mutedColor, suggestionColor, handleApprove, handleFix],
  );

  if (isImagePath(filePath) && workspace?.rootPath && filePath) {
    const fileName = filePath.split("/").pop() ?? filePath;
    const absPath = `${workspace.rootPath.replace(/\/$/, "")}/${filePath}`;
    return (
      <div className={`h-full overflow-auto ${className}`}>
        <ImageDiffView absPath={absPath} fileName={fileName} />
      </div>
    );
  }

  return (
    <div className={`h-full overflow-auto ${className}`}>
      {!expandedDiff.trim() ? (
        <Text as="div" size="xs" tone="subtle" className="px-4 py-3">No diff content to display.</Text>
      ) : !highlighterReady ? (
        <Text as="div" size="xs" tone="subtle" className="px-4 py-3 shine-text">Loading diff...</Text>
      ) : (
        <PatchDiff
          patch={expandedDiff}
          style={DIFF_TYPOGRAPHY_STYLE}
          options={patchDiffOptions(isDarkMode)}
          lineAnnotations={lineAnnotations}
          renderAnnotation={lineAnnotations ? renderAnnotation : undefined}
        />
      )}
    </div>
  );
}
