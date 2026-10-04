import { memo, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { LazyMotion, domAnimation, m } from "motion/react";
import { FileDiff, Virtualizer, useVirtualizer, type DiffLineAnnotation } from "@pierre/diffs/react";
import { DEFAULT_VIRTUAL_FILE_METRICS } from "@pierre/diffs";
import type { ReviewComment } from "@mains/contracts/review-comments";
import { Button, Text, toast } from "@/components/ui";
import { ArrowUp, Chat, Refresh, FileIconComponent, Review } from "@/components/ui/icons";
import { PreviewPanelControls } from "@/components/layout/preview-panel-controls";
import { useGetLatestWorkspaceDiffQuery, useResyncWorkspaceDiffMutation } from "@/lib/redux/api";
import { useAppSelector } from "@/lib/redux/hooks";
import { useIsDarkMode } from "@/hooks/use-is-dark-mode";
import { DIFF_TYPOGRAPHY_STYLE, patchDiffOptions } from "@/lib/diff-style";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { useComposerContextActions, useComposerReviewComments } from "../hooks/use-composer-context";
import { useReviewPanelTransition } from "../hooks/use-review-panel-transition";
import { reviewFiles, reviewLineText, reviewCommentMatches, type ReviewDiffStyle, type ReviewFile } from "../lib/review-diff";
import { useReviewFileNavigation, type ReviewFileNavigation, type ReviewFileTarget } from "../hooks/use-review-file-navigation";
import { ReviewCommentCard, ReviewCommentEditor } from "./review-comment-card";
import { InvertedCorner } from "./base-tab";
import { ReviewDiffProvider } from "./review-diff-provider";
import { ReviewToolbar } from "./review-toolbar";

interface DraftLine { side: ReviewComment["side"]; lineNumber: number; lineText: string }
interface Annotation { comments: ReviewComment[]; draft?: DraftLine }

const ReviewFileDiff = memo(function ReviewFileDiff({ file, workspaceId, rootPath, onCommentAdded, diffStyle, registerFile }: {
  file: ReviewFile;
  workspaceId: string;
  rootPath: string;
  onCommentAdded: () => void;
  diffStyle: ReviewDiffStyle;
  registerFile: (path: string, target: ReviewFileTarget) => () => void;
}) {
  const section = useRef<HTMLElement>(null);
  const header = useRef<HTMLButtonElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState<DraftLine | null>(null);
  const reviewComments = useComposerReviewComments(workspaceId, file.path);
  const { add, update, remove } = useComposerContextActions();
  const isDark = useIsDarkMode();
  const codeFontSize = useAppSelector((state) => state.appSettings.codeFontSize);
  const metrics = useMemo(() => ({ ...DEFAULT_VIRTUAL_FILE_METRICS, lineHeight: codeFontSize * 5 / 3 }), [codeFontSize]);
  const diffOptions = patchDiffOptions(isDark);
  const comments = useMemo(() => reviewComments.filter((comment) => reviewCommentMatches(comment, workspaceId, file)), [reviewComments, workspaceId, file]);
  useLayoutEffect(() => {
    if (!section.current) return;
    return registerFile(file.path, { element: section.current, expand: () => setCollapsed(false), focus: () => header.current?.focus({ preventScroll: true }) });
  }, [file.path, registerFile]);
  const annotations = useMemo(() => {
    const grouped = new Map<string, DiffLineAnnotation<Annotation>>();
    for (const comment of comments) {
      const key = `${comment.side}:${comment.lineNumber}`;
      const annotation = grouped.get(key) ?? { side: comment.side, lineNumber: comment.lineNumber, metadata: { comments: [] } };
      annotation.metadata.comments.push(comment);
      grouped.set(key, annotation);
    }
    if (draft) {
      const key = `${draft.side}:${draft.lineNumber}`;
      const annotation = grouped.get(key) ?? { side: draft.side, lineNumber: draft.lineNumber, metadata: { comments: [] } };
      annotation.metadata.draft = draft;
      grouped.set(key, annotation);
    }
    return [...grouped.values()];
  }, [comments, draft]);
  const additions = file.diff?.hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0) ?? 0;
  const deletions = file.diff?.hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0) ?? 0;
  const status = file.diff?.type === "new" ? "A" : file.diff?.type === "deleted" ? "D" : file.diff?.prevName ? "R" : "M";
  const openComment = (side: ReviewComment["side"], lineNumber: number) => {
    if (!file.diff) return;
    const lineText = reviewLineText(file.diff, side, lineNumber);
    if (lineText !== undefined) setDraft({ side, lineNumber, lineText });
  };
  return <section ref={section} className="border-b border-primary-200/60 dark:border-primary-800/60" aria-label={`Changes in ${file.path}`}>
    <Button ref={header} type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}
      className="sticky top-0 z-10 flex w-full items-center gap-2.5 bg-primary px-4 py-3 text-left text-xs dark:bg-primary-950">
      <ArrowUp className={`size-3.5 shrink-0 text-primary-500 transition-transform ${collapsed ? "rotate-90" : "rotate-180"}`} />
      <FileIconComponent fileName={file.path} className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-primary-900 dark:text-primary-100" title={file.path}>
        {file.diff?.prevName && <span className="text-primary-500">{file.diff.prevName} → </span>}{file.path}
      </span>
      {!!comments.length && <span className="flex items-center gap-1 text-primary-500"><Chat className="size-3" />{comments.length}</span>}
      <span className="text-primary-500">{status}</span>
      <span className="tabular-nums text-success">+{additions}</span><span className="tabular-nums text-danger">-{deletions}</span>
    </Button>
    {!collapsed && (file.diff?.hunks.length ? <FileDiff fileDiff={file.diff}
      style={DIFF_TYPOGRAPHY_STYLE} metrics={metrics} lineAnnotations={annotations} selectedLines={null}
      options={{ ...diffOptions, diffStyle, enableGutterUtility: true,
        unsafeCSS: `${diffOptions.unsafeCSS ?? ""}
          [data-utility-button] {
            background: var(--color-${isDark ? "primary" : "primary-950"}) !important;
            color: var(--color-${isDark ? "primary-950" : "primary"}) !important;
            border-radius: 12px !important;
          }`,
        onGutterUtilityClick: ({ start, side = "additions" }) => {
          openComment(side, start);
        },
        onLineEnter: ({ numberElement, annotationSide, lineNumber }) => {
          const button = numberElement.querySelector<HTMLButtonElement>("[data-utility-button]");
          if (!button) return;
          button.setAttribute("aria-label", `Add comment on ${annotationSide === "deletions" ? "L" : "R"}${lineNumber} in ${file.path}`);
          // The library handles pointer selection; keyboard and accessibility clicks need a click handler.
          button.onclick = (event) => { if (event.detail === 0) openComment(annotationSide, lineNumber); };
          button.onkeydown = (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            openComment(annotationSide, lineNumber);
          };
        } }}
      renderAnnotation={({ metadata }) => <div className="space-y-2 px-3 py-3" style={{ fontFamily: "var(--font-sans)" }}>
        {metadata.comments.map((comment) => <ReviewCommentCard key={comment.id} comment={comment}
          onUpdate={(text) => update({ kind: "review", ...comment, comment: text })}
          onRemove={() => remove({ kind: "review", ...comment })} />)}
        {metadata.draft && <div className="glass-card max-w-2xl rounded-xl p-3">
          <Text as="div" size="xs" tone="subtle" className="mb-2">Comment on {metadata.draft.side === "deletions" ? "L" : "R"}{metadata.draft.lineNumber}</Text>
          <ReviewCommentEditor key={`${file.patchId}:${metadata.draft.side}:${metadata.draft.lineNumber}`}
            onCancel={() => setDraft(null)} onSave={(comment) => {
              const line = metadata.draft!;
              add({ kind: "review", id: crypto.randomUUID(), workspaceId, filePath: file.path,
                absolutePath: `${rootPath.replace(/\/$/, "")}/${line.side === "deletions" ? file.diff?.prevName ?? file.path : file.path}`,
                patchId: file.patchId, ...line, comment });
              setDraft(null);
              onCommentAdded();
            }} />
        </div>}
      </div>} />
      : <p className="px-4 py-6 text-xs text-primary-500">{file.error ?? (file.diff?.prevName ? "File renamed without text changes." : "No text changes to display.")}</p>)}
  </section>;
});

