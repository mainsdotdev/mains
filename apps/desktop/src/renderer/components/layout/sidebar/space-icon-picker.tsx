import { useRef } from "react";
import { useClickOutside } from "@/hooks/use-click-outside";
import { iconRegistry, iconTintClass } from "@/lib/icon-registry";
import { Button } from "@/components/ui";
import { Close, SelectOption } from "@/components/ui/icons";
import { IconPickerPanel, type IconPickerMode } from "./icon-picker-panel";

function CurrentIcon({
  icon,
  iconColor,
}: {
  icon: string;
  iconMode: "emoji" | "icon";
  iconColor?: string;
}) {
  if (!icon) return null;
  // Registry rather than `availableIcons` — an icon already saved on the record
  // must still render even when it is no longer offered in the grid.
  const IconComp = iconRegistry[icon];
  if (IconComp) return <IconComp className={`size-5 ${iconTintClass(iconColor)}`} />;
  return <span>{icon}</span>;
}

interface SpaceIconPickerProps {
  icon: string;
  iconMode: IconPickerMode;
  isOpen: boolean;
  onToggle: () => void;
  onSelectEmoji: (emoji: string) => void;
  onSelectIcon: (name: string) => void;
  onSwitchMode: (mode: IconPickerMode) => void;
  onClose: () => void;
  onClear?: () => void;
  /** Tint applied to registry icons. Omit to hide the color row entirely. */
  iconColor?: string;
  onSelectColor?: (color: string) => void;
}

export default function SpaceIconPicker({
  icon,
  iconMode,
  isOpen,
  onToggle,
  onSelectEmoji,
  onSelectIcon,
  onSwitchMode,
  onClose,
  onClear,
  iconColor,
  onSelectColor,
}: SpaceIconPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);

  useClickOutside(pickerRef, () => {
    if (isOpen) onClose();
  });

  return (
    <div ref={pickerRef} className="relative">
      <Button
        type="button"
        onClick={onToggle}
        className={`
          w-full px-3 py-2
          glass-button
          text-primary-800 dark:text-primary
          text-sm focus:outline-none cursor-pointer
          flex items-center justify-between
          transition-colors
          ${
            isOpen ? "rounded-t-xl shadow-lg" : "rounded-xl"
          }
        `}
      >
        <div className="flex items-center gap-2 min-w-60">
          {onClear && icon ? (
            <span className="group/icon relative flex items-center justify-center size-5">
              <span className="group-hover/icon:opacity-0 transition-opacity">
                <CurrentIcon icon={icon} iconMode={iconMode} iconColor={iconColor} />
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    e.preventDefault();
                    onClear();
                  }
                }}
                className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/icon:opacity-100 transition-opacity cursor-pointer"
              >
                <Close className="size-4 text-primary-600 dark:text-primary-400" />
              </span>
            </span>
          ) : (
            <CurrentIcon icon={icon} iconMode={iconMode} />
          )}
          <span>{icon ? "Change Icon" : "Choose an Icon"}</span>
        </div>
        <SelectOption
          className={`size-3 text-primary-900 dark:text-primary-100`}
        />
      </Button>

      <IconPickerPanel
        icon={icon}
        iconMode={iconMode}
        isOpen={isOpen}
        onSelectEmoji={onSelectEmoji}
        onSelectIcon={onSelectIcon}
        onSwitchMode={onSwitchMode}
        iconColor={iconColor}
        onSelectColor={onSelectColor}
      />
    </div>
  );
}
