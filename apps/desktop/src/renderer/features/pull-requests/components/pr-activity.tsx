import { useId, useState } from "react";
import type { PrActivity, PrActivityFilter, PrPage } from "@mains/contracts/pull-requests";
import {
  useGetPrActivityInfiniteQuery, useGetPrCommitsInfiniteQuery, type PrRefInput, type PullRequestDetail,
} from "@/lib/redux/api/pullRequestsApi";
import { Body, Button, Select, Text } from "@/components/ui";
import { ArrowUp, Commit, External, Filter, PullRequest } from "@/components/ui/icons";
import { formatDate } from "@/lib/format-date";
import { Avatar, Markdown } from "./pr-content";

function chronological<T>(pages: PrPage<T>[] | undefined, key: (item: T) => string): T[] {
  const latest = new Map<string, T>();
  for (const page of pages ?? []) for (const item of page.items) {
    if (!latest.has(key(item))) latest.set(key(item), item);
  }
  const ordered: T[] = [];
  for (const page of [...(pages ?? [])].reverse()) for (const item of page.items) {
    const value = latest.get(key(item));
    if (value) { ordered.push(value); latest.delete(key(item)); }
  }
  return ordered;
}

function Time({ value }: { value: string }) {
  return <time dateTime={value} title={new Date(value).toLocaleString()}
    className="shrink-0 text-xxs text-primary-500">{formatDate(value)}</time>;
}

function PageError({ children, retry }: { children: string; retry: () => unknown }) {
  return <div role="status" className="flex items-center justify-between gap-3 px-4 py-3">
    <Text size="xs" tone="warning">{children}</Text>
    <Button variant="subtle" onClick={() => { void retry(); }}>Try again</Button>
  </div>;
}

function Commits({ prRef, count, active }: { prRef: PrRefInput; count: number; active: boolean }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const query = useGetPrCommitsInfiniteQuery(prRef, {
    skip: !active || !expanded, refetchOnMountOrArgChange: true,
    pollingInterval: active && expanded ? 30_000 : 0, skipPollingIfUnfocused: true,
  });
  const commits = chronological(query.currentData?.pages, (commit) => commit.oid);
  const total = query.currentData?.pages[0]?.totalCount ?? count;
  return <div className="overflow-hidden rounded-2xl border border-primary-200/60 dark:border-primary-800/70">
    <Button variant="bare" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-primary-200/20 dark:hover:bg-primary/3">
      <Commit className="size-4 shrink-0 text-primary-500" />
      <Text size="s" className="flex-1">{total.toLocaleString()} {total === 1 ? "commit" : "commits"}</Text>
      <ArrowUp className={"size-3 text-primary-500 " + (expanded ? "" : "rotate-180")} />
    </Button>
    {expanded && <div id={id} className="border-t border-primary-200/60 dark:border-primary-800/60">
      {query.hasNextPage && <Button variant="subtle" disabled={query.isFetching} className="m-2 text-xs"
        onClick={() => { void query.fetchNextPage(); }}>{query.isFetchingNextPage ? "Loading…" : "Load older commits"}</Button>}
      {query.isError && <PageError retry={() => query.direction === "forward" && query.currentData ? query.fetchNextPage() : query.refetch()}>Unable to load commits.</PageError>}
      {query.isLoading && <Text as="p" size="xs" tone="subtle" className="px-4 py-3" role="status">Loading commits…</Text>}
      {commits.map((commit) => <div key={commit.oid} className="flex items-start gap-3 border-b border-primary-200/40 px-4 py-3 last:border-b-0 dark:border-primary-800/40">
        <Avatar author={commit.author} />
        <div className="min-w-0 flex-1">
          <Button variant="bare" onClick={() => { void window.api.shell.openExternal(commit.url); }}
            className="block text-left text-s text-primary-900 hover:text-accent dark:text-primary-100 wrap-break-word">{commit.message}</Button>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-primary-500">
            <span>{commit.author?.login ?? commit.authorName ?? "Unknown author"}</span>
            <Time value={commit.committedAt} />
          </div>
        </div>
        <Button variant="subtle" className="shrink-0 font-mono text-xxs text-primary-500" aria-label={`Open commit ${commit.oid.slice(0, 7)}`}
          onClick={() => { void window.api.shell.openExternal(commit.url); }}>{commit.oid.slice(0, 7)}</Button>
      </div>)}
      {!query.isLoading && !query.isError && query.currentData && commits.length === 0 && <Text as="p" size="xs" tone="subtle" className="px-4 py-3">No commits available.</Text>}
    </div>}
  </div>;
}

