import type { ReactNode } from "react";
import { Button, Text } from "@/components/ui";
import { Check } from "@/components/ui/icons";

/** value → occurrence count, sorted by count. */
export function sortedEntries(map: Map<string, number>): [string, number][] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

// The two groups below are the same menu to the reader, so their heading and
// their row label are one decision each rather than two that happen to agree.

/** Heading over a group of filter rows. */
const FilterTitle = ({ children }: { children: ReactNode }) => (
  <Text as="div" size="s" tone="subtle" weight="medium" className="px-3 pt-2 pb-1">
    {children}
  </Text>
);

/** The label a filter row is chosen by. Shared with the PR detail filter menu. */
export const FilterLabel = ({ children }: { children: ReactNode }) => (
  <Text as="span" size="s" tone="secondary" className="flex-1 min-w-0 truncate">
    {children}
  </Text>
);

/**
 * Single-choice group inside the /tasks filter menus — radio-like rows
 * without counts (e.g. the PR state).
 */
export function FilterChoiceSection<T extends string>({
  title,
  options,
  value,
  onSelect,
}: {
  title: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div>
      <FilterTitle>
        {title}
      </FilterTitle>
      {options.map((opt) => (
        <Button
          key={opt.value}
          onClick={() => onSelect(opt.value)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer transition-colors hover:bg-primary-200/30 dark:hover:bg-primary-800"
        >
          <FilterLabel>
            {opt.label}
          </FilterLabel>
          {value === opt.value && (
            <Check className="w-3 h-3 shrink-0 text-primary-900 dark:text-primary-100" />
          )}
        </Button>
      ))}
    </div>
  );
}

/** One facet group inside the /tasks filter menus (issues + PRs). */
export function FilterSection({
  title,
  entries,
  selected,
  onToggle,
  renderIcon,
}: {
  title: string;
  entries: [string, number][];
  selected: string[];
  onToggle: (value: string) => void;
  renderIcon?: (value: string) => React.ReactNode;
}) {
  if (entries.length === 0) return null;
  return (
    <div>
      <FilterTitle>
        {title}
      </FilterTitle>
      {entries.map(([value, count]) => {
        const isSelected = selected.includes(value);
        return (
          <Button
            key={value}
            onClick={() => onToggle(value)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer transition-colors hover:bg-primary-200/30 dark:hover:bg-primary-800"
          >
            {renderIcon?.(value)}
            <FilterLabel>
              {value}
            </FilterLabel>
            <Text as="span" size="xxs" tone="subtle" className="shrink-0 tabular-nums">
              {count}
            </Text>
            {isSelected && (
              <Check className="w-3 h-3 shrink-0 text-primary-900 dark:text-primary-100" />
            )}
          </Button>
        );
      })}
    </div>
  );
}
