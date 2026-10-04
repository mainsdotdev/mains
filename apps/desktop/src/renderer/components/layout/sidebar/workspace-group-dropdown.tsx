import { useState, useRef, type MouseEvent } from "react";
import { Button, DropdownMenu, DropdownMenuItem } from "@/components/ui";
import { Layers } from "@/components/ui/icons";

export type GroupingMode = "none" | "project";

interface WorkspaceGroupDropdownProps {
  grouping: GroupingMode;
  onGroupingChange: (mode: GroupingMode) => void;
}

export function WorkspaceGroupDropdown({
  grouping,
  onGroupingChange,
}: WorkspaceGroupDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

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
        tooltip="Group workspaces"
        tooltipPosition="top"
        aria-label="Group workspaces"
        onClick={handleClick}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={grouping === "none" ? "bg-primary-100 dark:bg-primary-900" : undefined}
      >
        <Layers
          className="w-3.5 h-3.5 transition-colors"

        />
      </Button>

      <DropdownMenu
        isOpen={isOpen}
        aria-label="Workspace grouping"
        position={position}
        onClose={() => setIsOpen(false)}
        minWidth={140}
      >
        <DropdownMenuItem onClick={() => handleSelect("project")} selected={grouping === "project"}>
          By project
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleSelect("none")} selected={grouping === "none"}>
          In one list
        </DropdownMenuItem>
      </DropdownMenu>
    </>
  );
}
