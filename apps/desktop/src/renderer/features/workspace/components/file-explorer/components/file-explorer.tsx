import { memo, useState, useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { appApi } from "@/lib/transport";
import type { FileNode, DirEntry, ServiceResponse } from "@/features/workspace/types/file-explorer";
import type {
  TextSearchFileMatch,
  TextSearchResult,
} from "@mains/contracts/text-search";
import type { EditorRevealTarget } from "@/lib/redux/slices/workspaceSlice";
import {
  useTextSearch,
  type TextSearchFlags,
} from "@/features/workspace/hooks/use-text-search";
import {
  buildTextSearchRows,
  describeTextSearchResult,
  revealTargetForHit,
  type TextSearchHit,
} from "@/features/workspace/lib/text-search";
import { FileTreeNode } from "./file-tree-node";
import { TextSearchRows } from "./text-search-rows";
import { FileIconComponent } from "@/components/ui/icons";
import { Button, Caption, Input, SegmentedTabs, Text } from "@/components/ui";
import { Close, CollapseAll, Plus, Refresh, Search } from "@/components/ui/icons";

interface FileExplorerProps {
  rootPath: string;
  /** `reveal` is set when a content-search hit opened the file. */
  onFileSelect?: (node: FileNode, reveal?: EditorRevealTarget) => void;
  onDirectorySelect?: (node: FileNode) => void;
  onAddToContext?: (node: FileNode) => void;
  /** Highlighted file — owned by the caller so it survives explorer remounts. */
  selectedPath?: string | null;
  /** Expanded directory paths — owned by the caller (Redux) for the same reason. */
  expandedPaths?: ReadonlySet<string>;
  onToggleExpand?: (path: string) => void;
  /** Collapses every open folder (the toolbar's collapse-all button). */
  onCollapseAll?: () => void;
  includeHidden?: boolean;
  excludePatterns?: string[];
  initialDepth?: number;
  className?: string;
}

const EMPTY_EXPANDED: ReadonlySet<string> = new Set();
const noopToggle = () => {};

function dirEntryToFileNode(entry: DirEntry): FileNode {
  return {
    name: entry.name,
    fullPath: entry.fullPath,
    type: entry.type,
    hasChildren: entry.hasChildren,
    size: entry.size,
    extension: entry.extension,
    children: undefined,
  };
}

/** Workspace-relative parent directory of a match, for the secondary label. */
function relativeDir(fullPath: string, rootPath: string): string {
  const root = rootPath.replace(/\/$/, "");
  if (!fullPath.startsWith(root)) return "";
  const rel = fullPath.slice(root.length).replace(/^\//, "");
  return rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
}

const SEARCH_DEBOUNCE_MS = 320;
const MAX_SEARCH_MATCHES = 150;
// Matching lines a content search collects. The list isn't virtualized, so
// this stays well under the backend's own cap.
const MAX_TEXT_SEARCH_LINES = 1_000;

type SearchMode = "files" | "text";

const SEARCH_MODE_OPTIONS = [
  { value: "files", label: "Filename" },
  { value: "text", label: "Text" },
] as const;

const TEXT_SEARCH_FLAG_TOGGLES: ReadonlyArray<{
  flag: keyof TextSearchFlags;
  label: string;
  title: string;
  className?: string;
}> = [
  { flag: "caseSensitive", label: "Aa", title: "Match case" },
  { flag: "wholeWord", label: "ab", title: "Match whole word", className: "underline underline-offset-2" },
  { flag: "regex", label: ".*", title: "Use regular expression", className: "font-mono" },
];

const EMPTY_COLLAPSED: ReadonlySet<string> = new Set();

function fileMatchToNode(file: TextSearchFileMatch): FileNode {
  const name = file.fullPath.split("/").pop() ?? file.fullPath;
  const dot = name.lastIndexOf(".");
  return {
    name,
    fullPath: file.fullPath,
    type: "file",
    extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined,
  };
}

type TreeState = {
  tree: FileNode | null;
  isLoading: boolean;
  error: string | null;
  stats: { files: number; directories: number } | null;
};

type TreeAction =
  | { type: "loading" }
  | { type: "loaded"; tree: FileNode; stats: { files: number; directories: number } }
  | { type: "error"; error: string };

function treeReducer(_: TreeState, action: TreeAction): TreeState {
  switch (action.type) {
    case "loading":
      return { tree: null, isLoading: true, error: null, stats: null };
    case "loaded":
      return { tree: action.tree, isLoading: false, error: null, stats: action.stats };
    case "error":
      return { tree: null, isLoading: false, error: action.error, stats: null };
  }
}

type SearchState = {
  entries: DirEntry[];
  loading: boolean;
  error: string | null;
};

type SearchAction =
  | { type: "search_start" }
  | { type: "search_success"; entries: DirEntry[] }
  | { type: "search_error"; error: string };

function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case "search_start":
      return { ...state, loading: true, error: null };
    case "search_success":
      return { entries: action.entries, loading: false, error: null };
    case "search_error":
      return { entries: [], loading: false, error: action.error };
  }
}

