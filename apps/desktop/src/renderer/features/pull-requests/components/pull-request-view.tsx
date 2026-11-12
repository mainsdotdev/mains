import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useGetPrDetailQuery, useGetPrAvailabilityQuery,
  pullRequestsApi, pullRequestDetailTag,
  type PrMergeMethod, type PrRefInput, type PullRequestSummary,
} from "@/lib/redux/api/pullRequestsApi";
import {
  Body, Button, DropdownWrapper, getSegmentedTabId, Heading3,
  SegmentedTabs, SendButton, Text, Textarea, toast,
} from "@/components/ui";
import { Branch, ArrowUp, Check, External, Link, PullRequest, Refresh } from "@/components/ui/icons";
import { useClickOutside } from "@/hooks/use-click-outside";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { formatDate } from "@/lib/format-date";
import { warmDiffHighlighter } from "@/lib/diff-highlighter";
import { useAppDispatch } from "@/lib/redux/hooks";
import { onTransportChange } from "@/lib/transport";
import { canonicalPrRef, githubPullRequestUrl, pullRequestKey } from "../lib/pull-request-link";
import { PrDiffView } from "./pr-diff-view";
import { Avatar, Markdown } from "./pr-content";
import { PrActivitySection } from "./pr-activity";
import { PrChecksCard } from "./pr-checks-card";
import { PullRequestActionsContext, usePrDraft, usePullRequestActions } from "../hooks/use-pull-request-actions";

const MERGE_METHODS: { value: PrMergeMethod; label: string }[] = [
  { value: "merge", label: "Merge" },
  { value: "squash", label: "Squash and merge" },
  { value: "rebase", label: "Rebase and merge" },
];

/** Heading over the review threads and activity sections. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Body size="sm" weight="medium" className="mb-3">
      {children}
    </Body>
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
  const [backendGeneration, setBackendGeneration] = useState(0);
  useLayoutEffect(() => onTransportChange(() => setBackendGeneration((generation) => generation + 1)), []);
  return <PullRequestContent key={JSON.stringify([pullRequestKey(props.prRef), backendGeneration])} {...props} />;
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
  const comment = usePrDraft();
  const commentText = comment.text;
  const { copy, isCopied } = useCopyToClipboard({
    onError: () => toast.error("Unable to copy the pull request link"),
  });
  useClickOutside(mergeMenuRef, () => setMergeMenuOpen(false));
  useEffect(() => { if (active) void warmDiffHighlighter(); }, [active]);

  const actions = usePullRequestActions({ prRef: ref, detail, active, isError, isFetching });
  const isMerging = actions.pending?.kind === "merge";
  const isMarkingReady = actions.pending?.kind === "ready";
  const isCommenting = actions.pending?.kind === "comment";

  const refresh = () => {
    dispatch(pullRequestsApi.util.invalidateTags([pullRequestDetailTag(ref)]));
  };

  const handleMerge = () => actions.run({ kind: "merge", method: mergeMethod });
  const handleMarkReady = () => actions.run({ kind: "ready" });
  const handleComment = () => {
    const sent = comment.capture();
    return actions.run({ kind: "comment", body: sent.body }, () => { sent.acknowledge(); });
  };
  const handleResolveThread = (threadId: string, resolved: boolean) => actions.run({ kind: "resolve", threadId, resolved });

  const isDraft = current?.isDraft && current.state === "open";
  const stateLabel = isDraft ? "Draft" : current?.state;
  const stateTone = isDraft ? "text-primary-500" : current?.state === "open" ? "text-success"
    : current?.state === "closed" ? "text-danger" : "text-accent";
  const hasConflicts = detail?.mergeable === "CONFLICTING";
  const canMerge = actions.can({ kind: "merge", method: mergeMethod });

  return (
    <PullRequestActionsContext.Provider value={actions}>
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
        {current && <div className="mt-3 flex items-center gap-2 text-xs text-primary-500 dark:text-primary-400">
          <Avatar author={current.author} />
          <Text as="span" size="xs" weight="medium">{current.author?.login ?? "Unknown author"}</Text>
          <time dateTime={current.createdAt} title={new Date(current.createdAt).toLocaleString()}>{formatDate(current.createdAt)}</time>
        </div>}
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
              <Button variant="secondary" disabled={!actions.can({ kind: "ready" })}
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
              <Button variant="subtle" className="text-primary-700 dark:text-primary-300" onClick={() => { void window.api.shell.openExternal(url); }}>Open on GitHub</Button>
            </div>
          </div>
        ) : !detail ? (
          <div role="status" className="flex justify-center py-12"><Text size="xs" className="shine-text">Loading pull request…</Text></div>
        ) : (
          <>
            {isError && <Text as="p" size="xs" tone="warning" className="mb-4">Unable to refresh. Showing the last loaded pull request.</Text>}
            {tab === "changes" ? (active && <PrDiffView prRef={ref} />) : (
              <div className="space-y-6">
                <PrChecksCard detail={detail} active={active} />
                {hasConflicts && <Text as="p" size="xs" tone="danger">This pull request has merge conflicts.</Text>}
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
                            disabled={!actions.can({ kind: "resolve", threadId: thread.id, resolved: !thread.isResolved })}
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


                <PrActivitySection prRef={ref} detail={detail} active={active} />
              </div>
            )}
          </>
        )}
      </div>
      {tab === "summary" && detail && (
        <div className="shrink-0 border-t border-primary-200/60 dark:border-primary-800/60 px-5 @min-[560px]:px-8 py-3">
          <div className="relative">
            <Textarea aria-label="Leave a comment" value={commentText}
              onChange={(event) => comment.edit(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void handleComment(); }
              }}
              placeholder="Leave a comment" rows={2}
              className="w-full resize-none rounded-2xl bg-primary-50/60 dark:bg-primary/3 glass-outline px-3 py-3 pr-12 text-s text-primary-900 dark:text-primary-100 placeholder:text-primary-500 outline-none focus-visible:ring-1 focus-visible:ring-accent" />
            <div className="absolute bottom-3 right-2">
              <SendButton loading={isCommenting} onSubmit={handleComment} disabled={!actions.can({ kind: "comment", body: commentText })} />
            </div>
          </div>
        </div>
      )}
    </div>
    </PullRequestActionsContext.Provider>
  );
}
