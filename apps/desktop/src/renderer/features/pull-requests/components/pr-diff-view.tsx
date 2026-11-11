import { useCallback, useMemo, useState } from "react";
import { PatchDiff, type DiffLineAnnotation } from "@pierre/diffs/react";
import { processFile } from "@pierre/diffs";
import {
  useGetPrDetailQuery,
  useGetPrDiffQuery,
  type PrComment,
  type PrRefInput,
  type PrReviewThread,
} from "@/lib/redux/api";
import { useIsDarkMode } from "@/hooks/use-is-dark-mode";
import {
  Body,
  Button,
  DiffFileHeader,
  SendButton,
  Text,
  Textarea,
  type DiffFileHeaderStatus,
} from "@/components/ui";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import { formatDate } from "@/lib/format-date";
import { DIFF_TYPOGRAPHY_STYLE, patchDiffOptions } from "@/lib/diff-style";
import { useDiffHighlighterReady } from "@/lib/diff-highlighter";
import { usePrActions, usePrDraft } from "../hooks/use-pull-request-actions";

interface FileDiff {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
  previousPath?: string;
  status: DiffFileHeaderStatus;
}

type DiffSide = "left" | "right";

/** Where a new inline comment is being composed. */
interface ComposerTarget {
  line: number;
  side: DiffSide;
}

interface AnnotationMeta {
  threads: PrReviewThread[];
  showComposer: boolean;
}

/** Split a multi-file unified diff into per-file sections. */
export function splitDiffByFile(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  const sections = diffText.split(/^(?=diff --git )/m).filter((s) => s.trim());

  for (const section of sections) {
    const headerMatch = section.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    // Use the same header parser as workspace review for renames and quoted paths.
    let header: ReturnType<typeof processFile>;
    try { header = processFile(section.split(/^@@ /m, 1)[0], { throwOnError: true }); }
    catch { /* A damaged hunk must not hide an otherwise readable file header. */ }
    const path = header?.name ?? headerMatch?.[2];
    if (!path) continue;
    const status = header?.type === "new" ? "A" : header?.type === "deleted" ? "D" : header?.prevName ? "R" : "M";

    let additions = 0;
    let deletions = 0;
    for (const line of section.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }

    files.push({ path, previousPath: header?.prevName, status, additions, deletions, patch: section });
  }
  return files;
}

function Avatar({ author }: { author: PrComment["author"] }) {
  const src = proxiedImageSrc(author?.avatarUrl);
  if (!src) {
    return <span className="size-5 rounded-full bg-primary/30 dark:bg-primary/10 shrink-0" />;
  }
  return <img src={src} alt={author?.login ?? ""} className="size-5 rounded-full shrink-0" />;
}

// ── Inline review thread card ─────────────────────────────

