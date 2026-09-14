import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownComponents } from "@/components/markdown-components";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import {
  useGetPrDetailQuery,
  useMergePrMutation,
  useMarkPrReadyMutation,
  useAddPrCommentMutation,
  useResolvePrThreadMutation,
  type PrComment,
  type PrMergeMethod,
  type PullRequestSummary,
} from "@/lib/redux/api";
import {
  Body,
  Button,
  DropdownWrapper,
  getSegmentedTabId,
  Heading3,
  SegmentedTabs,
  SendButton,
  Text,
  Textarea,
  toast,
} from "@/components/ui";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { useClickOutside } from "@/hooks/use-click-outside";
import {
  Branch,
  Chat,
  ArrowUp,
  Check,
  Clock,
  External,
  PullRequest,
  Personalize,
} from "@/components/ui/icons";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import { formatDate } from "@/lib/format-date";
import { FilterLabel } from "./filter-section";
import { PrDiffView } from "./pr-diff-view";
import { warmDiffHighlighter } from "@/lib/diff-highlighter";

const DETAIL_TABS: { value: "summary" | "code"; label: string }[] = [
  { value: "summary", label: "Summary" },
  { value: "code", label: "Code" },
];

const MERGE_METHODS: { value: PrMergeMethod; label: string }[] = [
  { value: "merge", label: "Merge" },
  { value: "squash", label: "Squash and merge" },
  { value: "rebase", label: "Rebase and merge" },
];

const STATE_BADGE: Record<string, string> = {
  open: "bg-primary-100 dark:bg-success/30 text-success",
  merged:
    "bg-primary-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400",
  closed: "bg-primary-100 dark:bg-danger/30 text-danger",
};

/**
 * A draft is technically open, but nothing is being asked of the reader yet —
 * so it reads neutral rather than green. Same greys the list row uses for its
 * draft icon (`pr-list-item.tsx`).
 */
const DRAFT_BADGE =
  "bg-primary-100 dark:bg-primary/10 text-primary-600 dark:text-primary-400";

const CHECK_DOT: Record<string, string> = {
  passing: "bg-success",
  failing: "bg-danger",
  pending: "bg-warning",
  none: "bg-primary-400",
};

function Avatar({ author }: { author: PrComment["author"] }) {
  const src = proxiedImageSrc(author?.avatarUrl);
  if (!src) {
    return (
      <span className="size-6 rounded-full bg-primary/30 dark:bg-primary/10 shrink-0" />
    );
  }
  return (
    <img
      src={src}
      alt={author?.login ?? ""}
      className="size-6 rounded-full shrink-0"
    />
  );
}

/** Heading over one block of the detail body (Description / Threads / Comments). */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Body size="xs" tone="muted" weight="medium" className="mb-1.5">
      {children}
    </Body>
  );
}

function Markdown({ children }: { children: string }) {
  return (
    <Text
      as="div"
      size="s"
      tone="secondary"
      className="prose prose-sm dark:prose-invert max-w-none wrap-break-word"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
        components={markdownComponents}
      >
        {children}
      </ReactMarkdown>
    </Text>
  );
}

function MetaRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="shrink-0 mt-0.5 w-4 flex items-center justify-center text-primary-600 dark:text-primary-400">
        {icon}
      </span>
      <Text as="span" size="s" tone="subtle" className="shrink-0 w-24">
        {label}
      </Text>
      <Text as="span" size="s" className="min-w-0">
        {children}
      </Text>
    </div>
  );
}

function CommentCard({ comment }: { comment: PrComment }) {
  return (
    <div className="rounded-2xl bg-primary/30 dark:bg-primary/2 glass-outline px-3 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <Avatar author={comment.author} />
        <Text as="span" size="s" weight="medium">
          {comment.author?.login ?? "unknown"}
        </Text>
        <Text as="span" size="xs" tone="subtle" className="ml-auto">
          {formatDate(comment.createdAt)}
        </Text>
      </div>
      <Markdown>{comment.body}</Markdown>
    </div>
  );
}

interface PrDetailProps {
  pr: PullRequestSummary;
}

