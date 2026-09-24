import { memo } from "react";
import type { TextSearchFileMatch } from "@mains/contracts/text-search";
import { FileIconComponent } from "@/components/ui/icons";
import { ArrowUp, Plus } from "@/components/ui/icons";
import { Button, Text } from "@/components/ui";
import {
  previewSegments,
  type TextSearchHit,
  type TextSearchRow,
} from "@/features/workspace/lib/text-search";

interface TextSearchRowsProps {
  rows: readonly TextSearchRow[];
  /** Keyboard/hover position among the visible hits. */
  activeHitIndex: number;
  onToggleFile: (fullPath: string) => void;
  onOpenHit: (hit: TextSearchHit) => void;
  onHoverHit: (hitIndex: number) => void;
  onAddToContext?: (file: TextSearchFileMatch) => void;
}

function splitRelativePath(relativePath: string) {
  const slash = relativePath.lastIndexOf("/");
  const name = slash === -1 ? relativePath : relativePath.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  return {
    name,
    dir: slash === -1 ? "" : relativePath.slice(0, slash),
    extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined,
  };
}

/**
 * Content-search results as tree rows: a file row (click to collapse) and one
 * row per matching line, with the matches marked. Rendered inside the
 * explorer's results container, which owns scrolling and keyboard focus.
 */
export const TextSearchRows = memo(function TextSearchRows({
  rows,
  activeHitIndex,
  onToggleFile,
  onOpenHit,
  onHoverHit,
  onAddToContext,
}: TextSearchRowsProps) {
  return (
    <>
      {rows.map((row) => {
        if (row.kind === "file") {
          const { file, collapsed, matchCount } = row;
          const { name, dir, extension } = splitRelativePath(file.relativePath);
          return (
            <div
              key={`file:${file.fullPath}`}
              role="treeitem"
              aria-level={1}
              aria-expanded={!collapsed}
              aria-selected={false}
              onClick={() => onToggleFile(file.fullPath)}
              title={file.relativePath}
              className="group flex items-center h-7 cursor-pointer text-s rounded-xl text-primary-900 dark:text-primary-100 hover:bg-primary/20 dark:hover:bg-primary/5 transition-colors duration-75"
            >
              <span className="w-4 h-4 flex items-center justify-center shrink-0">
                <ArrowUp
                  className={`w-3 h-3 text-primary-600 dark:text-primary-400 transition-transform duration-150 ${
                    collapsed ? "rotate-90" : "rotate-180"
                  }`}
                />
              </span>
              <FileIconComponent
                extension={extension}
                fileName={name}
                isDirectory={false}
                className="w-4 h-4 shrink-0 mr-1.5"
              />
              <span className="truncate shrink-0 max-w-[60%]">{name}</span>
              {dir && (
                <Text as="span" size="xs" tone="subtle" className="truncate ml-2">
                  {dir}
                </Text>
              )}
              <span className="ml-auto flex items-center shrink-0 pl-2 pr-1 gap-1">
                {onAddToContext && (
                  <Button
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      onAddToContext(file);
                    }}
                    className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded hover:bg-primary/20 dark:hover:bg-primary/10 transition-opacity"
                    title="Add to context"
                  >
                    <Plus className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400" />
                  </Button>
                )}
                <Text as="span" size="xxs" tone="subtle" className="tabular-nums">
                  {matchCount}
                </Text>
              </span>
            </div>
          );
        }

        const { hit, hitIndex } = row;
        const isActive = hitIndex === activeHitIndex;
        return (
          <div
            key={`hit:${hit.file.fullPath}:${hit.match.line}`}
            role="treeitem"
            aria-level={2}
            aria-selected={isActive}
            data-search-active={isActive ? "true" : undefined}
            onClick={() => onOpenHit(hit)}
            onMouseEnter={() => onHoverHit(hitIndex)}
            title={`Line ${hit.match.line}`}
            className={`flex items-center h-6 pl-9 pr-2 cursor-pointer text-xs rounded-xl transition-colors duration-75 ${
              isActive
                ? "bg-primary/20 dark:bg-primary/5 text-primary-900 dark:text-primary-100"
                : "text-primary-800 dark:text-primary-200"
            }`}
          >
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">
              {hit.match.previewClipped && "…"}
              {previewSegments(hit.match).map((segment, index) =>
                segment.hit ? (
                  <span
                    key={index}
                    className="rounded-[3px] bg-accent/25 text-primary-950 dark:text-primary-50"
                  >
                    {segment.text}
                  </span>
                ) : (
                  <span key={index}>{segment.text}</span>
                ),
              )}
            </span>
          </div>
        );
      })}
    </>
  );
});