function InlineThreadCard({
  thread,
}: {
  thread: PrReviewThread;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const reply = usePrDraft();
  const replyText = reply.text;
  const actions = usePrActions();
  const isResolving = actions.pending?.kind === "resolve" && actions.pending.threadId === thread.id;
  const isReplying = actions.pending?.kind === "reply" && actions.pending.threadId === thread.id;
  const handleResolve = () => actions.run({ kind: "resolve", threadId: thread.id, resolved: true });
  const closeReply = () => { reply.invalidate(); setReplyOpen(false); };

  const handleReply = () => {
    const sent = reply.capture();
    return actions.run({ kind: "reply", threadId: thread.id, body: sent.body }, () => {
      if (sent.acknowledge()) setReplyOpen(false);
    });
  };

  return (
    <div className="rounded-3xl bg-primary/40 dark:bg-primary/5 glass-outline px-4 py-3">
      <div className="space-y-2">
        {thread.comments.map((comment) => (
          <div key={comment.id} className="flex items-start gap-2">
            <Avatar author={comment.author} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <Text
                  as="span"
                  size="s"
                  weight="medium"
                  className="tracking-tight"
                >
                  {comment.author?.login ?? "unknown"}
                </Text>
                <Text as="span" size="xs" tone="subtle">
                  {formatDate(comment.createdAt)}
                </Text>
              </div>
              <Text
                as="p"
                size="s"
                tone="secondary"
                className="whitespace-pre-wrap wrap-break-word"
              >
                {comment.body}
              </Text>
            </div>
          </div>
        ))}
      </div>

      {replyOpen ? (
        <div className="mt-2">
          <div className="relative">
            <Textarea
              autoFocus
              value={replyText}
              onChange={(e) => reply.edit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleReply();
                } else if (e.key === "Escape") {
                  closeReply();
                }
              }}
              placeholder="Reply"
              rows={2}
              className="w-full resize-none px-3 py-2 pr-12 text-s rounded-xl bg-primary/40 dark:bg-primary/5 glass-outline placeholder:text-primary-500 dark:placeholder:text-primary-500 text-primary-900 dark:text-primary-100 outline-none"
            />
            <div className="absolute bottom-2.5 right-2 z-10">
              <SendButton
                loading={isReplying}
                onSubmit={handleReply}
                disabled={!actions.can({ kind: "reply", threadId: thread.id, body: replyText })}
              />
            </div>
          </div>
          <Button
            onClick={closeReply}
            className="text-xxs px-2 py-0.5 rounded-lg hover:bg-primary/20 dark:hover:bg-primary/10 text-primary-600 dark:text-primary-400"
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 mt-2">
          <Button
          variant="subtle"
            onClick={() => setReplyOpen(true)}
            className="text-xxs px-2 py-0.5 rounded-lg hover:bg-primary/20 dark:hover:bg-primary/10 text-primary-700 dark:text-primary-300"
          >
            Reply
          </Button>
          {thread.viewerCanResolve && (
            <Button
            variant="subtle"
              disabled={!actions.can({ kind: "resolve", threadId: thread.id, resolved: true })}
              onClick={handleResolve}
              className="text-xxs px-2 py-0.5 rounded-lg hover:bg-primary/20 dark:hover:bg-primary/10 text-primary-700 dark:text-primary-300"
            >
              {isResolving ? "Resolving..." : "Resolve"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── New inline comment composer ───────────────────────────

function InlineCommentComposer({
  path,
  target,
  onClose,
}: {
  path: string;
  target: ComposerTarget;
  onClose: () => void;
}) {
  const draft = usePrDraft();
  const text = draft.text;
  const actions = usePrActions();
  const action = { kind: "review" as const, path, line: target.line, side: target.side, body: text };
  const isLoading = actions.pending?.kind === "review" && actions.pending.path === path &&
    actions.pending.line === target.line && actions.pending.side === target.side;
  const handleSubmit = () => {
    const sent = draft.capture();
    return actions.run({ ...action, body: sent.body }, () => { if (sent.acknowledge()) onClose(); });
  };

  return (
    <div className="rounded-xl bg-primary/40 dark:bg-primary/5 glass-outline px-3 py-2.5">
      <div className="relative">
        <Textarea
          autoFocus
          value={text}
          onChange={(e) => draft.edit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
          placeholder={`Comment on line ${target.line}`}
          rows={2}
          className="w-full resize-none px-3 py-2 pr-12 text-s rounded-xl bg-primary/40 dark:bg-primary/5 glass-outline placeholder:text-primary-500 dark:placeholder:text-primary-500 text-primary-900 dark:text-primary-100 outline-none"
        />
        <div className="absolute bottom-2.5 right-2 z-10">
          <SendButton
            loading={isLoading}
            onSubmit={handleSubmit}
            disabled={!actions.can(action)}
          />
        </div>
      </div>
      <Button
        onClick={onClose}
        className="text-xxs px-2 py-0.5 rounded-lg hover:bg-primary/20 dark:hover:bg-primary/10 text-primary-600 dark:text-primary-400"
      >
        Cancel
      </Button>
    </div>
  );
}

// ── File section ──────────────────────────────────────────

function FileSection({
  file,
  threads,
}: {
  file: FileDiff;
  threads: PrReviewThread[];
}) {
  const isDarkMode = useIsDarkMode();
  const [expanded, setExpanded] = useState(true);
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const closeComposer = useCallback(() => setComposer(null), []);

  // One annotation per (side, line): its threads plus — when targeted
  // there — the new-comment composer.
  const lineAnnotations = useMemo(() => {
    const byKey = new Map<string, DiffLineAnnotation<AnnotationMeta>>();

    for (const thread of threads) {
      if (thread.line == null) continue;
      const side = thread.side === "left" ? "deletions" : "additions";
      const key = `${side}:${thread.line}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.metadata!.threads.push(thread);
      } else {
        byKey.set(key, {
          side,
          lineNumber: thread.line,
          metadata: { threads: [thread], showComposer: false },
        });
      }
    }

    if (composer) {
      const side = composer.side === "left" ? "deletions" : "additions";
      const key = `${side}:${composer.line}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.metadata!.showComposer = true;
      } else {
        byKey.set(key, {
          side,
          lineNumber: composer.line,
          metadata: { threads: [], showComposer: true },
        });
      }
    }

    return byKey.size > 0 ? Array.from(byKey.values()) : undefined;
  }, [threads, composer]);

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<AnnotationMeta>) => {
      const { threads: lineThreads, showComposer } = annotation.metadata!;
      return (
        <div className="px-2 py-1.5 space-y-1.5">
          {lineThreads.map((thread) => (
            <InlineThreadCard key={thread.id} thread={thread} />
          ))}
          {showComposer && (
            <InlineCommentComposer
              key={JSON.stringify([file.path, annotation.lineNumber, annotation.side])}
              path={file.path}
              target={{
                line: annotation.lineNumber,
                side: annotation.side === "deletions" ? "left" : "right",
              }}
              onClose={closeComposer}
            />
          )}
        </div>
      );
    },
    [file.path, closeComposer],
  );

  return (
    <section className="border-b border-primary-200/60 dark:border-primary-800/60" aria-label={`Changes in ${file.path}`}>
      <div className="sticky top-0 z-10 flex items-center diff-file-surface">
        <DiffFileHeader path={file.path} previousPath={file.previousPath} status={file.status}
          additions={file.additions} deletions={file.deletions} expanded={expanded} onToggle={() => setExpanded(!expanded)}
          commentCount={threads.reduce((count, thread) => count + thread.comments.length, 0)} />
      </div>
      {/* grid-rows 1fr↔0fr — the codebase's smooth-collapse pattern
          (context-chips, activity-section). Content stays mounted so
          re-expanding animates instead of re-rendering the diff. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out  ${
          expanded ? "grid-rows-[1fr] pb-1" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <PatchDiff<AnnotationMeta>
            patch={file.patch}
            style={DIFF_TYPOGRAPHY_STYLE}
            options={{ ...patchDiffOptions(isDarkMode), enableGutterUtility: true }}
            lineAnnotations={lineAnnotations}
            renderAnnotation={lineAnnotations ? renderAnnotation : undefined}
            /* The library forbids combining onGutterUtilityClick with a
               custom renderGutterUtility node — the node handles its own
               clicks and reads the line via getHoveredLine. */
            renderGutterUtility={(getHoveredLine) => (
              <Button
                title="Add a comment"
                onClick={() => {
                  const hovered = getHoveredLine();
                  if (!hovered) return;
                  setComposer({
                    line: hovered.lineNumber,
                    side: hovered.side === "deletions" ? "left" : "right",
                  });
                }}
                className="flex items-center justify-center w-4 h-4 rounded bg-accent text-accent-foreground text-xs font-semibold leading-none cursor-pointer select-none"
              >
                +
              </Button>
            )}
          />
        </div>
      </div>
    </section>
  );
}

export function PrDiffView({ prRef }: { prRef: PrRefInput }) {
  const { data, isLoading, isError, refetch } = useGetPrDiffQuery(prRef, {
    refetchOnMountOrArgChange: true,
    pollingInterval: 30_000,
    skipPollingIfUnfocused: true,
  });
  // Cache-shared with the Summary tab — review threads anchor the inline
  // comment cards. Resolved threads stay out of the diff (they live in
  // the Summary's review-threads section).
  const { data: detail } = useGetPrDetailQuery(prRef);

  // Don't hand PatchDiff a patch until the highlighter is live — it won't
  // repaint on its own once the highlighter finishes loading.
  const highlighterReady = useDiffHighlighterReady();

  const files = useMemo(
    () => (data ? splitDiffByFile(data.diffText) : []),
    [data],
  );

  const threadsByPath = useMemo(() => {
    const map = new Map<string, PrReviewThread[]>();
    for (const thread of detail?.reviewThreads ?? []) {
      if (!thread.path || thread.isResolved) continue;
      const list = map.get(thread.path) ?? [];
      list.push(thread);
      map.set(thread.path, list);
    }
    return map;
  }, [detail?.reviewThreads]);

  if (isLoading || (!highlighterReady && !isError)) {
    return (
      <div className="flex items-center justify-center py-10">
        <Text as="span" size="xs" tone="inherit" className="shine-text">
          Loading diff...
        </Text>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-2 py-10">
        <Body size="xs" tone="secondary">
          Unable to load the diff.
        </Body>
        <Button variant="subtle" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10">
        <Body size="xs" tone="secondary">
          {data?.truncated
            ? "GitHub could not provide a preview of this large diff."
            : "No changes in this pull request."}
        </Body>
        {data?.truncated && (
          <Button
            variant="subtle"
            onClick={() => window.api.shell.openExternal(
              `https://github.com/${prRef.owner}/${prRef.repo}/pull/${prRef.number}/files`,
            )}
          >
            Open on GitHub
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      {data?.truncated && (
        <Text
          as="div"
          size="xs"
          tone="warning"
          className="mx-4 my-3 px-3 py-3 rounded-xl bg-warning/10"
        >
          This diff is large — only the available files and patches are shown.
          Open the pull request on GitHub for the full diff.
        </Text>
      )}
      {files.map((file) => (
        <FileSection
          key={file.path}
          file={file}
          threads={threadsByPath.get(file.path) ?? []}
        />
      ))}
    </div>
  );
}
