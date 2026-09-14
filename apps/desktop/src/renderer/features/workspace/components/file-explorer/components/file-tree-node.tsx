import { memo, useState, useCallback, useEffect, useRef } from "react";
import type { FileNode } from "@/features/workspace/types/file-explorer";
import { FileIconComponent } from "@/components/ui/icons";
import { ArrowUp, Plus } from "@/components/ui/icons";
import { Button } from "@/components/ui";

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  /** Controlled expansion — lives in Redux so it survives explorer remounts. */
  expandedPaths: ReadonlySet<string>;
  onToggleExpand: (path: string) => void;
  onSelect: (node: FileNode) => void;
  onExpand?: (node: FileNode) => Promise<FileNode[] | undefined>;
  onAddToContext?: (node: FileNode) => void;
  index?: number;
}

export const FileTreeNode = memo(function FileTreeNode({
  node,
  depth,
  selectedPath,
  expandedPaths,
  onToggleExpand,
  onSelect,
  onExpand,
  index,
  onAddToContext,
}: FileTreeNodeProps) {
  const [children, setChildren] = useState<FileNode[] | undefined>(
    node.children,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [childrenLoaded, setChildrenLoaded] = useState(
    node.children !== undefined && node.children.length > 0,
  );
  const rowRef = useRef<HTMLDivElement | null>(null);

  const isDirectory = node.type === "directory";
  const isExpanded = isDirectory && expandedPaths.has(node.fullPath);
  const isSelected = selectedPath === node.fullPath;

  // Lazy-load children whenever this node is expanded without loaded children
  // — covers both the first click and re-expansion after a remount (tab
  // switch / panel toggle), where expansion state comes back from Redux but
  // the fetched children were lost with the component.
  // `isLoading` must stay OUT of the deps: it flips inside this effect, and
  // re-running on it would fire the cleanup mid-fetch and cancel the load.
  useEffect(() => {
    if (!isDirectory || !isExpanded || childrenLoaded || !onExpand) {
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    onExpand(node)
      .then((loadedChildren) => {
        if (cancelled) return;
        setChildren(loadedChildren || []);
        setChildrenLoaded(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
      setIsLoading(false);
    };
  }, [isDirectory, isExpanded, childrenLoaded, onExpand, node]);

  // After a remount, bring the still-selected file back into view.
  useEffect(() => {
    if (isSelected) {
      rowRef.current?.scrollIntoView({ block: "nearest" });
    }
    // Mount-only: re-running on every selection change would fight the user's
    // own scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showChevron =
    isDirectory &&
    (node.hasChildren === true ||
      (node.hasChildren === undefined && !childrenLoaded) ||
      (children !== undefined && children.length > 0));

  const handleClick = useCallback(() => {
    onSelect(node);
    if (isDirectory) {
      onToggleExpand(node.fullPath);
    }
  }, [node, isDirectory, onSelect, onToggleExpand]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  const handleAddToContext = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onAddToContext && node.type === "file") {
        onAddToContext(node);
      }
    },
    [node, onAddToContext],
  );

  const paddingLeft = 0 + depth * 12;

  return (
    <div className="select-none space-y-0.5">
      <div
        ref={rowRef}
        role="treeitem"
        tabIndex={0}
        aria-expanded={isDirectory ? isExpanded : undefined}
        aria-selected={isSelected}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={`
          group flex items-center h-7 cursor-pointer text-s
          transition-colors duration-75 rounded-xl mb-0.5
          ${
            isSelected
              ? "bg-primary/80 dark:bg-primary/5 text-primary-950 dark:text-primary glass-outline"
              : "text-primary-900 dark:text-primary-100 hover:bg-primary/20 dark:hover:bg-primary/5"
          } ${index ? `animate-slide-in` : ""}
        `}
        style={{ paddingLeft, animationDelay: `${index ? index * 0.01 : 0}s` }}
      >
        <span className="w-4 h-4 flex items-center justify-center shrink-0">
          {isDirectory && showChevron && (
            <ArrowUp
              className={`
                w-3 h-3 text-primary-600 dark:text-primary-400
                transition-transform duration-150
                ${isExpanded ? "rotate-180" : "rotate-90"}
              `}
            />
          )}
        </span>

        <FileIconComponent
          extension={node.extension}
          fileName={node.name}
          isDirectory={isDirectory}
          isExpanded={isExpanded}
          className="w-4 h-4 shrink-0 mr-1.5"
        />

        <span className="truncate flex-1">{node.name}</span>

        {!isDirectory && onAddToContext && (
          <Button
            onClick={handleAddToContext}
            className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded hover:bg-primary/20 dark:hover:bg-primary/10 transition-opacity mr-1"
            title="Add to context"
          >
            <Plus className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400" />
          </Button>
        )}

        {isLoading && (
          <span className="ml-2 w-3 h-3 border border-primary-400 border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {isDirectory && isExpanded && children && children.length > 0 && (
        <div role="group">
          {children.map((child) => (
            <FileTreeNode
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              onExpand={onExpand}
              onAddToContext={onAddToContext}
            />
          ))}
        </div>
      )}
    </div>
  );
});
