import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownComponents } from "@/components/markdown-components";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import {
  useGetPrDetailQuery, useGetPrAvailabilityQuery, useMergePrMutation,
  useMarkPrReadyMutation, useAddPrCommentMutation, useResolvePrThreadMutation,
  pullRequestsApi, pullRequestDetailTag,
  type PrComment, type PrMergeMethod, type PrRefInput, type PullRequestSummary,
} from "@/lib/redux/api/pullRequestsApi";
import {
  Body, Button, DropdownWrapper, getSegmentedTabId, Heading3,
  SegmentedTabs, SendButton, Text, Textarea, toast,
} from "@/components/ui";
import { Branch, ArrowUp, Check, External, Link, PullRequest, Refresh } from "@/components/ui/icons";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { useClickOutside } from "@/hooks/use-click-outside";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import { formatDate } from "@/lib/format-date";
import { warmDiffHighlighter } from "@/lib/diff-highlighter";
import { useAppDispatch } from "@/lib/redux/hooks";
import { canonicalPrRef, githubPullRequestUrl, pullRequestKey } from "../lib/pull-request-link";
import { PrDiffView } from "./pr-diff-view";

const MERGE_METHODS: { value: PrMergeMethod; label: string }[] = [
  { value: "merge", label: "Merge" },
  { value: "squash", label: "Squash and merge" },
  { value: "rebase", label: "Rebase and merge" },
];
const CHECK_DOT: Record<string, string> = {
  passing: "bg-success", failing: "bg-danger", pending: "bg-warning", none: "bg-primary-400",
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

/** Heading over the review threads and activity sections. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Body size="sm" weight="medium" className="mb-3">
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

function CommentCard({ comment }: { comment: PrComment }) {
  return (
    <div className="rounded-2xl border border-primary-200/60 dark:border-primary-800/70 px-4 py-3">
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


export interface PullRequestViewProps {
  prRef: PrRefInput;
  initialPr?: PullRequestSummary;
  url?: string;
  /** Inactive preview tabs retain their drafts without polling or mounting diffs. */
  active?: boolean;
}

export function PullRequestView(props: PullRequestViewProps) {
  return <PullRequestContent key={pullRequestKey(props.prRef)} {...props} />;
}

