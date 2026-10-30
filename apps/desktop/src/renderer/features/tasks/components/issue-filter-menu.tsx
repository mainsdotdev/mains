import { useRef, useState, type ReactNode } from "react";
import type { IssueStatus } from "@mains/contracts/issue-status";
import { Button, DropdownMenu, DropdownMenuItem, DropdownMenuSub, Input, Text } from "@/components/ui";
import { Box, Close, Connect, Layers, Project, Search } from "@/components/ui/icons";
import type { IssueWithEntity } from "@/lib/redux/api";
import { labelColor } from "@/lib/label-colors";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import { ProviderIcon } from "@/features/workspace/components/provider-icon";
import { issueFacetCounts, NO_ASSIGNEE, type IssueFacet, type IssueFilters } from "../lib/issue-filters";
import { GroupIcon, plainHex, PRIORITY_NAMES, PriorityIcon } from "./issue-row";
import { IssueStatusIcon } from "./issue-status";

export interface FacetOption {
  value: string;
  label: string;
  icon: ReactNode;
  /** Rows this value would leave, under the other facets' picks. */
  count: number;
}

export interface FacetGroup {
  facet: IssueFacet;
  title: string;
  icon: ReactNode;
  options: FacetOption[];
}

const MENU_WIDTH = 240;

/** Urgent first, "No priority" last — Linear's order. */
const PRIORITY_ORDER = ["1", "2", "3", "4", "0"];

const STATUS_GLYPH: IssueStatus = { id: "backlog", name: "Status", category: "open", sortOrder: 0 };

function Swatch({ color }: { color: string | null }) {
  return color ? <span className="size-2 rounded-full" style={{ backgroundColor: color }} /> : null;
}

function PersonIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden className={`size-3.5 shrink-0 ${className}`}>
      <circle cx="7" cy="4.75" r="2.25" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M2.75 12c.5-2.2 2.2-3.5 4.25-3.5s3.75 1.3 4.25 3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden className="size-3.5 shrink-0">
      <path
        d="M1.75 7.6V2.75a1 1 0 0 1 1-1H7.6a1 1 0 0 1 .7.3l3.95 3.95a1 1 0 0 1 0 1.4l-4.85 4.85a1 1 0 0 1-1.4 0L2.05 8.3a1 1 0 0 1-.3-.7z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="4.75" cy="4.75" r="1" fill="currentColor" />
    </svg>
  );
}

function NoPriorityIcon() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden className="size-3.5 shrink-0 text-primary-500">
      {[0, 1, 2].map((dash) => (
        <rect key={dash} x={1.5 + dash * 4} y="6.25" width="3" height="1.5" rx="0.75" fill="currentColor" />
      ))}
    </svg>
  );
}

function AvatarIcon({ url }: { url: string | undefined }) {
  const src = proxiedImageSrc(url ?? null);
  return src ? <img src={src} alt="" className="size-3.5 rounded-full" /> : <PersonIcon />;
}

/**
 * The Issues filter menu's groups, built from the rows in view (scope and
 * search applied) so every count is what picking that value would leave.
 * A group with nothing to tell apart stays out — no Priority for GitHub —
 * unless something in it is picked; picked values stay listed so they can
 * be unpicked even when no row has them anymore.
 */
