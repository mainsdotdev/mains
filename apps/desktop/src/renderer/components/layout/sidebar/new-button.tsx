import { useRef, useState } from "react";
import { Button, Caption, DropdownMenu, DropdownMenuItem, Text } from "@/components/ui";
import { useKeyboardShortcut } from "@/providers/keyboard-shortcuts-provider";

interface NewButtonProps {
  onClick: () => void;
  title: string;
  actionPrefix?: string;
  icon?: React.ReactNode;
  shortcutLabel?: string;
  dropdownItems?: { label: string; icon?: React.ReactNode; shortcutLabel?: string; onClick: () => void }[];
}

export default function NewButton({
  onClick,
  title,
  icon,
  actionPrefix = "New",
  shortcutLabel,
  dropdownItems,
}: NewButtonProps) {
  const [menuState, setMenuState] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
  }>({ isOpen: false, position: { x: 0, y: 0 } });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    if (dropdownItems && dropdownItems.length > 0) {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setMenuState({
          isOpen: true,
          position: { x: rect.right , y: rect.top + 12 },
        });
      }
    } else {
      onClick();
    }
  };

  useKeyboardShortcut("app.newItem", handleClick, {
    allowInEditable: true,
  });

  const handleCloseMenu = () => {
    setMenuState({ isOpen: false, position: { x: 0, y: 0 } });
  };

  return (
    <>
      <Button
        ref={buttonRef}
        tooltip={`${actionPrefix} ${title}`}
        variant="subtle"
        tooltipShortcut={shortcutLabel}
        onClick={handleClick}
        aria-haspopup={dropdownItems ? "menu" : undefined}
        aria-expanded={dropdownItems ? menuState.isOpen : undefined}
        fullWidth
        className="justify-start cursor-pointer transition-transform duration-200 px-2 rounded-xl"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {icon}
        {/* Size comes from `Button` (`text-s`); only the weight is overridden. */}
        <Text as="span" size="inherit" weight="normal">
          {actionPrefix} {title}
        </Text>
        {shortcutLabel && <Caption className="ml-auto">{shortcutLabel}</Caption>}
      </Button>

      {dropdownItems && (
        <DropdownMenu
          isOpen={menuState.isOpen}
          aria-label={`${actionPrefix} ${title}`}
          position={menuState.position}
          onClose={handleCloseMenu}
          minWidth={180}
        >
          {dropdownItems.map((item) => (
            <DropdownMenuItem
              key={item.label}
              onClick={() => {
                item.onClick();
                handleCloseMenu();
              }}
            >
              {item.icon}
              {/* `DropdownMenuItem` owns the row's size, colour, and hover
                  colour — the label inherits all three. */}
              <span className="flex-1 text-left">{item.label}</span>
              {item.shortcutLabel && <Caption>{item.shortcutLabel}</Caption>}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
      )}
    </>
  );
}
