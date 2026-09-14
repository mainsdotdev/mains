import { useEffect, useMemo, useRef, useState } from "react";
import { useGetIssuesInboxQuery, type IssueWithEntity } from "@/lib/redux/api";
import { IssueListItem } from "@/features/workspace/components/issue-list-item";
import { ProviderIcon } from "@/features/workspace/components/provider-icon";
import { Body, Button, DropdownWrapper, Input, SegmentedTabs, Text } from "@/components/ui";
import { Close, Layers, Search, Trash } from "@/components/ui/icons";
import { useClickOutside } from "@/hooks/use-click-outside";
import { parseLabels } from "@/lib/label-colors";
import { FilterSection, sortedEntries } from "./filter-section";

type IssueStateFilter = "all" | "open" | "closed";

const STATE_FILTERS: { value: IssueStateFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
];

type FilterGroup = "providers" | "repos" | "labels" | "assignees";

interface IssueFilters {
  providers: string[];
  repos: string[];
  labels: string[];
  assignees: string[];
}

const EMPTY_FILTERS: IssueFilters = {
  providers: [],
  repos: [],
  labels: [],
  assignees: [],
};

interface IssuesPanelProps {
  activeEntityId: string | null;
  /** `null` clears the drawer — the list has nothing left to point at. */
  onSelectIssue: (issue: IssueWithEntity | null) => void;
}

