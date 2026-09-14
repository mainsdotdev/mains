import { useCallback, useMemo, useState } from "react";
import { PatchDiff, type DiffLineAnnotation } from "@pierre/diffs/react";
import {
  useGetPrDetailQuery,
  useGetPrDiffQuery,
  useAddPrReviewCommentMutation,
  useReplyToPrThreadMutation,
  useResolvePrThreadMutation,
  type PrComment,
  type PrRefInput,
  type PrReviewThread,
} from "@/lib/redux/api";
import { useIsDarkMode } from "@/hooks/use-is-dark-mode";
import {
  Body,
  Button,
  SendButton,
  Text,
  Textarea,
  toast,
} from "@/components/ui";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { ArrowUp } from "@/components/ui/icons";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import { formatDate } from "@/lib/format-date";
import { DIFF_TYPOGRAPHY_STYLE, patchDiffOptions } from "@/lib/diff-style";
import { useDiffHighlighterReady } from "@/lib/diff-highlighter";

interface FileDiff {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
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
    if (!headerMatch) continue;
    const path = headerMatch[2];

    let additions = 0;
    let deletions = 0;
    for (const line of section.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }

    files.push({ path, additions, deletions, patch: section });
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
  prRef,
}: {
  thread: PrReviewThread;
  prRef: PrRefInput;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [resolveThread, { isLoading: isResolving }] = useResolvePrThreadMutation();
  const [replyToThread, { isLoading: isReplying }] = useReplyToPrThreadMutation();

  const handleResolve = async () => {
    try {
      await resolveThread({ ...prRef, threadId: thread.id, resolved: true }).unwrap();
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to resolve review thread"));
    }
  };

  const handleReply = async () => {
    const body = replyText.trim();
    if (!body) return;
    try {
      await replyToThread({ ...prRef, threadId: thread.id, body }).unwrap();
      setReplyText("");
      setReplyOpen(false);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to post reply"));
    }
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
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleReply();
                } else if (e.key === "Escape") {
                  setReplyOpen(false);
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
                disabled={!replyText.trim()}
              />
            </div>
          </div>
          <Button
            onClick={() => setReplyOpen(false)}
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
              disabled={isResolving}
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
  prRef,
  path,
  target,
  onClose,
}: {
  prRef: PrRefInput;
  path: string;
  target: ComposerTarget;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [addReviewComment, { isLoading }] = useAddPrReviewCommentMutation();

  const handleSubmit = async () => {
    const body = text.trim();
    if (!body) return;
    try {
      await addReviewComment({
        ...prRef,
        path,
        line: target.line,
        side: target.side,
        body,
      }).unwrap();
      toast.success("Comment posted");
      onClose();
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to post comment"));
    }
  };

  return (
    <div className="rounded-xl bg-primary/40 dark:bg-primary/5 glass-outline px-3 py-2.5">
      <div className="relative">
        <Textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
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
            disabled={!text.trim()}
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
  prRef,
  threads,
}: {
  file: FileDiff;
  prRef: PrRefInput;
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
            <InlineThreadCard key={thread.id} thread={thread} prRef={prRef} />
          ))}
          {showComposer && (
            <InlineCommentComposer
              prRef={prRef}
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
    [prRef, file.path, closeComposer],
  );

  return (
    <div className="rounded-xl overflow-hidden glass-outline">
      <Button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 dark:bg-primary/5 bg-primary-50 cursor-pointer"
      >
        <Text
          as="span"
          size="xs"
          weight="medium"
          className="truncate"
          tone="secondary"
        >
          {file.path}
        </Text>
        <Text
          as="span"
          size="xxs"
          tone="inherit"
          className="ml-auto tabular-nums whitespace-nowrap shrink-0"
        >
          <Text as="span" size="inherit" tone="success">
            +{file.additions}
          </Text>{" "}
          <Text as="span" size="inherit" tone="danger">
            -{file.deletions}
          </Text>
        </Text>
        <ArrowUp
          className={`w-3 h-3 text-primary-600 dark:text-primary-400 transition-transform ${
            expanded ? "rotate-180" : "rotate-90"
          }`}
        />
      </Button>
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
                className="flex items-center justify-center w-4 h-4 rounded bg-accent text-white text-xs font-semibold leading-none cursor-pointer select-none"
              >
                +
              </Button>
            )}
          />
        </div>
      </div>
    </div>
  );
}

export function PrDiffView({ prRef }: { prRef: PrRefInput }) {
  const { data, isLoading, isError, refetch } = useGetPrDiffQuery(prRef);
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
      <div className="flex items-center justify-center py-10">
        <Body size="xs" tone="secondary">
          No changes in this pull request.
        </Body>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data?.truncated && (
        <Text
          as="div"
          size="xs"
          tone="warning"
          className="px-3 py-3 rounded-xl bg-warning/10"
        >
          This diff is large — only the first files are shown. Open the pull
          request on GitHub for the full diff.
        </Text>
      )}
      {files.map((file) => (
        <FileSection
          key={file.path}
          file={file}
          prRef={prRef}
          threads={threadsByPath.get(file.path) ?? []}
        />
      ))}
    </div>
  );
}