function PullRequestContent({ prRef, initialPr, url: suppliedUrl, active = true }: PullRequestViewProps) {
  const ref = canonicalPrRef(prRef);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const id = useId();
  const tabsId = id + "-tabs";
  const panelId = id + "-panel";
  const {
    currentData: detail, isFetching, isError,
  } = useGetPrDetailQuery(ref, {
    skip: !active,
    refetchOnMountOrArgChange: true,
    pollingInterval: active ? 30_000 : 0,
    skipPollingIfUnfocused: true,
  });
  const { currentData: availability } = useGetPrAvailabilityQuery(ref.provider, {
    skip: !active || !isError,
  });
  const current = detail ?? initialPr;
  const url = detail?.url ?? suppliedUrl ?? initialPr?.url ?? githubPullRequestUrl(ref);
  const needsConnection = availability?.connected === false;
  const [tab, setTab] = useState<"summary" | "changes">("summary");
  const [mergeMethod, setMergeMethod] = useState<PrMergeMethod>("merge");
  const [mergeMenuOpen, setMergeMenuOpen] = useState(false);
  const mergeMenuRef = useRef<HTMLDivElement>(null);
  const [commentText, setCommentText] = useState("");
  const { copy, isCopied } = useCopyToClipboard({
    onError: () => toast.error("Unable to copy the pull request link"),
  });
  useClickOutside(mergeMenuRef, () => setMergeMenuOpen(false));
  useEffect(() => { if (active) void warmDiffHighlighter(); }, [active]);

  const [mergePr, { isLoading: isMerging }] = useMergePrMutation();
  const [markReady, { isLoading: isMarkingReady }] = useMarkPrReadyMutation();
  const [addComment, { isLoading: isCommenting }] = useAddPrCommentMutation();
  const [resolveThread] = useResolvePrThreadMutation();

  const refresh = () => {
    dispatch(pullRequestsApi.util.invalidateTags([pullRequestDetailTag(ref)]));
  };

  const handleMerge = async () => {
    if (!canMerge || isMerging) return;
    try {
      await mergePr({ ...ref, method: mergeMethod }).unwrap();
      toast.success("Merged #" + ref.number);
    } catch (err) { toast.error(extractErrorMessage(err, "Failed to merge pull request")); }
  };
  const handleMarkReady = async () => {
    if (!detail?.viewerCanUpdate || isMarkingReady || isError) return;
    try {
      await markReady({ ...ref, nodeId: detail.nodeId }).unwrap();
      toast.success("Marked as ready for review");
    } catch (err) { toast.error(extractErrorMessage(err, "Failed to mark as ready")); }
  };
  const handleComment = async () => {
    const body = commentText.trim();
    if (!body || !detail || isCommenting || isError) return;
    try {
      await addComment({ ...ref, body }).unwrap();
      setCommentText("");
      toast.success("Comment posted");
    } catch (err) { toast.error(extractErrorMessage(err, "Failed to post comment")); }
  };
  const handleResolveThread = async (threadId: string, resolved: boolean) => {
    try { await resolveThread({ ...ref, threadId, resolved }).unwrap(); }
    catch (err) { toast.error(extractErrorMessage(err, "Failed to update review thread")); }
  };

  const isDraft = current?.isDraft && current.state === "open";
  const stateLabel = isDraft ? "Draft" : current?.state;
  const stateTone = isDraft ? "text-primary-500" : current?.state === "open" ? "text-success"
    : current?.state === "closed" ? "text-danger" : "text-accent";
  const hasConflicts = detail?.mergeable === "CONFLICTING";
  const canMerge = !!detail && detail.state === "open" && !detail.isDraft && !hasConflicts && !isError;
  const checkCounts = { passing: 0, failing: 0, pending: 0 };
  for (const check of detail?.checks ?? []) {
    if (check.status === "passing") checkCounts.passing++;
    else if (check.status === "failing") checkCounts.failing++;
    else checkCounts.pending++;
  }
  const checksSummary = !detail?.checks.length ? "No checks" : [
    checkCounts.passing > 0 && checkCounts.passing + " passing",
    checkCounts.failing > 0 && checkCounts.failing + " failing",
    checkCounts.pending > 0 && checkCounts.pending + " pending",
  ].filter(Boolean).join(" · ");
  const reviewers = detail?.latestReviews.map((review) => review.author).filter(Boolean) ?? [];
  const comments = [...(detail?.comments ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="flex h-full min-h-0 flex-col @container">
      <header className="shrink-0 border-b border-primary-200/60 dark:border-primary-800/60 px-5 @min-[560px]:px-8 pt-5 pb-3">
        <div className="flex items-center gap-2 text-xs">
          <Text as="span" size="xs" tone="subtle" className="truncate">{ref.owner}/{ref.repo}</Text>
          <Text as="span" size="xs" tone="subtle">#{ref.number}</Text>
          {stateLabel && <span className={"ml-auto flex shrink-0 items-center gap-1.5 capitalize " + stateTone}>
            <PullRequest className="size-3.5" />{stateLabel}
          </span>}
        </div>
        <Heading3 size="base" weight="medium" className="mt-2 wrap-break-word">
          {current?.title ?? "Pull request #" + ref.number}
        </Heading3>
        {current && <div className="mt-2 flex items-center gap-1.5 text-xs text-primary-500 dark:text-primary-400">
          <Branch className="size-3.5 shrink-0" />
          <span className="truncate" title={current.headRefName}>{current.headRefName}</span>
          <span aria-hidden>→</span>
          <span className="truncate" title={current.baseRefName}>{current.baseRefName}</span>
        </div>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <SegmentedTabs id={tabsId} value={tab} onChange={setTab}
            options={[
              { value: "summary", label: "Summary" },
              { value: "changes", label: <span className="inline-flex items-center gap-2">Changes
                {current && <span className="tabular-nums text-xxs">
                  <span className="text-success">+{current.additions.toLocaleString()}</span>{" "}
                  <span className="text-danger">−{current.deletions.toLocaleString()}</span>
                </span>}
              </span> },
            ]} panelId={panelId} aria-label="Pull request view" className="w-fit" />
          <div className="ml-auto flex items-center gap-0.5">
            <Button variant="icon" onClick={refresh} disabled={isFetching || !active}
              tooltip="Refresh pull request" aria-label="Refresh pull request">
              <Refresh className={"size-3.5" + (isFetching ? " animate-spin" : "")} />
            </Button>
            <Button variant="icon" onClick={() => { void copy(url); }} tooltip={isCopied ? "Copied" : "Copy link"} aria-label="Copy pull request link">
              {isCopied ? <Check className="size-3.5" /> : <Link className="size-3.5" />}
            </Button>
            <Button variant="icon" onClick={() => { void window.api.shell.openExternal(url); }} tooltip="Open on GitHub" aria-label="Open on GitHub">
              <External className="size-3.5" />
            </Button>
            {current?.state === "open" && (isDraft ? (
              <Button variant="secondary" disabled={!detail?.viewerCanUpdate || isMarkingReady || isError}
                onClick={handleMarkReady} className="ml-2">
                {isMarkingReady ? "Working…" : "Ready for review"}
              </Button>
            ) : (
              <div className="relative ml-2" ref={mergeMenuRef}>
                <div className="inline-flex overflow-hidden rounded-full bg-accent text-accent-foreground">
                  <Button disabled={!canMerge || isMerging} onClick={handleMerge}
                    className="px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent-foreground/10 disabled:opacity-50">
                    {isMerging ? "Merging…" : MERGE_METHODS.find((method) => method.value === mergeMethod)?.label}
                  </Button>
                  <Button disabled={!canMerge || isMerging} onClick={() => setMergeMenuOpen((open) => !open)}
                    aria-label="Choose merge method" aria-haspopup="menu" aria-expanded={mergeMenuOpen}
                    className="border-l border-accent-foreground/20 px-2 text-accent-foreground hover:bg-accent-foreground/10 disabled:opacity-50">
                    <ArrowUp className="size-3 rotate-180" />
                  </Button>
                </div>
                <DropdownWrapper isOpen={mergeMenuOpen} aria-label="Merge method" minWidth="min-w-48" position="right">
                  <div className="py-1.5">
                    {MERGE_METHODS.map((method) => (
                      <Button key={method.value} role="menuitemradio" aria-checked={mergeMethod === method.value}
                        onClick={() => { setMergeMethod(method.value); setMergeMenuOpen(false); }}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs text-primary-900 dark:text-primary-100 hover:bg-primary-200/30 dark:hover:bg-primary-800">
                        {method.label}{mergeMethod === method.value && <Check className="ml-auto size-3" />}
                      </Button>
                    ))}
                  </div>
                </DropdownWrapper>
              </div>
            ))}
          </div>
        </div>
      </header>
      <div id={panelId} role="tabpanel" aria-labelledby={getSegmentedTabId(tabsId, tab)}
        className={"min-h-0 flex-1 overflow-y-auto noscrollbar" + (tab === "summary" ? " px-5 @min-[560px]:px-8 py-5" : "")}>
        {isError && !detail ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <PullRequest className="size-6 text-primary-400" />
            <Body size="sm">{needsConnection ? "Connect GitHub to view this pull request" : "Unable to load this pull request"}</Body>
            <Body size="xs" tone="secondary">
              {needsConnection ? "Add your GitHub connection in Settings to see changes, checks and comments."
                : "Check your connection and repository access, then try again."}
            </Body>
            <div className="flex gap-2">
              {needsConnection
                ? <Button variant="secondary" onClick={() => { void navigate("/settings?section=connections"); }}>Connect GitHub</Button>
                : <Button variant="secondary" onClick={refresh}>Try again</Button>}
              <Button variant="subtle" onClick={() => { void window.api.shell.openExternal(url); }}>Open on GitHub</Button>
            </div>
          </div>
        ) : !detail ? (
          <div role="status" className="flex justify-center py-12"><Text size="xs" className="shine-text">Loading pull request…</Text></div>
        ) : (
          <>
            {isError && <Text as="p" size="xs" tone="warning" className="mb-4">Unable to refresh. Showing the last loaded pull request.</Text>}
            {tab === "changes" ? (active && <PrDiffView prRef={ref} />) : (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-primary-600 dark:text-primary-400">
                  <details className="relative">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5">
                      <span className={"size-1.5 rounded-full " + CHECK_DOT[detail.ciStatus]} />
                      {checksSummary}{detail.checks.length > 0 && <ArrowUp className="size-2.5 rotate-180" />}
                    </summary>
                    {detail.checks.length > 0 && <div className="absolute left-0 top-full z-10 mt-2 max-h-64 w-64 overflow-y-auto rounded-xl border border-primary-200 dark:border-primary-800 bg-primary dark:bg-primary-950 p-3 shadow-lg">
                      {detail.checks.map((check, index) => <div key={check.name + index} className="flex items-center gap-2 py-1">
                        <span className={"size-1.5 shrink-0 rounded-full " + CHECK_DOT[check.status]} />
                        <span className="min-w-0 flex-1 wrap-break-word">{check.name}</span>
                        <span className="sr-only">{check.status}</span>
                      </div>)}
                    </div>}
                  </details>
                  <span>{detail.reviewDecision ? detail.reviewDecision.replace(/_/g, " ").toLowerCase() : "No reviews"}
                    {reviewers.length > 0 && <span title={reviewers.join(", ")}> · {reviewers.join(", ")}</span>}
                  </span>
                  {hasConflicts && <span className="text-danger">Merge conflicts</span>}
                </div>
                <section aria-label="Pull request description" className="pb-2">
                  {detail.body.trim() ? <Markdown>{detail.body}</Markdown>
                    : <Text as="p" size="s" tone="subtle">No description provided.</Text>}
                </section>

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


                <section className="border-t border-primary-200/60 dark:border-primary-800/60 pt-6" aria-label="Activity">
                  <SectionHeading>Activity</SectionHeading>
                  <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-primary-200/60 dark:border-primary-800/70 px-4 py-3">
                    <PullRequest className="size-4 shrink-0 text-success" />
                    <Text as="span" size="s" className="min-w-0 flex-1 wrap-break-word">
                      {detail.author?.login ?? "Someone"} opened this pull request
                    </Text>
                    <Text as="span" size="xxs" tone="subtle" className="shrink-0">{formatDate(detail.createdAt)}</Text>
                  </div>
                  <div className="space-y-3">
                    {comments.map((comment) => <CommentCard key={comment.id} comment={comment} />)}
                  </div>
                </section>
              </div>
            )}
          </>
        )}
      </div>
      {tab === "summary" && detail && (
        <div className="shrink-0 border-t border-primary-200/60 dark:border-primary-800/60 px-5 @min-[560px]:px-8 py-3">
          <div className="relative">
            <Textarea aria-label="Leave a comment" value={commentText} disabled={isCommenting}
              onChange={(event) => setCommentText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void handleComment(); }
              }}
              placeholder="Leave a comment" rows={2}
              className="w-full resize-none rounded-2xl bg-primary-50/60 dark:bg-primary/3 glass-outline px-3 py-3 pr-12 text-s text-primary-900 dark:text-primary-100 placeholder:text-primary-500 outline-none focus-visible:ring-1 focus-visible:ring-accent" />
            <div className="absolute bottom-3 right-2">
              <SendButton loading={isCommenting} onSubmit={handleComment} disabled={!commentText.trim() || isError} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
