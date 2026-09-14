import {
  useState,
  useRef,
  useLayoutEffect,
  type MouseEvent,
  type ReactNode,
} from "react";
import NumberFlow from "@number-flow/react";
import {
  Muted,
  Text,
  Button,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSub,
  Input,
  SquareSpinner,
  Tooltip,
} from "@/components/ui";
import {
  Trash,
  Option,
  Connect,
  Archive,
  Settings,
  External,
  OpenWith,
  Edit,
  WorkspaceStatusIcon,
  ProjectFolder,
} from "@/components/ui/icons";
import { useGetInstalledAppsQuery } from "@/lib/redux/api";
import { useGetLatestWorkspaceDiffSummaryQuery } from "@/lib/redux/api/workspaceApi";
//import { formatDate } from "@/lib/format-date";
import { getWorkspaceStatusConfig } from "@/lib/workspace-status";
import type { WorkspaceStatus } from "@/lib/redux/api/workspaceApi";

type GroupingMode = "none" | "status" | "project";

const STATUS_ORDER: WorkspaceStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
  "duplicate",
];

interface WorkspaceItemProps {
  id: string;
  name: string;
  rootPath?: string;
  status?: WorkspaceStatus;
  branch?: string | null;
  /** False once the workspace's folder is gone from disk. */
  pathExists?: boolean;
  updatedAt?: Date;
  isActive?: boolean;
  projectId?: string | null;
  projectIcon?: ReactNode;
  grouping?: GroupingMode;
  onClick?: () => void;
  onDelete?: (e: MouseEvent) => void;
  onLinkIssues?: () => void;
  onArchive?: () => void;
  onSettings?: () => void;
  onStatusChange?: (status: WorkspaceStatus) => void;
  onRenameBranch?: (newBranchName: string) => void;
}

