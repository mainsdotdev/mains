import { useState, useRef, type MouseEvent } from "react";
import { Button, DropdownMenu, DropdownMenuItem } from "@/components/ui";
import { Layers } from "@/components/ui/icons";

export type GroupingMode = "none" | "status" | "project";

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
        ref={buttonRef}
        tooltip="Group workspaces"
        tooltipPosition="top"
        aria-label="Group workspaces"
        onClick={handleClick}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={` ${grouping !== "none" ? "bg-primary-100/80 dark:bg-primary/5" : " "} p-1 rounded-md cursor-pointer hover:bg-primary-100/80 dark:hover:bg-primary/10 transition-colors`}
      >
        <Layers
          className="w-3.5 h-3.5 transition-colors text-primary-800 dark:text-primary-200"

        />
      </Button>

      <DropdownMenu
        isOpen={isOpen}
        aria-label="Workspace grouping"
        position={position}
        onClose={() => setIsOpen(false)}
        minWidth={140}
      >
        <DropdownMenuItem onClick={() => handleSelect("none")} selected={grouping === "none"}>
          Default
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleSelect("status")} selected={grouping === "status"}>
          By status
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleSelect("project")} selected={grouping === "project"}>
          By project
        </DropdownMenuItem>
      </DropdownMenu>
    </>
  );
}
