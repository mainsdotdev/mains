import { useState, useRef, type MouseEvent } from "react";
import { Button, DropdownMenu, DropdownMenuItem } from "@/components/ui";
import { Layers } from "@/components/ui/icons";
import type { WorkspaceListSources } from "@/lib/redux/slices/appSettingsSlice";
import { SourceFilterSubmenu } from "./source-filter-menu";

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
        tooltip="Workspace list"
        tooltipPosition="top"
        aria-label="Workspace list"
        onClick={handleClick}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={
          grouping === "none" || sourcesFiltered
            ? "bg-primary-100 dark:bg-primary-900"
            : undefined
        }
      >
        <Layers className="w-3.5 h-3.5 transition-colors" />
      </Button>

      <DropdownMenu
        isOpen={isOpen}
        aria-label="Workspace list"
        position={position}
        onClose={() => setIsOpen(false)}
        minWidth={160}
      >
        <DropdownMenuItem
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
        <MenuSeparator />
        <SourceFilterSubmenu
          aligned
          sources={sources}
          onSourceVisibleChange={onSourceVisibleChange}
        />
      </DropdownMenu>
    </>
  );
}