export default function WorkspaceItem({
  id,
  name,
  rootPath,
  status = "todo",
  branch,
  pathExists = true,
  //updatedAt,
  isActive = false,
  projectId,
  projectIcon,
  grouping = "none",
  onClick,
  onDelete,
  onLinkIssues,
  onArchive,
  onSettings,
  onStatusChange,
  onRenameBranch,
}: WorkspaceItemProps) {
  const { data: latestDiff } = useGetLatestWorkspaceDiffSummaryQuery(id);
  const statusConfig = getWorkspaceStatusConfig(status);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  // Detecting installed apps sweeps every `.app` bundle in the main process, so
  // it isn't something to do for a menu that may never open. Start on hover
  // instead of on click — the options button only appears on hover anyway, so
  // the request is already in flight by the time the menu opens. RTKQ dedupes
  // this across every workspace row.
  const [hasHovered, setHasHovered] = useState(false);
  const { data: installedApps = [], isLoading: isLoadingApps } =
    useGetInstalledAppsQuery(undefined, {
      skip: !hasHovered && !isDropdownOpen,
    });
  const [dropdownPosition, setDropdownPosition] = useState({ x: 0, y: 0 });
  const [isRenamingBranch, setIsRenamingBranch] = useState(false);
  const [renameBranchValue, setRenameBranchValue] = useState(branch || "");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const insertions = latestDiff?.stats?.shortstat.match(/(\d+) insertion/)?.[1];
  const deletions = latestDiff?.stats?.shortstat.match(/(\d+) deletion/)?.[1];

  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleOptionClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        x: Math.min(rect.left + 32, window.innerWidth - 150),
        y: rect.bottom - 20,
      });
    }

    setIsDropdownOpen(!isDropdownOpen);
  };

  const handleDeleteClick = () => {
    setIsDropdownOpen(false);
    onDelete?.(undefined as unknown as MouseEvent);
  };

  const handleLinkIssuesClick = () => {
    setIsDropdownOpen(false);
    onLinkIssues?.();
  };

  const handleArchiveClick = () => {
    setIsDropdownOpen(false);
    onArchive?.();
  };

  const handleSettingsClick = () => {
    setIsDropdownOpen(false);
    onSettings?.();
  };

  const handleRenameBranchClick = () => {
    setIsDropdownOpen(false);
    setRenameBranchValue(branch || "");
    setIsRenamingBranch(true);
  };

  const handleRenameBranchConfirm = () => {
    const trimmed = renameBranchValue.trim();
    if (trimmed && trimmed !== branch) {
      onRenameBranch?.(trimmed);
    }
    setIsRenamingBranch(false);
  };

  const handleRenameBranchCancel = () => {
    setIsRenamingBranch(false);
    setRenameBranchValue(branch || "");
  };

  // Layout effect, not a passive one: the same click closes the dropdown, and
  // the menu only keeps its focus restore off when something else already holds
  // focus by the following frame. Focusing here runs inside that commit, so the
  // editor wins the race deterministically instead of being blurred (and
  // blur-committed straight back out of existence).
  useLayoutEffect(() => {
    if (isRenamingBranch && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenamingBranch]);

  return (
    <div className="relative group" onMouseEnter={() => setHasHovered(true)}>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick?.();
          }
        }}
        className={`block  py-1.5
           transition-all duration-200 ease-out cursor-pointer ${grouping !== "project" ? "rounded-2xl px-2.5" : "rounded-xl px-2"} ${
            isActive
              ? "bg-primary/50 glass-outline dark:bg-primary/5 hover:bg-primary/90 dark:hover:bg-primary/10"
              : "bg-transparent group-hover:bg-primary/50 dark:group-hover:bg-primary/5"
          }`}
      >
        <div className="flex flex-col ">
          <div className="flex items-center gap-1 min-w-0 flex-1 mb-0.5 ">
            {grouping !== "project" && (
              <><span className="shrink-0 ">
                {projectIcon ?? (
                  <ProjectFolder className="size-3.5 text-primary-800 dark:text-primary-200" />
                )}
              </span><Text as="span" size="s" tone="contrast" className="truncate">
                  {name}
                </Text></>
            )}

          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              {grouping !== "status" ? (
                <Tooltip content={statusConfig.label} position="top-right">
                  <span
                    title={statusConfig.label}
                    className="shrink-0 flex items-center"
                  >
                    <WorkspaceStatusIcon
                      status={status}
                      className={`size-2.75 ml-0.5 ${statusConfig.iconColor}`}
                    />
                  </span>
                </Tooltip>
              ) : (
                <span className="size-2.75 mr-2 flex items-center" />
              )}
              {!pathExists ? (
                // Replaces the branch line rather than sitting next to it: with
                // no folder there is no branch to show, and the reason the row
                // looks inert is the more useful thing to surface.
                <Tooltip
                  content={`Folder not found: ${rootPath ?? "unknown path"}`}
                  position="top"
                >
                  <Muted
                    size="xs"
                    tone="warning"
                    className={`truncate ${grouping === "status" ? "-ml-1.5" : ""}`}
                  >
                    Folder missing
                  </Muted>
                </Tooltip>
              ) : branch && !isRenamingBranch ? (
                <Muted
                  size="xs"
                  tone="secondary"
                  className={`truncate ${grouping === "status" ? "-ml-1.5" : ""}`}
                >
                  {branch}
                </Muted>
              ) : null}
              {isRenamingBranch && (
                <Input
                  variant="bare"
                  ref={renameInputRef}
                  value={renameBranchValue}
                  onChange={(e) => setRenameBranchValue(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") handleRenameBranchConfirm();
                    if (e.key === "Escape") handleRenameBranchCancel();
                  }}
                  onBlur={handleRenameBranchConfirm}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Branch name"
                  className="text-xs bg-primary/20 dark:bg-primary/10 text-primary-800 dark:text-primary-200 rounded-md px-1 py-0.5 outline-none glass-input w-full max-w-35"
                />
              )}
              {/* {branch && updatedAt && (
                <span className="text-primary-900 text-lg leading-6 dark:text-primary-100">
                  ·
                </span>
              )}
              {updatedAt && (
                <Caption>
                  {formatDate(new Date(updatedAt).toISOString())}
                </Caption>
              )} */}
            </div>
          </div>
        </div>
      </div>

      {/* Diff stats (visible by default, hidden on hover) / Options button (hidden by default, visible on hover) */}
      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 z-(--z-base)">
        {(insertions || deletions) && (
          <Text
            as="span"
            size="t"
            tone="inherit"
            className="flex items-center gap-1 font-mono tabular-nums group-hover:opacity-0 transition-opacity pointer-events-none"
          >
            {insertions && (
              <NumberFlow
                value={parseInt(insertions)}
                prefix="+"
                className="text-success"
              />
            )}
            {deletions && (
              <NumberFlow
                value={parseInt(deletions)}
                prefix="-"
                className="text-danger"
              />
            )}
          </Text>
        )}
        <Button
          tooltip="More options"
          ref={buttonRef}
          onClick={handleOptionClick}
          aria-haspopup="menu"
          aria-expanded={isDropdownOpen}
          className={`absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 cursor-pointer rounded-md`}
          aria-label="Workspace options"
        >
          <Option className="w-5 h-5 text-primary-700 dark:text-primary-300 hover:text-primary-800 dark:hover:text-primary-200" />
        </Button>
      </div>

      {/* Dropdown Menu */}
      <DropdownMenu
        isOpen={isDropdownOpen}
        aria-label="Workspace actions"
        position={dropdownPosition}
        onClose={() => setIsDropdownOpen(false)}
      >
        {rootPath && (isLoadingApps || installedApps.length > 0) && (
          <DropdownMenuSub
            label={
              <>
                <OpenWith className="size-3.5" />
                <span>Open with</span>
              </>
            }
          >
            {isLoadingApps && (
              // Keep the row mounted while detecting so the menu doesn't reflow
              // when the app list lands.
              <DropdownMenuItem onClick={() => {}} disabled>
                <SquareSpinner className="size-3.5" />
                <span>Detecting apps…</span>
              </DropdownMenuItem>
            )}
            {installedApps.map((detectedApp) => (
              <DropdownMenuItem
                key={detectedApp.id}
                onClick={() => {
                  setIsDropdownOpen(false);
                  if (detectedApp.id === "finder") {
                    window.api.shell.openPath(rootPath);
                  } else {
                    window.api.shell.openInApp(detectedApp.id, rootPath);
                  }
                }}
              >
                {detectedApp.icon ? (
                  <img
                    src={detectedApp.icon}
                    alt=""
                    draggable={false}
                    className="size-4 shrink-0 rounded-sm"
                  />
                ) : (
                  <External className="size-4 shrink-0" />
                )}
                <span>{detectedApp.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSub>
        )}
        <DropdownMenuSub
          label={
            <>
              <WorkspaceStatusIcon
                status={status}
                className={`size-3.25 ${statusConfig.iconColor}`}
              />
              <span>Status</span>
            </>
          }
        >
          {STATUS_ORDER.map((s) => {
            const config = getWorkspaceStatusConfig(s);
            return (
              <DropdownMenuItem
                key={s}
                onClick={() => {
                  setIsDropdownOpen(false);
                  onStatusChange?.(s);
                }}
                className={
                  s === status ? "bg-primary-950/10 dark:bg-primary/10" : ""
                }
              >
                <WorkspaceStatusIcon
                  status={s}
                  className={`size-3.5 ${config.iconColor}`}
                />
                <span>{config.label}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuSub>
        {projectId && (
          <DropdownMenuItem onClick={handleSettingsClick}>
            <Settings className="size-3.5" />
            <span>Project settings</span>
          </DropdownMenuItem>
        )}
        {branch && onRenameBranch && (
          <DropdownMenuItem onClick={handleRenameBranchClick}>
            <Edit className="size-3.5" />
            <span>Rename branch</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleLinkIssuesClick}>
          <Connect className="size-3.5" />
          <span>Link resources</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleArchiveClick}>
          <Archive className="size-3.5" />
          <span>Archive</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleDeleteClick} variant="danger">
          <Trash className="size-3.5" />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenu>
    </div>
  );
}
