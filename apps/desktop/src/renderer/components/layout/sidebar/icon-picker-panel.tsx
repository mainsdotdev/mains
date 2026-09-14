import { EmojiPicker } from "frimousse";
import {
  availableIcons,
  iconTintClass,
  DEFAULT_ICON_COLOR,
  ICON_COLORS,
} from "@/lib/icon-registry";
import { Button, Text } from "@/components/ui";
import { Close } from "@/components/ui/icons";

export type IconPickerMode = "emoji" | "icon";

/**
 * The picker's popover body — emoji/icon tabs, the emoji grid, the colour row,
 * and the registry grid. Extracted from `SpaceIconPicker` so a second trigger
 * can open the same panel: the settings rows want a full-width labelled button,
 * a modal wants a compact square one, and neither should own a copy of this.
 *
 * Positioning belongs to the caller — pass the placement classes as
 * `className`; the panel only styles itself.
 */
export function IconPickerPanel({
  icon,
  iconMode,
  isOpen,
  onSelectEmoji,
  onSelectIcon,
  onSwitchMode,
  iconColor,
  onSelectColor,
  onClear,
  className = "absolute top-full left-0 right-0 rounded-b-xl border-t-0",
}: {
  icon: string;
  iconMode: IconPickerMode;
  isOpen: boolean;
  onSelectEmoji: (emoji: string) => void;
  onSelectIcon: (name: string) => void;
  onSwitchMode: (mode: IconPickerMode) => void;
  /** Tint applied to registry icons. Omit to hide the colour row entirely. */
  iconColor?: string;
  onSelectColor?: (color: string) => void;
  /**
   * Clears the current pick. Omit where removal has its own affordance; the
   * row only appears when there is something to remove.
   */
  onClear?: () => void;
  className?: string;
}) {
  const tint = iconTintClass(iconColor);

  return (
    <div
      className={`z-(--z-overlay)
          border border-primary-950/10 dark:border-primary/10
          shadow-lg overflow-hidden
          ${isOpen ? "animate-dropdown-in" : "invisible pointer-events-none"}
          bg-linear-to-b from-primary to-primary-50 dark:from-primary-900 dark:to-primary-950
          ${className}`}
    >
        <div className="flex border-b border-primary-950/10 dark:border-primary/10">
          <Button
            type="button"
            onClick={() => onSwitchMode("emoji")}
            className={`flex-1 py-2 text-xs font-medium transition-colors cursor-pointer ${
              iconMode === "emoji"
                ? "text-primary-900 dark:text-primary bg-primary-950/5 dark:bg-primary/10"
                : "text-primary-700 dark:text-primary-300 hover:text-primary-800 dark:hover:text-primary-200"
            }`}
          >
            Emoji
          </Button>
          <Button
            type="button"
            onClick={() => onSwitchMode("icon")}
            className={`flex-1 py-2 text-xs font-medium transition-colors cursor-pointer ${
              iconMode === "icon"
                ? "text-primary-900 dark:text-primary bg-primary-950/5 dark:bg-primary/10"
                : "text-primary-700 dark:text-primary-300 hover:text-primary-800 dark:hover:text-primary-200"
            }`}
          >
            Icon
          </Button>
        </div>

        <div className="p-3">
          {iconMode === "emoji" ? (
            <EmojiPicker.Root
              onEmojiSelect={(emoji) => onSelectEmoji(emoji.emoji)}
            >
              <EmojiPicker.Search
                placeholder="Search emoji..."
                className="w-full mb-2 px-2 py-1.5 glass-input dark:text-primary-300 text-primary-700 dark:placeholder:text-primary-500 placeholder:text-primary-500  rounded-xl text-sm outline-none "
              />
              <EmojiPicker.Viewport className="h-64 overflow-y-auto w-full noscrollbar">
                <EmojiPicker.Loading>
                  <Text
                    as="div"
                    tone="subtle"
                    className="flex items-center justify-center py-8"
                  >
                    Loading emojis...
                  </Text>
                </EmojiPicker.Loading>
                <EmojiPicker.Empty>
                  <Text
                    as="div"
                    tone="subtle"
                    className="flex items-center justify-center py-8"
                  >
                    No emoji found.
                  </Text>
                </EmojiPicker.Empty>
                <EmojiPicker.List
                  className="select-none pb-1.5"
                  components={{
                    CategoryHeader: ({ ...props }) => (
                      <div
                        className="px-2 pt-0 pb-1.5 font-medium text-primary-600 dark:text-primary-400 text-xs"
                        {...props}
                      >
                        {/* {category.label} */}
                      </div>
                    ),
                    Row: ({ children, ...props }) => (
                      <div className="scroll-my-1.5 px-1" {...props}>
                        {children}
                      </div>
                    ),
                    Emoji: ({ emoji, ...props }) => (
                      <Button
                        className="flex size-8 items-center justify-center rounded-md text-lg hover:bg-primary-950/5 dark:hover:bg-primary/10 data-active:bg-primary-950/10 dark:data-active:bg-primary/10"
                        {...props}
                      >
                        {emoji.emoji}
                      </Button>
                    ),
                  }}
                />
              </EmojiPicker.Viewport>
            </EmojiPicker.Root>
          ) : (
            <>
              {onSelectColor && (
                <div className="flex items-center justify-between gap-1 pb-3 mb-3 border-b border-primary-950/10 dark:border-primary/10">
                  {ICON_COLORS.map(({ name, label, swatch }) => {
                    const isSelected =
                      (iconColor || DEFAULT_ICON_COLOR) === name;
                    return (
                      <Button
                        key={name}
                        type="button"
                        onClick={() => onSelectColor(name)}
                        title={label}
                        aria-label={label}
                        aria-pressed={isSelected}
                        className={`flex items-center justify-center size-6 rounded-full cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-primary-950/10 dark:bg-primary/10"
                            : "hover:bg-primary-950/10 dark:hover:bg-primary/10"
                        }`}
                      >
                        <span className={`size-4 rounded-full ${swatch}`} />
                      </Button>
                    );
                  })}
                </div>
              )}
              {/* Same height as the emoji viewport: the two tabs swap
                  without the panel resizing, and a set this long keeps its
                  own scroll instead of growing the popover past the screen. */}
              <div className="h-64 overflow-y-auto noscrollbar">
                <div className="grid grid-cols-5 gap-2">
                  {availableIcons.map(({ name, component: IconComp }) => {
                    return (
                      <Button
                        key={name}
                        type="button"
                        onClick={() => onSelectIcon(name)}
                        className={`flex items-center justify-center size-8 rounded-lg transition-colors cursor-pointer ${
                          icon === name
                            ? "bg-primary-950/10 dark:bg-primary/10"
                            : "hover:bg-primary-950/10 dark:hover:bg-primary/10"
                        } ${tint}`}
                        title={name}
                      >
                        <IconComp className="size-5.5" />
                      </Button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
        {onClear && icon && (
          <div className="border-t border-primary-950/10 dark:border-primary/10">
            <Button
              type="button"
              onClick={onClear}
              className="w-full flex items-center gap-1 px-3 py-2 text-xs text-primary-700 dark:text-primary-300 hover:bg-primary-950/5 dark:hover:bg-primary/10 transition-colors cursor-pointer"
            >
              <Close className="size-3.5 shrink-0" />
              Remove icon
            </Button>
          </div>
        )}
    </div>
  );
}