export function IssuesPanel({ activeEntityId, onSelectIssue }: IssuesPanelProps) {
  const [stateFilter, setStateFilter] = useState<IssueStateFilter>("open");
  const [text, setText] = useState("");
  const [filters, setFilters] = useState<IssueFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  // Left offset of the active tab inside the wrapper — anchors the facet
  // menu under the tab that was clicked rather than the whole control.
  const [menuLeft, setMenuLeft] = useState(0);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  useClickOutside(filterDropdownRef, () => {
    if (filterOpen) setFilterOpen(false);
  });

  const filterButtonRef = useRef<HTMLButtonElement>(null);

  const openFilterMenu = () => {
    const wrapper = filterDropdownRef.current;
    const button = filterButtonRef.current;
    if (wrapper && button) {
      setMenuLeft(
        button.getBoundingClientRect().left -
          wrapper.getBoundingClientRect().left,
      );
    }
    setFilterOpen(true);
  };

  // currentData (not data): keeps a state-filter switch from showing the
  // previous tab's rows while the new query is in flight.
  const {
    currentData: issues = [],
    isLoading,
    isFetching,
  } = useGetIssuesInboxQuery({
    ...(stateFilter === "all" ? {} : { state: stateFilter }),
    limit: 200,
  });

  // Facet options are derived from the loaded set, so the menu only ever
  // offers values that exist (with counts), Linear-style.
  const filterOptions = useMemo(() => {
    const providers = new Map<string, number>();
    const repos = new Map<string, number>();
    const labels = new Map<string, number>();
    const assignees = new Map<string, number>();
    for (const row of issues) {
      providers.set(
        row.issue.provider,
        (providers.get(row.issue.provider) ?? 0) + 1,
      );
      if (row.issue.repo) {
        repos.set(row.issue.repo, (repos.get(row.issue.repo) ?? 0) + 1);
      }
      if (row.issue.assignee) {
        assignees.set(
          row.issue.assignee,
          (assignees.get(row.issue.assignee) ?? 0) + 1,
        );
      }
      for (const label of parseLabels(row.issue.labels)) {
        labels.set(label, (labels.get(label) ?? 0) + 1);
      }
    }
    return {
      providers: sortedEntries(providers),
      repos: sortedEntries(repos),
      labels: sortedEntries(labels),
      assignees: sortedEntries(assignees),
    };
  }, [issues]);

  const activeFilterCount =
    filters.providers.length +
    filters.repos.length +
    filters.labels.length +
    filters.assignees.length;

  // Facets come from the loaded rows, so an empty tab offers nothing —
  // the menu explains itself instead of opening as a blank shell.
  const hasFilterOptions =
    filterOptions.providers.length > 0 || filterOptions.repos.length > 0;

  const toggleFilter = (group: FilterGroup, value: string) =>
    setFilters((prev) => ({
      ...prev,
      [group]: prev[group].includes(value)
        ? prev[group].filter((v) => v !== value)
        : [...prev[group], value],
    }));

  // Client-side text + facet filters — the synced issues are already local.
  const filteredIssues = useMemo(() => {
    const query = text.trim().toLowerCase();
    return issues.filter((row) => {
      if (
        filters.providers.length > 0 &&
        !filters.providers.includes(row.issue.provider)
      ) {
        return false;
      }
      if (
        filters.repos.length > 0 &&
        (!row.issue.repo || !filters.repos.includes(row.issue.repo))
      ) {
        return false;
      }
      if (
        filters.assignees.length > 0 &&
        (!row.issue.assignee || !filters.assignees.includes(row.issue.assignee))
      ) {
        return false;
      }
      if (filters.labels.length > 0) {
        const rowLabels = parseLabels(row.issue.labels);
        if (!filters.labels.some((label) => rowLabels.includes(label))) {
          return false;
        }
      }
      if (!query) return true;
      const num = row.issue.number != null ? String(row.issue.number) : "";
      return (
        (row.entity.title ?? "").toLowerCase().includes(query) ||
        (row.issue.repo ?? "").toLowerCase().includes(query) ||
        (row.issue.labels ?? "").toLowerCase().includes(query) ||
        num.includes(query)
      );
    });
  }, [issues, text, filters]);

  // The detail drawer is always open — keep it pointed at the top row
  // whenever nothing (or something no longer listed) is selected.
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
              onClick={() => setText("")}
              tooltip="Clear search"
              aria-label="Clear search"
              className="absolute right-2 top-1/2 z-10 -translate-y-1/2 p-1 rounded-lg cursor-pointer text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-200 hover:bg-primary/50 dark:hover:bg-primary/10"
            >
              <Close className="size-3" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 ">
          {/* The Layers button to the right of the tabs toggles the facet
              filter menu; the menu opens anchored under the button. */}
          <div className="relative flex items-center gap-1.5" ref={filterDropdownRef}>
            <SegmentedTabs
              variant="plain"
              value={stateFilter}
              onChange={(next) => {
                if (next !== stateFilter) {
                  setStateFilter(next);
                  setFilterOpen(false);
                }
              }}
              options={STATE_FILTERS}
              semantics="radiogroup"
              aria-label="Issue state"
              className="w-fit"
            />
            <Button
              ref={filterButtonRef}
              onClick={() => {
                if (filterOpen) setFilterOpen(false);
                else openFilterMenu();
              }}
              tooltip="Filter issues"
              aria-label="Filter issues"
              aria-haspopup="dialog"
              aria-expanded={filterOpen}
              className={`p-1.5 rounded-xl cursor-pointer transition-colors ${
                filterOpen || activeFilterCount > 0
                  ? "bg-primary/80 dark:bg-primary/10 glass-outline text-primary-900 dark:text-primary-100"
                  : "text-primary-600 dark:text-primary-400 hover:bg-primary/50 dark:hover:bg-primary/10 hover:text-primary-800 dark:hover:text-primary-200"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
            </Button>
            {/* Positioned anchor so the menu opens under the active tab. */}
            <div className="absolute inset-y-0" style={{ left: menuLeft }}>
              <DropdownWrapper
                isOpen={filterOpen}
                role="dialog"
                aria-label="Issue filters"
                minWidth="min-w-80"
              >
              <div className="max-h-80 overflow-y-auto noscrollbar pb-1.5">
                {!hasFilterOptions && activeFilterCount === 0 && (
                  <Text as="div" size="xs" tone="subtle" className="px-3 py-3 -mb-1.5">
                    Nothing to filter — this list is empty.
                  </Text>
                )}
                <FilterSection
                  title="Connection"
                  entries={filterOptions.providers}
                  selected={filters.providers}
                  onToggle={(value) => toggleFilter("providers", value)}
                  renderIcon={(value) => (
                    <ProviderIcon
                      provider={value}
                      className="size-4 shrink-0 text-primary-800 dark:text-primary-200"
                      fallback="text"
                    />
                  )}
                />
                <FilterSection
                  title="Projects"
                  entries={filterOptions.repos}
                  selected={filters.repos}
                  onToggle={(value) => toggleFilter("repos", value)}
                />
                {/* <FilterSection
                  title="Label"
                  entries={filterOptions.labels}
                  selected={filters.labels}
                  onToggle={(value) => toggleFilter("labels", value)}
                />
                <FilterSection
                  title="Assignee"
                  entries={filterOptions.assignees}
                  selected={filters.assignees}
                  onToggle={(value) => toggleFilter("assignees", value)}
                /> */}
                {activeFilterCount > 0 && (
                  <div className="px-3 pt-2">
                    <Button
                    variant="subtle"
                      onClick={() => setFilters(EMPTY_FILTERS)}
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
          {activeFilterCount > 0 && (

            <Button
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-primary/60 dark:bg-primary/10 glass-outline text-primary-800 dark:text-primary-200 cursor-pointer"
              tooltip="Clear filters"
            >
               <Trash className="size-3.5"/>
              {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}

            </Button>

          )}
        </div>
      </div>

      {/* Scrolling list — rows fade out as they slide under the controls */}
      <div className="flex-1 min-h-0 overflow-y-auto noscrollbar px-6 pt-3 pb-16 mask-[linear-gradient(to_bottom,transparent,black_1.75rem)]">
        {isLoading || (isFetching && issues.length === 0) ? (
          <div className="flex items-center justify-center py-10">
            <Text as="span" size="xs" tone="inherit" className="shine-text">
              Loading issues...
            </Text>
          </div>
        ) : filteredIssues.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-12 text-center">
            <Body size="s" tone="secondary">
              {text.trim() || activeFilterCount > 0
                ? "No issues match these filters."
                : `No ${stateFilter === "all" ? "" : stateFilter + " "}issues synced yet.`}
            </Body>
            {!text.trim() && activeFilterCount === 0 && (
              <Body size="xs" tone="subtle">
                Issues arrive from your connections (GitHub, Linear, Jira, ...)
                via sync.
              </Body>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredIssues.map((row, index) => (
              <div
                key={row.issue.entityId}
                className="animate-slide-in"
                style={{ animationDelay: `${Math.min(index, 20) * 0.02}s` }}
              >
                <IssueListItem
                  issue={row}
                  isActive={activeEntityId === row.issue.entityId}
                  onClick={() => onSelectIssue(row)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
