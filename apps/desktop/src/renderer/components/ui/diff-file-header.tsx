import { forwardRef } from "react";
import { Button } from "./button";
import { ArrowUp, Chat, FileIconComponent } from "./icons";

export type DiffFileHeaderStatus = "A" | "D" | "R" | "M";

interface DiffFileHeaderProps {
  path: string;
  previousPath?: string;
  status: DiffFileHeaderStatus;
  additions: number;
  deletions: number;
  expanded: boolean;
  onToggle: () => void;
  commentCount?: number;
  muted?: boolean;
}

/** File identity and change stats, shared by workspace review and PR diffs. */
export const DiffFileHeader = forwardRef<HTMLButtonElement, DiffFileHeaderProps>(function DiffFileHeader({
  path, previousPath, status, additions, deletions, expanded, onToggle, commentCount = 0, muted = false,
}, ref) {
  return <Button ref={ref} type="button" aria-label={`Toggle changes in ${path}`} aria-expanded={expanded} onClick={onToggle}
    className="flex min-w-0 flex-1 items-center gap-2.5 px-4 py-3 text-left text-xs">
    <ArrowUp className={`size-3.5 shrink-0 text-primary-500 transition-transform ${expanded ? "rotate-180" : "rotate-90"}`} />
    <FileIconComponent fileName={path} className="size-4 shrink-0" />
    <span className={`min-w-0 flex-1 truncate ${muted ? "text-primary-500" : "text-primary-900 dark:text-primary-100"}`} title={path}>
      {previousPath && <span className="text-primary-500">{previousPath} → </span>}{path}
    </span>
    {commentCount > 0 && <span className="flex shrink-0 items-center gap-1 text-primary-500"><Chat className="size-3" />{commentCount}</span>}
    <span className="shrink-0 text-primary-500">{status}</span>
    <span className="shrink-0 tabular-nums text-success">+{additions}</span>
    <span className="shrink-0 tabular-nums text-danger">-{deletions}</span>
  </Button>;
});
