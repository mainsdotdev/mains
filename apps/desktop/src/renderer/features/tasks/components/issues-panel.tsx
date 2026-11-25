import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useGetIssuesInboxQuery,
  useGetIssueStatusesQuery,
  type IssueWithEntity,
} from "@/lib/redux/api";
import { Button, Input, SegmentedTabs } from "@/components/ui";
import { Close, Search } from "@/components/ui/icons";
import { useIsMobile } from "@/lib/platform";
import type { IssueStatus } from "@mains/contracts/issue-status";
import {
  countIssueFilters,
  EMPTY_ISSUE_FILTERS,
  ISSUE_VIEWS,
  matchesIssueFilters,
  matchesIssueText,
  matchesIssueView,
  toggleIssueFilter,
  type IssueFacet,
  type IssueFilters,
  type IssueView,
} from "../lib/issue-filters";
import { matchesIssueScope, type TasksScope } from "../lib/scope";
import { buildIssueFacetGroups, IssueFilterButton, IssueFilterChips } from "./issue-filter-menu";
import { IssueRow } from "./issue-row";
import { OPEN_ISSUES_QUERY } from "./tasks-sidebar";
import { TasksLoadError, TasksState } from "./tasks-state";

const EMPTY_STATUSES: IssueStatus[] = [];
const EMPTY_ISSUES: IssueWithEntity[] = [];

interface IssuesPanelProps {
  /** Connection / resource picked in the sidebar. */
  scope: TasksScope;
  activeEntityId: string | null;
  /** `null` clears the drawer — the list has nothing left to point at. */
  onSelectIssue: (issue: IssueWithEntity | null, opener?: HTMLElement) => void;
}

export function IssuesPanel({ scope, activeEntityId, onSelectIssue }: IssuesPanelProps) {
  // The sidebar owns connection + project scoping on desktop; without it
  // (mobile) the facet menu is the only way to narrow by either.
  const showScopeFacets = useIsMobile();
  const [text, setText] = useState("");
  const [view, setView] = useState<IssueView>("all");
  const [filters, setFilters] = useState<IssueFilters>(EMPTY_ISSUE_FILTERS);

  // Open issues only — work still to do. Done / canceled ones stay synced
  // (that is how they leave this list) but aren't listed. "Open" is Mains'
  // status category: a provider's own state names are never literally "open".
  const {
    currentData: issues = EMPTY_ISSUES,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useGetIssuesInboxQuery(OPEN_ISSUES_QUERY);

  const { data: statuses = EMPTY_STATUSES } = useGetIssueStatusesQuery();
  const statusById = useMemo(
    () => new Map(statuses.map((status) => [status.id, status])),
    [statuses],
  );

  // What the sidebar scope, the view chip and the search leave. The filter
  // menu counts from here, so its numbers follow what is shown.
  const rowsInView = useMemo(
    () =>
      issues.filter(
        (row) => matchesIssueScope(row, scope) && matchesIssueView(row, view) && matchesIssueText(row, text),
      ),
    [issues, scope, view, text],
  );
  const filteredIssues = useMemo(
    () => rowsInView.filter((row) => matchesIssueFilters(row, filters)),
    [rowsInView, filters],
  );
  const facetGroups = useMemo(
    () => buildIssueFacetGroups({ rows: rowsInView, filters, statuses, showScopeFacets }),
    [rowsInView, filters, statuses, showScopeFacets],
  );
  const activeFilterCount = countIssueFilters(filters);
  const narrowed = Boolean(text.trim()) || activeFilterCount > 0 || view !== "all";

  const toggleFilter = useCallback(
    (facet: IssueFacet, value: string) => setFilters((prev) => toggleIssueFilter(prev, facet, value)),
    [],
  );
  const clearFilters = useCallback(
    (facet: IssueFacet | null) =>
      setFilters((prev) => (facet ? { ...prev, [facet]: [] } : EMPTY_ISSUE_FILTERS)),
    [],
  );

  // A priority column only when something in view has one (GitHub never does).
  const showPriority = filteredIssues.some((row) => row.issue.priority > 0);

  // Keep the split view pointed at a visible row. The compact view opens
  // only when the user activates a row.
  useEffect(() => {
    if (filteredIssues.length === 0) {
      // Revoking a connection deletes its issues, so a settled empty list has
      // to drop the drawer's row too. `isFetching` keeps the refetch gap from
      // clearing a still-valid selection.
      if (activeEntityId && !isFetching) onSelectIssue(null);
      return;
    }
    if (
      activeEntityId &&
      filteredIssues.some((row) => row.issue.entityId === activeEntityId)
    ) {
      return;
    }
    onSelectIssue(filteredIssues[0]);
  }, [filteredIssues, activeEntityId, isFetching, onSelectIssue]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search + filters — stay put while the list scrolls */}
      <div className="shrink-0 px-6 flex flex-col gap-3">
        <div className="relative ">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-primary-400" />
          <Input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search issues"
            aria-label="Search issues"
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
        {/* Same controls as the pull requests tab: views left, filter right. */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <SegmentedTabs
            variant="plain"
            value={view}
            onChange={setView}
            options={ISSUE_VIEWS}
            semantics="radiogroup"
            aria-label="Issue view"
            className="w-fit"
          />
          <IssueFilterButton groups={facetGroups} filters={filters} onToggle={toggleFilter} />
        </div>
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <IssueFilterChips groups={facetGroups} filters={filters} onClear={clearFilters} />
          </div>
        )}
      </div>

      {/* Scrolling list — rows fade out as they slide under the controls */}
      <div className="scroll-bounce flex-1 min-h-0 overflow-y-auto noscrollbar px-6 pt-3 pb-16 mask-[linear-gradient(to_bottom,transparent,black_1.75rem)]">
        {isError ? (
          <TasksLoadError title="Unable to load issues." onRetry={() => void refetch()} />
        ) : isLoading || (isFetching && issues.length === 0) ? (
          <TasksState title="Loading issues…" role="status" />
        ) : filteredIssues.length === 0 && (
          <TasksState
            title={narrowed ? "No issues match these filters." : "No open issues synced yet."}
            description={narrowed ? undefined : "Open issues from your connected trackers appear here after sync."}
          />
        )}
        {filteredIssues.length > 0 && (
          <div className="space-y-1">
            {filteredIssues.map((row, index) => (
              <div
                key={row.issue.entityId}
                className="animate-slide-in"
                style={{ animationDelay: `${Math.min(index, 20) * 0.02}s` }}
              >
                <IssueRow
                  row={row}
                  status={statusById.get(row.issue.statusId) ?? null}
                  isActive={activeEntityId === row.issue.entityId}
                  showProvider={!scope.provider}
                  showPriority={showPriority}
                  onClick={(opener) => onSelectIssue(row, opener)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