export const FileExplorer = memo(function FileExplorer({
  rootPath,
  onFileSelect,
  onDirectorySelect,
  onAddToContext,
  selectedPath = null,
  expandedPaths = EMPTY_EXPANDED,
  onToggleExpand = noopToggle,
  onCollapseAll,
  // VS Code parity: dotfiles visible; the service's default exclude list
  // (VCS internals, OS metadata) is the only filter.
  includeHidden = true,
  excludePatterns,
  className = "",
}: FileExplorerProps) {
  const [{ tree, isLoading, error }, dispatch] = useReducer(treeReducer, {
    tree: null,
    isLoading: true,
    error: null,
    stats: null,
  });

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [{ entries: searchEntries, loading: searchLoading, error: searchError }, dispatchSearch] =
    useReducer(searchReducer, { entries: [], loading: false, error: null });
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const isSearching = query.trim().length > 0;

  const [searchMode, setSearchMode] = useState<SearchMode>("files");
  const [textFlags, setTextFlags] = useState<TextSearchFlags>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const textSearch = useTextSearch({
    rootPath,
    query,
    flags: textFlags,
    includeHidden,
    maxResults: MAX_TEXT_SEARCH_LINES,
    enabled: searchMode === "text",
  });
  // Collapsed files belong to the result they were collapsed in; a new
  // result starts fully expanded without resetting any state.
  const [collapsed, setCollapsed] = useState<{
    result: TextSearchResult | null;
    paths: ReadonlySet<string>;
  }>({ result: null, paths: EMPTY_COLLAPSED });
  const collapsedFiles =
    collapsed.result === textSearch.result ? collapsed.paths : EMPTY_COLLAPSED;
  const { rows: textRows, hits: textHits } = useMemo(
    () => buildTextSearchRows(textSearch.result?.files ?? [], collapsedFiles),
    [textSearch.result, collapsedFiles],
  );
  const toggleCollapsedFile = useCallback(
    (fullPath: string) => {
      const next = new Set(collapsedFiles);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      setCollapsed({ result: textSearch.result, paths: next });
    },
    [collapsedFiles, textSearch.result],
  );

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Bumped by the reload button: re-runs the root listing; expanded folders
  // re-fetch themselves via FileTreeNode's lazy-load effect.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadTree() {
      dispatch({ type: "loading" });

      try {
        const result: ServiceResponse<DirEntry[]> =
          await appApi.fileExplorer.listDir({
            dirPath: rootPath,
            includeHidden,
            excludePatterns,
          });

        if (cancelled) return;

        if (result.success) {
          const rootName = rootPath.split("/").pop() || rootPath;
          const children = result.data.map(dirEntryToFileNode);

          let fileCount = 0;
          let dirCount = 0;
          for (const entry of result.data) {
            if (entry.type === "file") fileCount++;
            else dirCount++;
          }

          dispatch({
            type: "loaded",
            tree: {
              name: rootName,
              fullPath: rootPath,
              type: "directory",
              hasChildren: children.length > 0,
              children,
            },
            stats: { files: fileCount, directories: dirCount },
          });
        } else {
          dispatch({ type: "error", error: result.error });
        }
      } catch (err: unknown) {
        if (cancelled) return;
        console.error("[FileExplorer] Exception loading tree:", err);
        dispatch({
          type: "error",
          error: err instanceof globalThis.Error ? err.message : "Unknown error",
        });
      }
    }

    loadTree();

    return () => {
      cancelled = true;
    };
  }, [rootPath, includeHidden, excludePatterns, reloadToken]);

  // Debounced workspace-wide filename search (same backend as the "@" menu).
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || searchMode !== "files") return;

    let cancelled = false;
    dispatchSearch({ type: "search_start" });

    const timeoutId = window.setTimeout(() => {
      appApi.fileExplorer
        .searchFiles({
          rootPath,
          query: trimmed,
          max: MAX_SEARCH_MATCHES,
          includeHidden,
          excludePatterns,
        })
        .then((result: ServiceResponse<DirEntry[]>) => {
          if (cancelled) return;
          if (result.success) {
            dispatchSearch({ type: "search_success", entries: result.data });
          } else {
            dispatchSearch({ type: "search_error", error: result.error });
          }
        })
        .catch((err: Error) => {
          if (!cancelled) {
            dispatchSearch({ type: "search_error", error: err.message });
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [query, searchMode, rootPath, includeHidden, excludePatterns]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, searchMode, textFlags]);

  // Keep the keyboard-active result visible while arrowing through the list.
  useEffect(() => {
    if (!isSearching) return;
    resultsRef.current
      ?.querySelector('[data-search-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isSearching]);

  const handleSelect = useCallback(
    (node: FileNode) => {
      if (node.type === "file" && onFileSelect) {
        onFileSelect(node);
      } else if (node.type === "directory" && onDirectorySelect) {
        onDirectorySelect(node);
      }
    },
    [onFileSelect, onDirectorySelect],
  );

  const handleExpand = useCallback(
    async (node: FileNode): Promise<FileNode[] | undefined> => {
      try {
        const result: ServiceResponse<DirEntry[]> =
          await appApi.fileExplorer.listDir({
            dirPath: node.fullPath,
            includeHidden,
            excludePatterns,
          });

        if (result.success) {
          return result.data.map(dirEntryToFileNode);
        } else {
          console.error("[FileExplorer] Failed to expand:", result.error);
        }
      } catch (err) {
        console.error("[FileExplorer] Failed to load directory:", err);
      }
      return undefined;
    },
    [includeHidden, excludePatterns],
  );

  const handleOpenHit = useCallback(
    (hit: TextSearchHit) => {
      onFileSelect?.(fileMatchToNode(hit.file), revealTargetForHit(hit));
    },
    [onFileSelect],
  );

  const handleAddFileMatchToContext = useCallback(
    (file: TextSearchFileMatch) => onAddToContext?.(fileMatchToNode(file)),
    [onAddToContext],
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (isSearching) setQuery("");
        else searchInputRef.current?.blur();
        return;
      }
      if (!isSearching) return;
      const resultCount =
        searchMode === "text" ? textHits.length : searchEntries.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(resultCount - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (searchMode === "text") {
          const hit = textHits[activeIndex] ?? textHits[0];
          if (hit) handleOpenHit(hit);
        } else {
          const entry = searchEntries[activeIndex] ?? searchEntries[0];
          if (entry) handleSelect(dirEntryToFileNode(entry));
        }
      }
    },
    [isSearching, searchMode, textHits, searchEntries, activeIndex, handleSelect, handleOpenHit],
  );

  const handleAddToContext = useCallback(
    (e: React.MouseEvent, entry: DirEntry) => {
      e.stopPropagation();
      onAddToContext?.(dirEntryToFileNode(entry));
    },
    [onAddToContext],
  );

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="flex flex-col items-center gap-2 ">
          <Caption className="shine-text ">Loading...</Caption>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <Text as="div" size="inherit" tone="danger" align="center" className="flex flex-col items-center gap-2 px-4">
          <Text as="span" size="sm" tone="inherit">{error}</Text>
        </Text>
      </div>
    );
  }

  if (!tree) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <Text as="span" size="sm" tone="subtle">
          No files found
        </Text>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="flex items-center gap-1 shrink-0 mb-1">
        <div className="relative flex-1 min-w-0 glass-outline rounded-xl bg-transparent dark:bg-primary/5">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary-600 dark:text-primary-400 pointer-events-none" />
          <Input
            variant="bare"
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            // Names the scope, not the fields: the Filename/Text switch only
            // shows once a query is typed, and "workspace" covers both.
            placeholder="Search workspace"
            aria-label="Search files"
            spellCheck={false}
            className="w-full h-7 pl-7 pr-7 text-s bg-transparent text-primary-900 dark:text-primary-100 placeholder:text-primary-700 dark:placeholder:text-primary-300 outline-none transition-colors"
          />
          {isSearching && (
            <Button
              onClick={() => {
                setQuery("");
                searchInputRef.current?.focus();
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded cursor-pointer hover:bg-primary/20 dark:hover:bg-primary/10"
              title="Clear search"
            >
              <Close className="w-3 h-3 text-primary-600 dark:text-primary-400" />
            </Button>
          )}
        </div>
        <Button
          onClick={() => setReloadToken((t) => t + 1)}
          className="w-5 h-5 shrink-0 flex items-center justify-center rounded-lg cursor-pointer hover:bg-primary/20 dark:hover:bg-primary/10"
          title="Refresh explorer"
        >
          <Refresh className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400" />
        </Button>
        {onCollapseAll && (
          <Button
            onClick={onCollapseAll}
            className="w-5 h-5 shrink-0 flex items-center justify-center rounded-lg cursor-pointer hover:bg-primary/20 dark:hover:bg-primary/10"
            title="Collapse all folders"
          >
            <CollapseAll className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400" />
          </Button>
        )}
      </div>

      {isSearching && (
        // preventDefault on mousedown keeps focus in the search input, so the
        // arrow keys keep walking results after a mode or option click.
        <div
          className="flex items-center gap-1 shrink-0 mb-1"
          onMouseDown={(e) => e.preventDefault()}
        >
          <SegmentedTabs
            value={searchMode}
            onChange={setSearchMode}
            options={SEARCH_MODE_OPTIONS}
            semantics="radiogroup"
            aria-label="Search in"
            className="w-40 shrink-0"
          />
          {searchMode === "text" && (
            <div className="ml-auto flex items-center gap-0.5">
              {TEXT_SEARCH_FLAG_TOGGLES.map(({ flag, label, title, className: labelClass }) => (
                <Button
                  key={flag}
                  aria-pressed={textFlags[flag]}
                  title={title}
                  onClick={() =>
                    setTextFlags((flags) => ({ ...flags, [flag]: !flags[flag] }))
                  }
                  className={`h-6 min-w-6 px-1 flex items-center justify-center rounded-lg text-xs cursor-pointer transition-colors ${
                    textFlags[flag]
                      ? "bg-accent/15 text-accent"
                      : "text-primary-600 dark:text-primary-400 hover:bg-primary/20 dark:hover:bg-primary/10"
                  }`}
                >
                  <span className={labelClass}>{label}</span>
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {isSearching && searchMode === "text" ? (
        <div
          ref={resultsRef}
          role="tree"
          aria-label="Content search results"
          className="flex-1 overflow-auto py-1 space-y-0.5 noscrollbar"
        >
          {textSearch.error ? (
            <Text as="div" size="xs" tone="danger" className="px-2 py-2">{textSearch.error}</Text>
          ) : !textSearch.result || textSearch.result.files.length === 0 ? (
            <Text as="div" size="xs" tone="subtle" className="px-2 py-2">
              {textSearch.loading || !textSearch.result ? "Searching…" : "No matches"}
            </Text>
          ) : (
            <>
              <Text
                as="div"
                size="xxs"
                tone="subtle"
                className={`px-2 pb-1 ${textSearch.loading ? "shine-text" : ""}`}
              >
                {describeTextSearchResult(
                  textSearch.result.matchCount,
                  textSearch.result.files.length,
                )}
              </Text>
              <TextSearchRows
                rows={textRows}
                activeHitIndex={activeIndex}
                onToggleFile={toggleCollapsedFile}
                onOpenHit={handleOpenHit}
                onHoverHit={setActiveIndex}
                onAddToContext={onAddToContext ? handleAddFileMatchToContext : undefined}
              />
              {textSearch.result.truncated && (
                <Text as="div" size="xxs" tone="subtle" className="px-2 pt-1">
                  Search stopped early — narrow it to see every match.
                </Text>
              )}
            </>
          )}
        </div>
      ) : isSearching ? (
        <div
          ref={resultsRef}
          role="listbox"
          aria-label="File search results"
          className="flex-1 overflow-auto py-1 space-y-0.5 noscrollbar"
        >
          {searchError ? (
            <Text as="div" size="xs" tone="subtle" className="px-2 py-2">{searchError}</Text>
          ) : searchEntries.length === 0 ? (
            <Text as="div" size="xs" tone="subtle" className="px-2 py-2">
              {searchLoading ? "Searching…" : "No matches"}
            </Text>
          ) : (
            <>
              {searchEntries.map((entry, index) => {
                const isActive = index === activeIndex;
                const isSelected = selectedPath === entry.fullPath;
                const dir = relativeDir(entry.fullPath, rootPath);
                return (
                  <div
                    key={entry.fullPath}
                    role="option"
                    aria-selected={isSelected}
                    data-search-active={isActive ? "true" : undefined}
                    onClick={() => handleSelect(dirEntryToFileNode(entry))}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`
                      group flex items-center h-7 px-1 cursor-pointer text-s
                      transition-colors duration-75 rounded-xl mb-0.5
                      ${
                        isSelected
                          ? "bg-primary/80 dark:bg-primary/5 text-primary-950 dark:text-primary glass-outline"
                          : isActive
                            ? "bg-primary/20 dark:bg-primary/5 text-primary-900 dark:text-primary-100"
                            : "text-primary-900 dark:text-primary-100"
                      }
                    `}
                  >
                    <FileIconComponent
                      extension={entry.extension}
                      fileName={entry.name}
                      isDirectory={false}
                      className="w-4 h-4 shrink-0 mr-1.5"
                    />
                    <span className="truncate shrink-0 max-w-[60%]">{entry.name}</span>
                    {dir && (
                      <Text as="span" size="xs" tone="subtle" className="truncate ml-2">
                        {dir}
                      </Text>
                    )}
                    {onAddToContext && (
                      <Button
                        onClick={(e: React.MouseEvent) => handleAddToContext(e, entry)}
                        className="opacity-0 group-hover:opacity-100 ml-auto w-5 h-5 flex items-center justify-center rounded hover:bg-primary/20 dark:hover:bg-primary/10 transition-opacity mr-1 shrink-0"
                        title="Add to context"
                      >
                        <Plus className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400" />
                      </Button>
                    )}
                  </div>
                );
              })}
              {searchEntries.length >= MAX_SEARCH_MATCHES && (
                <Text as="div" size="xxs" tone="subtle" className="px-2 pt-1">
                  Showing first {MAX_SEARCH_MATCHES} matches — narrow your search for more.
                </Text>
              )}
            </>
          )}
        </div>
      ) : (
        <div
          role="tree"
          aria-label="File explorer"
          className="flex-1 overflow-auto  space-y-0.5 noscrollbar"
        >
          {tree.children?.map((child, index) => (
            <FileTreeNode
              key={child.fullPath}
              node={child}
              depth={0}
              index={index}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              onSelect={handleSelect}
              onExpand={handleExpand}
              onAddToContext={onAddToContext}
            />
          ))}
        </div>
      )}
    </div>
  );
});
