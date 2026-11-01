import { useState, useRef, type MouseEvent } from "react";
import { Button, DropdownMenu, DropdownMenuItem } from "@/components/ui";
import { Layers } from "@/components/ui/icons";
import type { WorkspaceListSources } from "@/lib/redux/slices/appSettingsSlice";
import { SourceFilterSubmenu } from "./source-filter-menu";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setDeveloperSidebarView } from "@/lib/redux/slices/appSettingsSlice";

export type GroupingMode = "none" | "project";

interface WorkspaceGroupDropdownProps {
  grouping: GroupingMode;
  onGroupingChange: (mode: GroupingMode) => void;
  sources: WorkspaceListSources;
  onSourceVisibleChange: (
    source: keyof WorkspaceListSources,
    visible: boolean,
  ) => void;
}

function MenuSeparator() {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className="mx-1.5 my-1 h-px bg-primary-200/70 dark:bg-primary-700/40"
    />
  );
}

export function WorkspaceGroupDropdown({
  grouping,
  onGroupingChange,
  sources,
  onSourceVisibleChange,
}: WorkspaceGroupDropdownProps) {
  const dispatch = useAppDispatch();
  const view = useAppSelector((state) => state.appSettings.developerSidebarView ?? "workspaces");
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sourcesFiltered = !sources.local || !sources.bridge;

  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        x: Math.min(rect.left + 12, window.innerWidth - 180),
        y: rect.bottom,
      });
    }
    setIsOpen(!isOpen);
  };

  const handleSelect = (mode: GroupingMode) => {
    onGroupingChange(mode);
    setIsOpen(false);
  };

  return (
    <>
      <Button
        variant="icon"
        iconSize="sm"
        ref={buttonRef}
        tooltip="Sidebar view"
        tooltipPosition="top"
        aria-label="Sidebar view"
        onClick={handleClick}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={
          view === "chats" || grouping === "none" || sourcesFiltered
            ? "rounded-[10px] bg-primary-200/60 text-primary-800 dark:bg-primary/10 dark:text-primary-200 dark:enabled:hover:bg-primary/15"
            : undefined
        }
      >
        <Layers className="w-3.5 h-3.5 transition-colors" />
      </Button>

      <DropdownMenu
        isOpen={isOpen}
        aria-label="Sidebar view"
        position={position}
        onClose={() => setIsOpen(false)}
        minWidth={160}
      >
        <DropdownMenuItem selected={view === "workspaces"} onClick={() => {
          dispatch(setDeveloperSidebarView("workspaces")); setIsOpen(false);
        }}>Workspaces</DropdownMenuItem>
        <DropdownMenuItem selected={view === "chats"} onClick={() => {
          dispatch(setDeveloperSidebarView("chats")); setIsOpen(false);
        }}>Chats by project</DropdownMenuItem>
        <MenuSeparator />
        {view === "workspaces" && <><DropdownMenuItem
          onClick={() => handleSelect("project")}
          selected={grouping === "project"}
        >
          By project
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleSelect("none")}
          selected={grouping === "none"}
        >
          In one list
        </DropdownMenuItem>
        <MenuSeparator /></>}
        <SourceFilterSubmenu
          aligned
          sources={sources}
          onSourceVisibleChange={onSourceVisibleChange}
        />
      </DropdownMenu>
    </>
  );
}
