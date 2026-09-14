import { BookOpen, Feed, External, Bug } from "@/components/ui/icons";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui";

interface HelpMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
}

export default function HelpMenu({ isOpen, position, onClose }: HelpMenuProps) {
  const adjustedPosition = {
    x: Math.max(8, Math.min(position.x - 60, window.innerWidth - 220)),
    y: Math.max(8, position.y - 115),
  };

  const handleOpenExternal = (url: string) => {
    window.api.shell.openExternal(url);
    onClose();
  };

  return (
    <DropdownMenu
      isOpen={isOpen}
      aria-label="Help"
      position={adjustedPosition}
      onClose={onClose}
      minWidth={180}
    >
      <div className="">
        <DropdownMenuItem
          onClick={() => handleOpenExternal("https://github.com/mainsdotdev/mains/issues")}
        >
          <Bug className="size-4 shrink-0" />
          <span className="flex-1 text-left">Report a Bug</span>
          <External className="size-3 text-primary-900 dark:text-primary-100" />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleOpenExternal("https://docs.mains.dev")}
        >
          <BookOpen className="size-4 shrink-0" />
          <span className="flex-1 text-left">Docs</span>
          <External className="size-3 text-primary-900 dark:text-primary-100" />
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() =>
            handleOpenExternal(
              "https://mains.dev/blog?filter=changelog",
            )
          }
        >
          <Feed className="size-4 shrink-0" />
          <span className="flex-1 text-left">Changelog</span>
          <External className="size-3 text-primary-900 dark:text-primary-100" />
        </DropdownMenuItem>
      </div>
    </DropdownMenu>
  );
}