function activityLabel(item: PrActivity): string {
  switch (item.kind) {
    case "comment": return "commented";
    case "review": return item.reviewState === "APPROVED" ? "approved these changes"
      : item.reviewState === "CHANGES_REQUESTED" ? "requested changes"
      : item.reviewState === "DISMISSED" ? "left a review that was dismissed" : "reviewed these changes";
    case "closed": return "closed this pull request";
    case "reopened": return "reopened this pull request";
    case "merged": return "merged this pull request";
    case "review_requested": return `requested a review${item.reviewer ? " from " + item.reviewer : ""}`;
    case "review_request_removed": return `removed a review request${item.reviewer ? " for " + item.reviewer : ""}`;
    case "ready": return "marked this pull request ready for review";
    case "draft": return "converted this pull request to a draft";
    case "force_pushed": return `force-pushed the branch${item.commitOid ? " to " + item.commitOid.slice(0, 7) : ""}`;
  }
}

function ActivityCard({ item }: { item: PrActivity }) {
  return <article className="rounded-2xl border border-primary-200/60 px-4 py-3 dark:border-primary-800/70">
    <div className="flex items-center gap-2">
      <Avatar author={item.author} />
      <Text as="span" size="xs" className="min-w-0 flex-1 wrap-break-word">
        <span className="font-medium">{item.author?.login ?? "Someone"}</span>{" "}
        <span className="text-primary-500">{activityLabel(item)}</span>
      </Text>
      <Time value={item.createdAt} />
      {item.url && <Button variant="icon" iconSize="sm" aria-label="Open activity on GitHub"
        onClick={() => { void window.api.shell.openExternal(item.url!); }}><External className="size-3" /></Button>}
    </div>
    {item.body?.trim() && <div className="mt-3"><Markdown>{item.body}</Markdown></div>}
  </article>;
}

export function PrActivitySection({ prRef, detail, active }: { prRef: PrRefInput; detail: PullRequestDetail; active: boolean }) {
  const [filter, setFilter] = useState<PrActivityFilter>("all");
  const query = useGetPrActivityInfiniteQuery({ ...prRef, filter }, {
    skip: !active, refetchOnMountOrArgChange: true,
    pollingInterval: active ? 30_000 : 0, skipPollingIfUnfocused: true,
  });
  const items = chronological(query.currentData?.pages, (item) => item.id);
  const showOpening = (filter === "all" || filter === "events") && query.currentData && !query.hasNextPage;
  return <section className="border-t border-primary-200/60 pt-6 dark:border-primary-800/60" aria-label="Activity">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <Body size="sm" weight="medium">Activity</Body>
      <Select<PrActivityFilter> value={filter} onChange={setFilter} size="sm" searchable={false} aria-label="Filter activity"
        options={[
          { value: "all", label: "All activity", selectedIcon: <Filter className="size-3" /> },
          { value: "comments", label: "Comments" }, { value: "reviews", label: "Reviews" }, { value: "events", label: "Events" },
        ]} />
    </div>
    <div className="space-y-3">
      {filter === "all" && <Commits prRef={prRef} count={detail.commitCount} active={active} />}
      {query.hasNextPage && <Button variant="subtle" disabled={query.isFetching}
        onClick={() => { void query.fetchNextPage(); }}>{query.isFetchingNextPage ? "Loading…" : "Load older activity"}</Button>}
      {query.isLoading && <Text as="p" size="xs" tone="subtle" role="status">Loading activity…</Text>}
      {query.isError && <PageError retry={() => query.direction === "forward" && query.currentData ? query.fetchNextPage() : query.refetch()}>Unable to load activity.</PageError>}
      {showOpening && <div className="flex items-center gap-3 rounded-2xl border border-primary-200/60 px-4 py-3 dark:border-primary-800/70">
        <PullRequest className="size-4 shrink-0 text-success" />
        <Text as="span" size="s" className="min-w-0 flex-1 wrap-break-word">{detail.author?.login ?? "Someone"} opened this pull request</Text>
        <Time value={detail.createdAt} />
      </div>}
      {items.map((item) => <ActivityCard key={item.id} item={item} />)}
      {query.currentData && !query.isError && !query.hasNextPage && items.length === 0 && !showOpening && <Text as="p" size="xs" tone="subtle">No {filter === "all" ? "activity" : filter} yet.</Text>}
    </div>
  </section>;
}
