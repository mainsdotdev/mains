import { useRef, useState, type MouseEvent } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSub,
} from "@/components/ui";
import { Bridge, DeviceLaptop, Layers } from "@/components/ui/icons";
import type { WorkspaceListSources } from "@/lib/redux/slices/appSettingsSlice";

interface SourceFilterProps {
  sources: WorkspaceListSources;
  onSourceVisibleChange: (
    source: keyof WorkspaceListSources,
    visible: boolean,
  ) => void;
}

function SourceChoices({ sources, onSourceVisibleChange }: SourceFilterProps) {
  return (
    <>
      <DropdownMenuItem
        selection="multiple"
        selected={sources.local}
        onClick={() => onSourceVisibleChange("local", !sources.local)}
      >
        <DeviceLaptop className="size-3.5 shrink-0" />
        Local
      </DropdownMenuItem>
      <DropdownMenuItem
        selection="multiple"
        selected={sources.bridge}
        onClick={() => onSourceVisibleChange("bridge", !sources.bridge)}
      >
        <Bridge className="size-3.5 shrink-0" />
        Bridge
      </DropdownMenuItem>
    </>
  );
}

/** Sources row. `aligned` reserves the check column used by sibling radio rows. */
export function SourceFilterSubmenu({
  aligned = false,
  ...props
}: SourceFilterProps & { aligned?: boolean }) {
  return (
    <DropdownMenuSub
      label={
        <>
          {aligned && <span className="size-4 shrink-0" aria-hidden="true" />}
          Sources
        </>
      }
    >
      <SourceChoices {...props} />
    </DropdownMenuSub>
  );
}

/**
 * A filter button whose menu is only Sources for now. More rows can land
 * beside that submenu without changing the button.
 */
export function SourceFilterButton({
  sources,
  onSourceVisibleChange,
}: SourceFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sourcesFiltered = !sources.local || !sources.bridge;

  const handleClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        x: Math.min(rect.left, window.innerWidth - 180),
        y: rect.bottom,
      });
    }
    setIsOpen(!isOpen);
  };

  return (
    <>
      <Button
        variant="icon"
        iconSize="sm"
        ref={buttonRef}
        tooltip="Filter chats"
        tooltipPosition="top"
        aria-label="Filter chats"
        onClick={handleClick}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={
          sourcesFiltered ? "bg-primary-100 dark:bg-primary-900" : undefined
        }
      >
        <Layers className="w-3.5 h-3.5 transition-colors" />
      </Button>
      <DropdownMenu
        isOpen={isOpen}
        aria-label="Chat filters"
        position={position}
        onClose={() => setIsOpen(false)}
        minWidth={160}
      >
        <SourceFilterSubmenu
          sources={sources}
          onSourceVisibleChange={onSourceVisibleChange}
        />
      </DropdownMenu>
    </>
  );
}