export function buildIssueFacetGroups({
  rows,
  filters,
  statuses,
  showScopeFacets,
}: {
  rows: readonly IssueWithEntity[];
  filters: IssueFilters;
  statuses: readonly IssueStatus[];
  /** Connection / repository, for layouts without the Tasks sidebar. */
  showScopeFacets: boolean;
}): FacetGroup[] {
  const avatars = new Map<string, string>();
  const groupColors = new Map<string, string>();
  for (const { issue } of rows) {
    if (issue.assignee && issue.assigneeAvatarUrl) avatars.set(issue.assignee, issue.assigneeAvatarUrl);
    const color = plainHex(issue.groupColor);
    if (issue.groupName && color) groupColors.set(issue.groupName, color);
  }
  const statusById = new Map(statuses.map((status) => [status.id, status]));

  const groups: FacetGroup[] = [];
  const add = (
    facet: IssueFacet,
    title: string,
    icon: ReactNode,
    order: (counts: Map<string, number>) => string[],
    describe: (value: string) => { label: string; icon: ReactNode },
    noneValue?: string,
  ) => {
    const counts = issueFacetCounts(rows, filters, facet);
    const values = order(counts);
    for (const value of filters[facet]) if (!values.includes(value)) values.push(value);
    const telling = values.some((value) => value !== noneValue);
    if (!telling && filters[facet].length === 0) return;
    groups.push({
      facet,
      title,
      icon,
      options: values.map((value) => ({ value, count: counts.get(value) ?? 0, ...describe(value) })),
    });
  };
  const byCount = (counts: Map<string, number>) =>
    [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));

  add(
    "status",
    "Status",
    <IssueStatusIcon status={STATUS_GLYPH} />,
    // The whole open workflow, Linear-style, even where nothing sits yet.
    (counts) => [
      ...statuses.filter((status) => status.category === "open").map((status) => status.id),
      ...byCount(counts).filter((id) => statusById.get(id)?.category !== "open"),
    ],
    (id) => {
      const status = statusById.get(id);
      return { label: status?.name ?? id, icon: status ? <IssueStatusIcon status={status} /> : null };
    },
  );
  add(
    "priority",
    "Priority",
    <PriorityIcon priority={2} decorative />,
    (counts) => PRIORITY_ORDER.filter((value) => counts.has(value)),
    (value) => ({
      label: PRIORITY_NAMES[Number(value)] ?? value,
      icon: value === "0" ? <NoPriorityIcon /> : <PriorityIcon priority={Number(value)} decorative />,
    }),
    "0",
  );
  add(
    "assignee",
    "Assignee",
    <PersonIcon />,
    (counts) => [...byCount(counts).filter((name) => name !== NO_ASSIGNEE), ...(counts.has(NO_ASSIGNEE) ? [NO_ASSIGNEE] : [])],
    (name) =>
      name === NO_ASSIGNEE
        ? { label: "No assignee", icon: <PersonIcon className="text-primary-500" /> }
        : { label: name, icon: <AvatarIcon url={avatars.get(name)} /> },
    NO_ASSIGNEE,
  );
  add("labels", "Labels", <TagIcon />, byCount, (label) => ({ label, icon: <Swatch color={labelColor(label)} /> }));
  add("project", "Project", <Box className="size-3.5 shrink-0" />, byCount, (name) => ({
    label: name,
    icon: <GroupIcon color={groupColors.get(name) ?? null} />,
  }));
  if (showScopeFacets || filters.provider.length > 0) {
    add("provider", "Connection", <Connect className="size-3.5 shrink-0" />, byCount, (provider) => ({
      label: provider,
      icon: <ProviderIcon provider={provider} className="size-3.5 shrink-0" fallback="text" />,
    }));
  }
  if (showScopeFacets || filters.repo.length > 0) {
    add("repo", "Repository", <Project className="size-3.5 shrink-0" />, byCount, (repo) => ({ label: repo, icon: null }));
  }
  return groups;
}

