import { useId, useMemo, useRef, useState } from "react";
import { Body, Button, Checkbox, ErrorText, Input, Muted, Text } from "@/components/ui";
import { Close, Search } from "@/components/ui/icons";

interface SelectableResource {
  id: string | number;
  [key: string]: any;
}

/**
 * Every whitespace-separated token of the query must appear in the resource's
 * search text, in any order. Tokens rather than one substring so `dev mains`
 * finds `mainsdotdev/mains` — the user shouldn't have to reproduce whichever
 * separator the provider puts between owner and name.
 */
export function matchesResourceQuery(searchText: string, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = searchText.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function ResourceRow<T extends SelectableResource>({
  resource,
  selected,
  onToggle,
  renderItem,
  loading,
}: {
  resource: T;
  selected: boolean;
  onToggle: (id: string | number) => void;
  renderItem: (resource: T) => React.ReactNode;
  loading: boolean;
}) {
  const content = renderItem(resource);
  const resourceLabelId = useId();

  return (
    <div className="flex items-center dark:bg-primary-950/50 bg-primary  justify-between px-4 py-3.5 border-b border-primary-200/50 dark:border-primary-800/40 last:border-b-0">
      <Button
        id={resourceLabelId}
        className="flex-1 text-left cursor-pointer"
        onClick={() => onToggle(resource.id)}
      >
        {content}
      </Button>
      <Checkbox
        checked={selected}
        onChange={() => onToggle(resource.id)}
        disabled={loading}
        aria-labelledby={resourceLabelId}
      />
    </div>
  );
}

interface SelectResourcesStepProps<T extends SelectableResource> {
  resources: T[];
  selectedResources: Set<string | number> | string[] | number[];
  onToggleResource: (id: string | number) => void;
  onSave: () => void;
  onBack: () => void;
  loading: boolean;
  error: string;
  title?: string;
  emptyMessage?: string;
  saveButtonLabel?: string;
  renderResourceItem: (resource: T) => React.ReactNode;
  /**
   * Text a typed query is matched against. Providers hand back different
   * shapes (`fullName`, `name` + `key`, `pathWithNamespace`), so the caller
   * says what a row reads as rather than this component guessing at fields.
   */
  searchTextForResource: (resource: T) => string;
  searchPlaceholder: string;
}

export function SelectResourcesStep<T extends SelectableResource>({
  resources,
  selectedResources,
  onToggleResource,
  onSave,
  onBack,
  loading,
  error,
  title,
  emptyMessage = "No resources available.",
  saveButtonLabel,
  renderResourceItem,
  searchTextForResource,
  searchPlaceholder,
}: SelectResourcesStepProps<T>) {
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const clearSearch = () => {
    setQuery("");
    searchInputRef.current?.focus();
  };

  // Filtering is a view over the list; selection stays keyed to the resource
  // ids, so anything picked before a search survives it (and still counts
  // toward the save button) even while it's filtered out of view.
  const visibleResources = useMemo(
    () =>
      query.trim()
        ? resources.filter((resource) =>
            matchesResourceQuery(searchTextForResource(resource), query),
          )
        : resources,
    [resources, query, searchTextForResource],
  );

  const selectedCount =
    selectedResources instanceof Set
      ? selectedResources.size
      : selectedResources.length;

  const isSelected = (id: string | number) =>
    selectedResources instanceof Set
      ? selectedResources.has(id)
      : (selectedResources as any[]).includes(id);

  const finalSaveLabel =
    saveButtonLabel ||
    `Save ${selectedCount} ${selectedCount === 1 ? "Resource" : "Resources"}`;

  return (
    <div className="space-y-4">
      {title && <Muted>{title}</Muted>}
      {!title && (
        <Muted>
          <Text
            as="span"
            size="inherit"
            tone="contrast"
            weight="semibold"
            className="mr-1"
          >
            {selectedCount}
          </Text>
          selected.
        </Muted>
      )}

      {resources.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary-400" />
          <Input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Escape clears the filter first; without this it would reach the
              // wizard and close the whole modal mid-search.
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                clearSearch();
              }
            }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="pl-9 pr-9"
          />
          {query && (
            <Button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded hover:bg-primary/20 dark:hover:bg-primary/10"
              title="Clear search"
              aria-label="Clear search"
            >
              <Close className="size-3 text-primary-600 dark:text-primary-400" />
            </Button>
          )}
        </div>
      )}

      <div className="max-h-52 overflow-y-auto border border-primary-200/50 dark:border-primary-800/40 rounded-xl">
        {resources.length === 0 ? (
          <div className="p-8 text-center">
            <Body>{emptyMessage}</Body>
          </div>
        ) : visibleResources.length === 0 ? (
          <div className="p-8 text-center">
            <Muted>No matches for “{query.trim()}”.</Muted>
          </div>
        ) : (
          visibleResources.map((resource) => (
            <ResourceRow
              key={resource.id}
              resource={resource}
              selected={isSelected(resource.id)}
              onToggle={onToggleResource}
              renderItem={renderResourceItem}
              loading={loading}
            />
          ))
        )}
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      <div className="flex justify-between gap-3 pt-2">
        <Button variant="ghost" onClick={onBack} disabled={loading}>
          Back
        </Button>
        <Button
          variant="submit"
          onClick={onSave}
          disabled={loading || selectedCount === 0}
          isLoading={loading}
          className="ml-auto"
        >
          {loading ? "Saving..." : finalSaveLabel}
        </Button>
      </div>
    </div>
  );
}
