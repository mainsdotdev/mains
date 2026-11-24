import { useEffect, useMemo, useRef, useState } from "react";
import {
  useGetPrAvailabilityQuery,
  useGetSelectedResourcesQuery,
  useSearchPullRequestsQuery,
  useLazySearchPullRequestsQuery,
  type PrLifecycle,
  type PrRelationship,
  type PrSearchPage,
  type PullRequestSummary,
} from "@/lib/redux/api";
import { Button, DropdownWrapper, Input, SegmentedTabs, toast } from "@/components/ui";
import { Close, Layers, Search, Trash } from "@/components/ui/icons";
import GitHubModal from "@/features/settings/components/connections/github/github-modal";
import { useClickOutside } from "@/hooks/use-click-outside";
import { useIsMobile } from "@/lib/platform";
import type { TasksScope } from "../lib/scope";
import {
  FilterChoiceSection,
  FilterSection,
  sortedEntries,
} from "./filter-section";
import { PrListItem } from "./pr-list-item";
import { TasksLoadError, TasksState } from "./tasks-state";

const PAGE_SIZE = 30;

const RELATIONSHIP_FILTERS: { value: PrRelationship; label: string }[] = [
  { value: "all", label: "All" },
  { value: "review_requested", label: "Review requested" },
  { value: "reviewed", label: "Reviewed" },
  { value: "authored", label: "Authored" },
];

const LIFECYCLE_FILTERS: { value: PrLifecycle; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "merged", label: "Merged" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "Any state" },
];

interface PullRequestsPanelProps {
  /** Connection / resource picked in the sidebar. */
  scope: TasksScope;
  selectedNodeId: string | null;
  /** `null` clears the drawer — the list has nothing left to point at. */
  onSelectPr: (pr: PullRequestSummary | null, opener?: HTMLElement) => void;
}

/**
 * The connect modal lives out here, not in the "not connected" branch below:
 * saving the token flips availability to connected, which swaps that branch
 * for the list — a modal inside it would vanish mid-wizard, before the user
 * has picked their repositories.
 */
export function PullRequestsPanel(props: PullRequestsPanelProps) {
  const [connectOpen, setConnectOpen] = useState(false);
  const availability = useGetPrAvailabilityQuery(undefined, {
    refetchOnMountOrArgChange: 30,
  });

  return (
    <>
      <PullRequestsList {...props} availabilityQuery={availability} onConnect={() => setConnectOpen(true)} />
      <GitHubModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        isConnected={availability.currentData?.connected === true}
        onSuccess={() => void availability.refetch()}
      />
    </>
  );
}