function OptionItem({
  option,
  selected,
  onToggle,
  hint,
}: {
  option: FacetOption;
  selected: boolean;
  onToggle: () => void;
  /** In search results: which group the value is from, in place of its count. */
  hint?: string;
}) {
  return (
    <DropdownMenuItem
      selection="multiple"
      indicator="checkbox"
      selected={selected}
      onClick={onToggle}
      className="gap-2 pr-2.5"
    >
      <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
        {option.icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
      {hint ? (
        <Text as="span" size="xxs" tone="subtle" className="shrink-0">
          {hint}
        </Text>
      ) : (
        option.count > 0 && (
          <Text as="span" size="xxs" tone="subtle" className="shrink-0 tabular-nums">
            {option.count} {option.count === 1 ? "issue" : "issues"}
          </Text>
        )
      )}
    </DropdownMenuItem>
  );
}

/**
 * Linear-style "Add filter" menu: a search over every value, then one
 * submenu per group with each value's count. Picking keeps the menu open.
 */
export function IssueFilterButton({
  groups,
  filters,
  onToggle,
}: {
  groups: FacetGroup[];
  filters: IssueFilters;
  onToggle: (facet: IssueFacet, value: string) => void;
}) {
  const [position, setPosition] = useState<{ x: number; y: number; anchorTop: number } | null>(null);
  const [query, setQuery] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setQuery("");
    // The button sits at the right edge, so the menu hangs left from it.
    setPosition({ x: rect.right - MENU_WIDTH, y: rect.bottom + 6, anchorTop: rect.top - 6 });
  };

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? groups.flatMap((group) =>
        group.options
          .filter((option) => option.label.toLowerCase().includes(needle))
          .map((option) => ({ group, option })),
      )
    : [];
  const active = groups.some((group) => filters[group.facet].length > 0);

  return (
    <>
      <Button
        variant="icon"
        ref={buttonRef}
        // The menu closes on outside mousedown; without this the click that
        // follows would open it again.
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => (position ? setPosition(null) : open())}
        tooltip="Filter issues"
        aria-label="Filter issues"
        aria-haspopup="menu"
        aria-expanded={position !== null}
        className={
          position || active
            ? "bg-primary/80 dark:bg-primary/10 glass-outline text-primary-900 dark:text-primary-100"
            : undefined
        }
      >
        <Layers className="w-3.5 h-3.5" />
      </Button>
      <DropdownMenu
        isOpen={position !== null}
        position={position ?? { x: 0, y: 0 }}
        onClose={() => setPosition(null)}
        aria-label="Issue filters"
        initialFocusRef={searchRef}
        origin="top-right"
        minWidth={MENU_WIDTH}
        className="w-60 max-w-[calc(100vw-1rem)]"
      >
        <div className="mx-1 mb-1 flex items-center gap-2 border-b border-primary-200 px-1 py-1 dark:border-primary-800">
          <Search aria-hidden className="size-4 shrink-0 text-primary-500" />
          <Input
            ref={searchRef}
            variant="bare"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Find a filter"
            placeholder="Filter…"
            className="w-full py-1 text-s"
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              listRef.current?.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')?.click();
            }}
          />
        </div>
        <div ref={listRef} className="max-h-80 space-y-0.5 overflow-y-auto noscrollbar">
          {needle ? (
            matches.length > 0 ? (
              matches.map(({ group, option }) => (
                <OptionItem
                  key={`${group.facet}:${option.value}`}
                  option={option}
                  hint={group.title}
                  selected={filters[group.facet].includes(option.value)}
                  onToggle={() => onToggle(group.facet, option.value)}
                />
              ))
            ) : (
              <Text as="div" size="xs" tone="subtle" className="px-2 py-2">
                No matching filters
              </Text>
            )
          ) : groups.length > 0 ? (
            groups.map((group) => (
              <DropdownMenuSub
                key={group.facet}
                label={
                  <>
                    <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
                      {group.icon}
                    </span>
                    {group.title}
                  </>
                }
              >
                {group.options.map((option) => (
                  <OptionItem
                    key={option.value}
                    option={option}
                    selected={filters[group.facet].includes(option.value)}
                    onToggle={() => onToggle(group.facet, option.value)}
                  />
                ))}
              </DropdownMenuSub>
            ))
          ) : (
            <Text as="div" size="xs" tone="subtle" className="px-2 py-2">
              Nothing to filter — this list is empty.
            </Text>
          )}
        </div>
      </DropdownMenu>
    </>
  );
}

/** One chip per narrowing group — "Labels  Bug, Feature +1  ×" — and Clear for several. */
export function IssueFilterChips({
  groups,
  filters,
  onClear,
}: {
  groups: FacetGroup[];
  filters: IssueFilters;
  /** `null` clears every group. */
  onClear: (facet: IssueFacet | null) => void;
}) {
  const active = groups.filter((group) => filters[group.facet].length > 0);
  if (active.length === 0) return null;
  return (
    <>
      {active.map((group) => {
        const labels = filters[group.facet].map(
          (value) => group.options.find((option) => option.value === value)?.label ?? value,
        );
        const summary =
          labels.length <= 2 ? labels.join(", ") : `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
        return (
          <span
            key={group.facet}
            className="flex min-w-0 items-center gap-1.5 rounded-full bg-primary/60 py-0.5 pl-2.5 pr-0.5 glass-outline dark:bg-primary/10"
          >
            <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center text-primary-500">
              {group.icon}
            </span>
            <Text as="span" size="xs" tone="subtle" className="shrink-0">
              {group.title}
            </Text>
            <Text as="span" size="xs" tone="secondary" className="max-w-48 truncate">
              {summary}
            </Text>
            <Button
              variant="icon"
              iconSize="sm"
              onClick={() => onClear(group.facet)}
              tooltip="Remove filter"
              aria-label={`Remove ${group.title} filter`}
            >
              <Close className="size-3" />
            </Button>
          </span>
        );
      })}
      {active.length > 1 && (
        <Button
          variant="subtle"
          onClick={() => onClear(null)}
          className="px-2 py-1 text-xs text-primary-600 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-200"
        >
          Clear
        </Button>
      )}
    </>
  );
}