const ReviewFileList = memo(function ReviewFileList({ files, workspaceId, rootPath, onCommentAdded, diffStyle, navigationRef }: {
  files: readonly ReviewFile[];
  workspaceId: string;
  rootPath: string;
  onCommentAdded: () => void;
  diffStyle: ReviewDiffStyle;
  navigationRef: Ref<ReviewFileNavigation>;
}) {
  const registerFile = useReviewFileNavigation(useVirtualizer(), navigationRef);
  return files.map((file) => <ReviewFileDiff key={`${workspaceId}:${file.path}:${file.patchId}`}
    file={file} workspaceId={workspaceId} rootPath={rootPath} onCommentAdded={onCommentAdded}
    diffStyle={diffStyle} registerFile={registerFile} />);
});

export function WorkspaceReview({ workspaceId, rootPath, isExpanded, onToggleExpanded, chatVisible, setChatHost, onCommentAdded }: {
  workspaceId: string;
  rootPath: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  chatVisible: boolean;
  onToggleChat: () => void;
  setChatHost: (node: HTMLDivElement | null) => void;
  onCommentAdded: () => void;
}) {
  const header = useRef<HTMLElement>(null);
  const navigation = useRef<ReviewFileNavigation>(null);
  const [diffStyle, setDiffStyle] = useState<ReviewDiffStyle>("unified");
  const { currentData: snapshot, isFetching } = useGetLatestWorkspaceDiffQuery(workspaceId);
  const sidebarCollapsed = useAppSelector((state) => state.appSettings.sidebarCollapsed);
  const { anchorRef, expandedBoundsRef, panelStyle, headerStyle, bodyStyle } = useReviewPanelTransition(isExpanded);
  const [resync, { isLoading: refreshing }] = useResyncWorkspaceDiffMutation();
  const files = useMemo(() => reviewFiles(snapshot?.diffText ?? "", snapshot?.files ?? []), [snapshot]);
  const reviewComments = useComposerReviewComments(workspaceId);
  const filesByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const stale = useMemo(() => reviewComments.filter((comment) => {
    const file = filesByPath.get(comment.filePath);
    return !file || !reviewCommentMatches(comment, workspaceId, file);
  }), [reviewComments, filesByPath, workspaceId]);
  const refresh = async () => {
    try { await resync(workspaceId).unwrap(); }
    catch (error) { toast.error(extractErrorMessage(error, "Failed to refresh changes.")); }
  };
  return <div ref={anchorRef} className="relative h-full min-h-0">
    <div ref={expandedBoundsRef} aria-hidden="true" className="pointer-events-none invisible fixed inset-y-0 right-0 p-1.25"
      style={{
        width: "calc(100% - var(--content-left) + 0.3rem)",
        scrollMarginLeft: "var(--shell-header-inset-left, 0px)",
        minHeight: "var(--shell-header-height)",
      }} />
    <LazyMotion features={domAnimation}>
      <m.div data-workspace-review="" className="pointer-events-none fixed" style={panelStyle}>
        <div className="flex h-full min-h-0 flex-col">
          <m.header ref={header} className="pointer-events-auto relative flex shrink-0 items-center gap-1 rounded-t-2xl border-b border-primary-200/60 bg-primary px-4 dark:border-primary-800/60 dark:bg-primary-950 "
            style={headerStyle}>
            <InvertedCorner side="left" visible={isExpanded && sidebarCollapsed} />
            <Review className="size-4 text-primary-500" /><span className="text-sm font-medium text-primary-500">Review</span>
            <span className="min-w-0 flex-1 truncate text-s ml-1 text-primary-500">Uncommitted changes · {files.length} file{files.length === 1 ? "" : "s"}</span>
            <ReviewToolbar files={files} anchorRef={header} onJump={(path) => navigation.current?.jumpToFile(path)}
              diffStyle={diffStyle} onStyleChange={setDiffStyle} />
            <Button type="button" aria-label="Refresh review changes" disabled={refreshing || isFetching} onClick={() => void refresh()}
              className="rounded-lg p-2 text-primary-500 hover:bg-primary-100 dark:hover:bg-primary-900"><Refresh className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /></Button>
            <PreviewPanelControls label="Review" isExpanded={isExpanded} onToggleExpanded={onToggleExpanded}
              chatVisible={chatVisible}  />
          </m.header>
          <m.div className="pointer-events-auto relative isolate min-h-0 flex-1 overflow-hidden rounded-b-2xl bg-primary dark:bg-primary-950"
            style={bodyStyle}>
            <ReviewDiffProvider>
              <Virtualizer className="h-full overflow-y-auto" contentClassName="pb-56">
                {!!stale.length && <p className="border-b border-primary-200/60 px-4 py-3 text-xs text-primary-500 dark:border-primary-800/60">
                  {stale.length} comment{stale.length === 1 ? " refers" : "s refer"} to an earlier diff. Their original code is kept in the chat attachment.
                </p>}
                <ReviewFileList files={files} workspaceId={workspaceId} rootPath={rootPath} onCommentAdded={onCommentAdded}
                  diffStyle={diffStyle} navigationRef={navigation} />
                {!files.length && <div className="flex h-60 flex-col items-center justify-center gap-2 text-primary-500">
                  <Review className="size-5" /><p className="text-xs">{isFetching ? "Loading changes…" : "No changes detected."}</p>
                </div>}
              </Virtualizer>
            </ReviewDiffProvider>
            <div ref={setChatHost} className="pointer-events-none absolute inset-0 z-20" />
          </m.div>
        </div>
      </m.div>
    </LazyMotion>
  </div>;
}