function PullRequestsList({
  scope,
  selectedNodeId,
  onSelectPr,
  availabilityQuery,
  onConnect,
}: PullRequestsPanelProps & {
  availabilityQuery: ReturnType<typeof useGetPrAvailabilityQuery>;
  onConnect: () => void;
}) {
  // The sidebar owns repository scoping on desktop; without it (mobile) the
  // facet menu's Repository section is the only way to narrow by repo.
  const showScopeFacets = useIsMobile();
  const [relationship, setRelationship] = useState<PrRelationship>("all");
  const [lifecycle, setLifecycle] = useState<PrLifecycle>("all");
  const [text, setText] = useState("");
  const [debouncedText, setDebouncedText] = useState("");
  // Pages loaded past the first via "Load more", keyed by the filters they
  // belong to — a filters change makes the stored pages irrelevant without
  // needing a reset effect.
  const [extra, setExtra] = useState<{ key: string; pages: PrSearchPage[] }>({
    key: "",
    pages: [],
  });
  const [repoFilters, setRepoFilters] = useState<string[]>([]);
  const [repoFilterOpen, setRepoFilterOpen] = useState(false);
  const repoDropdownRef = useRef<HTMLDivElement>(null);

  useClickOutside(repoDropdownRef, () => {
    if (repoFilterOpen) setRepoFilterOpen(false);
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedText(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const { currentData: availability, isFetching: checkingAvailability, isError: availabilityError } = availabilityQuery;
  const connected = availability?.connected === true && !availability.error && !availabilityError;

  // Facet options are the repos selected on the GitHub connection — the same
  // set the search is scoped to by default — plus anything present in the
  // loaded rows (covers the no-selection global fallback).
  const resources = useGetSelectedResourcesQuery("github", { skip: !connected });
  const selectedResources = resources.currentData;

  // The sidebar picks a resource by id; the search wants its `owner/repo`
  // slug. Until the resources load the slug is unknown, so the search waits
  // rather than flashing every repo's PRs first.
  const scopedToRepo = scope.provider === "github" && scope.resourceId !== null;
  const scopeSlug = scopedToRepo
    ? selectedResources?.items.find((resource) => resource?.id === scope.resourceId)
        ?.fullName
    : undefined;
  const scopePending = scopedToRepo && !selectedResources;
  // A stale scope (repo no longer linked) has no slug and widens to all repos.
  const searchRepos = useMemo(
    () =>
      scopeSlug ? [scopeSlug] : showScopeFacets ? [...repoFilters].sort() : [],
    [scopeSlug, showScopeFacets, repoFilters],
  );

  const filters = useMemo(
    () => ({
      relationship,
      lifecycle,
      text: debouncedText || undefined,
      ...(searchRepos.length > 0 ? { repos: searchRepos } : {}),
      pageSize: PAGE_SIZE,
    }),
    [relationship, lifecycle, debouncedText, searchRepos],
  );

  // currentData (not data): on a filter/tab change RTK's `data` keeps serving
  // the previous query's rows until the new one lands — the list must drop to
  // the loading state instead of silently showing stale results.
  const {
    currentData: firstPage,
    isFetching,
    isError,
    refetch,
  } = useSearchPullRequestsQuery(filters, {
    skip: !connected || scopePending,
    refetchOnMountOrArgChange: 30,
  });

  const [loadMore, { isFetching: isFetchingMore }] =
    useLazySearchPullRequestsQuery();

  const filtersKey = JSON.stringify(filters);
  const extraPages = useMemo(
    () => (extra.key === filtersKey ? extra.pages : []),
    [extra, filtersKey],
  );

  const items = useMemo(() => {
    if (!firstPage) return [];
    const seen = new Set<string>();
    const merged: PullRequestSummary[] = [];
    for (const page of [firstPage, ...extraPages]) {
      for (const item of page.items) {
        if (seen.has(item.nodeId)) continue;
        seen.add(item.nodeId);
        merged.push(item);
      }
    }
    return merged;
  }, [firstPage, extraPages]);

  const lastPage = extraPages.length
    ? extraPages[extraPages.length - 1]
    : firstPage;
  const hasNextPage = lastPage?.hasNextPage === true && lastPage.endCursor;

  const repoOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const resource of selectedResources?.items ?? []) {
      const slug = resource?.externalId;
      if (typeof slug === "string" && slug.includes("/")) counts.set(slug, 0);
    }
    for (const pr of items) {
      const slug = `${pr.repo.owner}/${pr.repo.repo}`;
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    for (const slug of repoFilters) {
      if (!counts.has(slug)) counts.set(slug, 0);
    }
    return sortedEntries(counts);
  }, [selectedResources, items, repoFilters]);

  const toggleRepoFilter = (slug: string) =>
    setRepoFilters((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );

  // A non-default state counts as a filter too, now that it lives inside
  // the facet menu with no always-visible control of its own.
  const activeFilterCount = repoFilters.length + (lifecycle !== "all" ? 1 : 0);
  const narrowed = Boolean(debouncedText) || relationship !== "all" || activeFilterCount > 0;

  const clearFilters = () => {
    setRepoFilters([]);
    setLifecycle("all");
  };

  // Keep the split view pointed at a visible row. The compact view opens
  // only when the user activates a row.
  useEffect(() => {
    if (!connected || scopePending) {
      if (selectedNodeId) onSelectPr(null);
      return;
    }
    if (items.length === 0) {
      // Same as the issues panel: a disconnected provider (or a search that
      // came back empty) must not leave a stale PR in the drawer.
      if (selectedNodeId && !isFetching) onSelectPr(null);
      return;
    }
    if (selectedNodeId && items.some((pr) => pr.nodeId === selectedNodeId)) {
      return;
    }
    onSelectPr(items[0]);
  }, [connected, scopePending, items, selectedNodeId, isFetching, onSelectPr]);

  const handleLoadMore = async () => {
    if (!lastPage?.endCursor) return;
    try {
      const result = await loadMore(
        { ...filters, cursor: lastPage.endCursor },
        true,
      ).unwrap();
      setExtra((prev) => ({
        key: filtersKey,
        pages: prev.key === filtersKey ? [...prev.pages, result] : [result],
      }));
    } catch {
      toast.error("Unable to load more pull requests.");
    }
  };

  if (availabilityError) {
    return <TasksLoadError title="Unable to check GitHub access." onRetry={() => void availabilityQuery.refetch()} />;
  }

  if (!availability || (checkingAvailability && !connected)) {
    return <TasksState title="Checking GitHub access…" role="status" />;
  }

  if (availability.error) {
    return (
      <TasksState title="GitHub access could not be verified." role="alert">
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={onConnect}>Manage GitHub</Button>
          <Button variant="subtle" onClick={() => void availabilityQuery.refetch()}>Try again</Button>
        </div>
      </TasksState>
    );
  }

  if (!availability.connected) {
    return (
      <TasksState
        title="GitHub is not connected"
        description="Connect GitHub to see pull requests you authored, reviewed, or were asked to review."
      >
        <Button variant="primary" onClick={onConnect}>Connect GitHub</Button>
      </TasksState>
    );
  }

  if (scopePending) {
    return resources.isError
      ? <TasksLoadError title="Unable to load the selected GitHub repositories." onRetry={() => void resources.refetch()} />
      : <TasksState title="Loading GitHub repositories…" role="status" />;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search + filters — stay put while the list scrolls */}
      <div className="shrink-0 px-6 flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-primary-400" />
          <Input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search pull requests"
            aria-label="Search pull requests"
            className={`w-full pl-9 ${text ? "pr-9" : "pr-3"} py-1.5 text-s rounded-2xl bg-primary/40 dark:bg-primary/5 glass-outline placeholder:text-primary-500 dark:placeholder:text-primary-500 text-primary-900 dark:text-primary-100 outline-none`}
          />
          {text && (
            <Button
              variant="icon" iconSize="sm"
              onClick={() => setText("")}
              tooltip="Clear search"
              aria-label="Clear search"
              className="absolute right-2 top-1/2 z-10 -translate-y-1/2"
            >
              <Close className="size-3" />
            </Button>
          )}
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <SegmentedTabs
            variant="plain"
            value={relationship}
            onChange={setRelationship}
            options={RELATIONSHIP_FILTERS}
            semantics="radiogroup"
            aria-label="Pull request relationship"
            className="w-fit max-w-full overflow-x-auto noscrollbar"
          />
          <div className="flex items-center gap-1.5">
            {activeFilterCount > 0 && (
              <Button
                onClick={clearFilters}
                className="px-2 py-1 flex items-center gap-1 text-xs rounded-full bg-primary/60 dark:bg-primary/10 glass-outline text-primary-800 dark:text-primary-200 cursor-pointer whitespace-nowrap"
                tooltip="Clear filters"
              >
                <Trash className="size-3.5" />
                {activeFilterCount} filter
                {activeFilterCount === 1 ? "" : "s"}
              </Button>
            )}
            {/* State + repository facet menu, anchored under the button. */}
            <div className="relative" ref={repoDropdownRef}>
              <Button
                variant="filter"
                onClick={() => setRepoFilterOpen((open) => !open)}
                tooltip="Filter pull requests"
                aria-label="Filter pull requests"
                aria-haspopup="dialog"
                aria-expanded={repoFilterOpen}
                className={
                  repoFilterOpen || activeFilterCount > 0
                    ? "bg-primary/80 dark:bg-primary/10 glass-outline text-primary-900 dark:text-primary-100"
                    : undefined
                }
              >
                <Layers className="w-3.5 h-3.5" />
              </Button>
              <DropdownWrapper
                isOpen={repoFilterOpen}
                role="dialog"
                aria-label="Pull request filters"
                minWidth="min-w-80"
                position="right"
              >
                <div className="max-h-80 overflow-y-auto noscrollbar pb-1.5">
                  <FilterChoiceSection
                    title="State"
                    options={LIFECYCLE_FILTERS}
                    value={lifecycle}
                    onSelect={setLifecycle}
                  />
                  {showScopeFacets && (
                    <>
                      <div
                        role="separator"
                        aria-orientation="horizontal"
                        className="mx-3.5 h-px bg-primary-200/70 dark:bg-primary-700/40"
                      />
                      <FilterSection
                        title="Repository"
                        entries={repoOptions}
                        selected={repoFilters}
                        onToggle={toggleRepoFilter}
                      />
                    </>
                  )}
                  {activeFilterCount > 0 && (
                    <div className="px-3 pt-2">
                      <Button
                        variant="subtle"
                        onClick={clearFilters}
                        className="w-full text-center text-xs text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-200 cursor-pointer py-1"
                      >
                        Clear filters
                      </Button>
                    </div>
                  )}
                </div>
              </DropdownWrapper>
            </div>
          </div>
        </div>
      </div>

      {/* Scrolling list — rows fade out as they slide under the controls */}
      <div className="scroll-bounce flex-1 min-h-0 overflow-y-auto noscrollbar px-6 pt-3 pb-16 mask-[linear-gradient(to_bottom,transparent,black_1.75rem)]">
        {isError ? (
          <TasksLoadError title="Unable to load pull requests." onRetry={() => void refetch()} />
        ) : isFetching && items.length === 0 ? (
          <TasksState title="Loading pull requests…" role="status" />
        ) : items.length === 0 && (
          <TasksState title={narrowed ? "No pull requests match these filters." : "No pull requests found."} />
        )}
        {items.length > 0 && (
          <div className="space-y-2 min-w-0">
            {items.map((pr, index) => (
              <div
                key={pr.nodeId}
                className="animate-slide-in"
                style={{ animationDelay: `${Math.min(index, 20) * 0.02}s` }}
              >
                <PrListItem
                  pr={pr}
                  isActive={selectedNodeId === pr.nodeId}
                  compact
                  onClick={(opener) => onSelectPr(pr, opener)}
                />
              </div>
            ))}
            {hasNextPage && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="subtle"
                  isLoading={isFetchingMore}
                  onClick={handleLoadMore}
                  className="text-primary-800 dark:text-primary-200"
                >
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