export function PrDetail({ pr }: PrDetailProps) {
  const ref = { owner: pr.repo.owner, repo: pr.repo.repo, number: pr.number };

  const {
    data: detail,
    isLoading,
    isError,
    refetch,
  } = useGetPrDetailQuery(ref);

  const [tab, setTab] = useState<"summary" | "code">("summary");
  const [mergeMethod, setMergeMethod] = useState<PrMergeMethod>("merge");
  const [commentText, setCommentText] = useState("");
  const [checksOpen, setChecksOpen] = useState(false);
  const checksDropdownRef = useRef<HTMLDivElement>(null);
  const [mergeMenuOpen, setMergeMenuOpen] = useState(false);
  const mergeMenuRef = useRef<HTMLDivElement>(null);

  useClickOutside(checksDropdownRef, () => {
    if (checksOpen) setChecksOpen(false);
  });

  useClickOutside(mergeMenuRef, () => {
    if (mergeMenuOpen) setMergeMenuOpen(false);
  });

  // Warm the diff highlighter while the user is still on Summary, so the
  // Code tab's first paint doesn't wait on shiki loading.
  useEffect(() => {
    void warmDiffHighlighter();
  }, []);

  const [mergePr, { isLoading: isMerging }] = useMergePrMutation();
  const [markReady, { isLoading: isMarkingReady }] = useMarkPrReadyMutation();
  const [addComment, { isLoading: isCommenting }] = useAddPrCommentMutation();
  const [resolveThread] = useResolvePrThreadMutation();

  const handleMerge = async () => {
    try {
      await mergePr({ ...ref, method: mergeMethod }).unwrap();
      toast.success(`Merged #${pr.number}`);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to merge pull request"));
    }
  };

  const handleMarkReady = async () => {
    try {
      await markReady({ ...ref, nodeId: pr.nodeId }).unwrap();
      toast.success("Marked as ready for review");
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to mark as ready"));
    }
  };

  const handleComment = async () => {
    const body = commentText.trim();
    if (!body) return;
    try {
      await addComment({ ...ref, body }).unwrap();
      setCommentText("");
      toast.success("Comment posted");
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to post comment"));
    }
  };

  const handleResolveThread = async (threadId: string, resolved: boolean) => {
    try {
      await resolveThread({ ...ref, threadId, resolved }).unwrap();
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to update review thread"));
    }
  };

  const current = detail ?? pr;
  const isDraft = current.isDraft && current.state === "open";
  const stateBadge = isDraft
    ? DRAFT_BADGE
    : (STATE_BADGE[current.state] ?? STATE_BADGE.open);
  const canMerge = current.state === "open" && !current.isDraft;

  const statusText =
    current.state === "merged"
      ? "Merged"
      : current.state === "closed"
        ? "Closed"
        : current.isDraft
          ? "Draft"
          : "Ready for review";

  const reviewers =
    detail?.latestReviews
      .map((review) => review.author)
      .filter((login): login is string => Boolean(login)) ?? [];

  const commentCount = detail
    ? detail.comments.length +
      detail.reviewThreads.reduce((sum, t) => sum + t.comments.length, 0)
    : 0;

  const checkCounts = { passing: 0, failing: 0, pending: 0 };
  for (const check of detail?.checks ?? []) {
    if (check.status === "passing") checkCounts.passing++;
    else if (check.status === "failing") checkCounts.failing++;
    else checkCounts.pending++;
  }
  const checksSummary =
    (detail?.checks.length ?? 0) === 0
      ? "No CI checks"
      : [
          checkCounts.passing > 0 && `${checkCounts.passing} passing`,
          checkCounts.failing > 0 && `${checkCounts.failing} failing`,
          checkCounts.pending > 0 && `${checkCounts.pending} pending`,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-8 pt-3 pb-2 border-b border-primary/20 dark:border-primary/10">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Body tone="subtle" className="truncate">
                {pr.repo.owner}/{pr.repo.repo}
              </Body>

              <span
                className={`inline-flex capitalize items-center px-2 py-0.5 rounded-full text-xxs font-medium ${stateBadge}`}
              >
                {isDraft ? "Draft" : current.state}
              </span>
            </div>
            <Heading3
              size="base"
              weight="medium"
              className="mt-1 wrap-break-word"
            >
              {current.title}{" "}
              <Text as="span" size="inherit" tone="subtle" weight="normal">
                #{pr.number}
              </Text>
            </Heading3>
          </div>
          <Button
            onClick={() => window.api.shell.openExternal(pr.url)}
            tooltip="Open on GitHub"
            className="shrink-0 p-1.5 rounded-lg hover:bg-primary/20 dark:hover:bg-primary/10"
          >
            <External className="w-3.5 h-3.5 text-primary-700 dark:text-primary-300" />
          </Button>
        </div>

        {/* Actions */}
        {current.state === "open" && (
          <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
            {current.isDraft ? (
              <Button
                variant="secondary"
                disabled={isMarkingReady}
                onClick={handleMarkReady}
              >
                {isMarkingReady ? "Working..." : "Ready for review"}
              </Button>
            ) : (
              /* GitHub-style split button: the left half runs the selected
                 merge method, the right chevron picks one. */
              <div className="relative" ref={mergeMenuRef}>
                <div className="inline-flex items-stretch glass-outline rounded-xl">
                  <Button
                    variant="ghost"
                    disabled={!canMerge || isMerging}
                    onClick={handleMerge}
                    className="rounded-r-none  bg-accent hover:bg-[#2868f1]! text-primary!"
                  >
                    {isMerging
                      ? "Merging..."
                      : MERGE_METHODS.find((m) => m.value === mergeMethod)
                          ?.label}
                  </Button>
                  {/* Divider lives outside the buttons — a border-l on the
                      glass button skews its 0.5px rim border and the halves
                      fall out of alignment. */}
                  <span
                    aria-hidden
                    className="w-px self-stretch bg-primary/60"
                  />

                  <Button
                    variant="ghost"
                    disabled={!canMerge || isMerging}
                    onClick={() => setMergeMenuOpen((open) => !open)}
                    aria-label="Choose merge method"
                    aria-haspopup="menu"
                    aria-expanded={mergeMenuOpen}
                    className="rounded-l-none px-2 bg-accent  hover:bg-[#2868f1]! text-primary!"
                  >
                    <ArrowUp
                      className={`size-3.5 transition-transform rotate-180 text-primary`}
                    />
                  </Button>
                </div>
                <DropdownWrapper
                  isOpen={mergeMenuOpen}
                  aria-label="Merge method"
                  minWidth="min-w-56"
                >
                  <div className="py-1.5">
                    {MERGE_METHODS.map((m) => (
                      <Button
                        key={m.value}
                        role="menuitemradio"
                        aria-checked={mergeMethod === m.value}
                        onClick={() => {
                          setMergeMethod(m.value);
                          setMergeMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer transition-colors hover:bg-primary-200/30 dark:hover:bg-primary-800"
                      >
                        <FilterLabel>{m.label}</FilterLabel>
                        {mergeMethod === m.value && (
                          <Check className="w-3 h-3 shrink-0 text-primary-900 dark:text-primary-100" />
                        )}
                      </Button>
                    ))}
                  </div>
                </DropdownWrapper>
              </div>
            )}
          </div>
        )}

        {/* Summary / Code tabs */}
        <SegmentedTabs
          id="pr-detail-tabs"
          value={tab}
          onChange={setTab}
          options={DETAIL_TABS}
          panelId="pr-detail-panel"
          aria-label="Pull request view"
          className="w-fit mt-4"
        />
      </div>

      {/* Body */}
      <div
        id="pr-detail-panel"
        role="tabpanel"
        aria-labelledby={getSegmentedTabId("pr-detail-tabs", tab)}
        className="flex-1 min-h-0 overflow-y-auto noscrollbar px-8 py-3 space-y-4"
      >
        {tab === "code" ? (
          <PrDiffView prRef={ref} />
        ) : isLoading && !detail ? (
          <div className="flex items-center justify-center py-8">
            <Text as="span" size="xs" tone="inherit" className="shine-text">
              Loading pull request...
            </Text>
          </div>
        ) : isError && !detail ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <Body size="xs" tone="secondary">
              Unable to load this pull request.
            </Body>
            <Button variant="subtle" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : detail ? (
          <>
            {/* Metadata */}
            <div className="space-y-2.5">
              <MetaRow icon={<Branch className="w-4 h-4" />} label="Branch">
                <span className="break-all">{current.headRefName}</span>
                <Text as="span" size="inherit" tone="subtle" className="mx-1.5">
                  →
                </Text>
                <span>{current.baseRefName}</span>{" "}
                <Text as="span" size="inherit" tone="success" className="tabular-nums">
                  +{current.additions.toLocaleString()}
                </Text>{" "}
                <Text as="span" size="inherit" tone="danger" className="tabular-nums">
                  -{current.deletions.toLocaleString()}
                </Text>
              </MetaRow>
              <MetaRow
                icon={<Personalize className="w-4 h-4" />}
                label="Reviewers"
              >
                {reviewers.length > 0 ? reviewers.join(", ") : "No reviewers"}
                {detail.reviewDecision && (
                  <Text as="span" size="inherit" tone="subtle" className="capitalize">
                    {" · "}
                    {detail.reviewDecision.replace(/_/g, " ").toLowerCase()}
                  </Text>
                )}
              </MetaRow>
              <MetaRow icon={<Chat className="w-4 h-4" />} label="Comments">
                {commentCount > 0
                  ? `${commentCount} comment${commentCount === 1 ? "" : "s"}`
                  : "No comments"}
              </MetaRow>
              <MetaRow icon={<Clock className="w-4 h-4" />} label="Checks">
                {detail.checks.length === 0 ? (
                  checksSummary
                ) : (
                  <div className="relative" ref={checksDropdownRef}>
                    <Button
                      onClick={() => setChecksOpen((open) => !open)}
                      aria-expanded={checksOpen}
                      className="flex items-center gap-1 cursor-pointer text-s text-primary-900 dark:text-primary-100 hover:text-primary-700 dark:hover:text-primary-300"
                    >
                      {checksSummary}
                      <ArrowUp
                        className={`w-3 h-3 transition-transform rotate-180 `}
                      />
                    </Button>
                    <DropdownWrapper
                      isOpen={checksOpen}
                      role="region"
                      aria-label="CI checks"
                      minWidth="min-w-56"
                    >
                      <div className="py-2 px-3 space-y-1.5">
                        {detail.checks.map((check, i) => (
                          <div
                            key={`${check.name}-${i}`}
                            className="flex items-center gap-2"
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${CHECK_DOT[check.status]}`}
                            />
                            <Text
                              as="span"
                              size="xs"
                              tone="secondary"
                              className="truncate"
                            >
                              {check.name}
                            </Text>
                          </div>
                        ))}
                      </div>
                    </DropdownWrapper>
                  </div>
                )}
              </MetaRow>
              <MetaRow
                icon={<PullRequest className="w-4 h-4" />}
                label="Status"
              >
                {statusText}
              </MetaRow>
            </div>

            {/* Description */}
            <div>
              <SectionHeading>
                Description
              </SectionHeading>
              {detail.body.trim() ? (
                <Markdown>{detail.body}</Markdown>
              ) : (
                <Text as="span" size="xs" tone="subtle">
                  No description provided
                </Text>
              )}
            </div>

            {/* Review threads */}
            {detail.reviewThreads.length > 0 && (
              <div>
                <SectionHeading>
                  Review threads
                </SectionHeading>
                <div className="space-y-3">
                  {detail.reviewThreads.map((thread) => (
                    <div
                      key={thread.id}
                      className={`rounded-3xl px-4 py-3 glass-outline ${
                        thread.isResolved
                          ? "bg-primary/10 dark:bg-primary/3 opacity-70"
                          : "bg-primary/30 dark:bg-primary/5"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <Text as="span" size="xxs" tone="muted" className="font-mono truncate">
                          {thread.path}
                          {thread.line != null ? `:${thread.line}` : ""}
                        </Text>
                        {thread.isResolved && (
                          <Text as="span" size="xxs" tone="subtle">
                            Resolved
                          </Text>
                        )}
                        {(thread.isResolved
                          ? thread.viewerCanUnresolve
                          : thread.viewerCanResolve) && (
                          <Button
                            variant="subtle"
                            onClick={() =>
                              handleResolveThread(thread.id, !thread.isResolved)
                            }
                            className="ml-auto text-xxs px-2 py-0.5 rounded-lg hover:bg-primary/20 dark:hover:bg-primary/10 text-primary-700 dark:text-primary-300"
                          >
                            {thread.isResolved ? "Unresolve" : "Resolve"}
                          </Button>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {thread.comments.map((comment) => (
                          <div
                            key={comment.id}
                            className="flex items-start gap-2"
                          >
                            <Avatar author={comment.author} />
                            <div className="min-w-0 flex-1">
                              <Text
                                as="span"
                                size="s"
                                tone="secondary"
                                weight="medium"
                                className="mr-1.5"
                              >
                                {comment.author?.login ?? "unknown"}
                              </Text>
                              <Markdown>{comment.body}</Markdown>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Comments */}
            <div>
              <SectionHeading>
                Comments
              </SectionHeading>
              {detail.comments.length === 0 ? (
                <Text as="span" size="xs" tone="subtle">
                  No comments yet
                </Text>
              ) : (
                <div className="space-y-2">
                  {detail.comments.map((comment) => (
                    <CommentCard key={comment.id} comment={comment} />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* Comment composer */}
      <div
        className={`px-6 py-3 border-t border-primary/20 dark:border-primary/10 ${
          tab === "code" ? "hidden" : ""
        }`}
      >
        <div className="relative">
          <Textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleComment();
              }
            }}
            placeholder="Leave a comment"
            rows={3}
            className="w-full resize-none px-3 py-2 pr-12 text-s rounded-2xl bg-primary/40 dark:bg-primary/5 glass-outline placeholder:text-primary-500 dark:placeholder:text-primary-500 text-primary-900 dark:text-primary-100 outline-none"
          />
          <div className="absolute bottom-4 right-2 z-10">
            <SendButton
              loading={isCommenting}
              onSubmit={handleComment}
              disabled={!commentText.trim()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
