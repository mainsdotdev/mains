import { useRef, useState } from "react";
import { Button, DropdownMenu, DropdownMenuItem } from "@/components/ui";
import { ArrowUp } from "@/components/ui/icons";
import { MODE_IDS, providerModes, type ModeId } from "../../../../shared/modes";
import { MODE_CONFIGS } from "@/lib/mode-config";
import {
  useKeyboardShortcut,
  useKeyboardShortcutBinding,
} from "@/providers/keyboard-shortcuts-provider";
import { formatKeyboardShortcut } from "../../../../shared/keyboard-shortcuts";

/**
 * Shape and type shared by the trigger and the static label. The outline is
 * the trigger's alone — an unclickable pill shouldn't wear a control's border.
 */
const MODE_PILL =
  "flex h-7 items-center rounded-2xl px-3 text-s font-medium text-primary-900 dark:text-primary-100";

interface SpaceModePickerProps {
  value: ModeId;
  onChange: (mode: ModeId) => void;
  /** Optional product label rendered inside the same hover surface. */
  prefixLabel?: string;
  /** Sidebar headers use a roomier, borderless trigger than the titlebar pill. */
  appearance?: "pill" | "sidebar";
  /**
   * The space's provider. Not every agent drives every experience — a provider
   * with one mode has nothing to pick, so the whole control disappears rather
   * than offering a list of one. Omitted = unrestricted.
   */
  providerId?: string;
}

/**
 * Dropdown for the active space mode. All three modes remain visible;
 * the current one carries the radio state (so it is what the menu focuses on
 * open, and what a screen reader announces as checked) without a check glyph
 * next to the mode dot. Command+1/2/3 selects Code/Work/Chat.
 */
export function SpaceModePicker({
  value,
  onChange,
  providerId,
  prefixLabel,
  appearance = "pill",
}: SpaceModePickerProps) {
  // Shortcut numbers stay tied to the full list (⌘1 is always Code), so a
  // narrowed provider skips its keys rather than renumbering the rest.
  const available = providerId ? providerModes(providerId) : MODE_IDS;
  const codeShortcut = useKeyboardShortcutBinding("navigation.code");
  const workShortcut = useKeyboardShortcutBinding("navigation.work");
  const chatShortcut = useKeyboardShortcutBinding("navigation.chat");
  const shortcutByMode: Record<ModeId, string | null> = {
    developer: codeShortcut,
    work: workShortcut,
    chat: chatShortcut,
  };
  const options = MODE_IDS.filter((mode) => available.includes(mode)).map(
    (mode) => ({
      mode,
      shortcutLabel: formatKeyboardShortcut(shortcutByMode[mode]).join(" "),
    }),
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const label = MODE_CONFIGS[value].label;
  const triggerClassName =
    appearance === "sidebar"
      ? "flex h-8 min-w-0 items-center gap-1.5 rounded-xl px-2 text-base font-medium text-primary-800 hover:bg-primary/50 dark:text-primary-200 dark:hover:bg-primary/5"
      : `${MODE_PILL} glass-outline`;
  const staticClassName =
    appearance === "sidebar"
      ? "flex h-8 min-w-0 items-center rounded-xl px-2 text-base font-medium text-primary-800 dark:text-primary-200"
      : MODE_PILL;
  const pickerLabel = (
    <>
      {prefixLabel && (
        <span className="shrink-0 tracking-tight font-semibold text-primary-800 dark:text-primary-200">
          {prefixLabel}
        </span>
      )}
      <span
        className={`truncate tracking-tight ${appearance === "sidebar" ? "font-normal" : "font-medium"}`}
      >
        {label}
      </span>
    </>
  );

  const handleTriggerClick = () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }

    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({ x: rect.left, y: rect.bottom + 6 });
    }
    setIsOpen(true);
  };

  const handleModeChange = (mode: ModeId) => {
    setIsOpen(false);
    if (mode !== value) onChange(mode);
  };

  useKeyboardShortcut("navigation.code", () => handleModeChange("developer"), {
    enabled: available.includes("developer"),
    allowInEditable: true,
  });
  useKeyboardShortcut("navigation.work", () => handleModeChange("work"), {
    enabled: available.includes("work"),
    allowInEditable: true,
  });
  useKeyboardShortcut("navigation.chat", () => handleModeChange("chat"), {
    enabled: available.includes("chat"),
    allowInEditable: true,
  });

  // One mode is not a choice — the label stays so the surrounding shell keeps
  // saying which experience is running without presenting a fake dropdown.
  if (options.length < 2) {
    return <span className={`${staticClassName} gap-1.5`}>{pickerLabel}</span>;
  }

  return (
    <>
      <Button
        ref={triggerRef}
        aria-label={`Current mode: ${MODE_CONFIGS[value].label}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={handleTriggerClick}
        className={`${triggerClassName} transition-colors ${
          isOpen
            ? "bg-primary/80 dark:bg-primary/5"
            : appearance === "pill"
              ? "hover:bg-primary/80 dark:hover:bg-primary/5"
              : ""
        }`}
      >
        {pickerLabel}
        {appearance === "sidebar" && (
          <ArrowUp
            aria-hidden="true"
            className="size-3.5 shrink-0 text-primary-500 transition-transform duration-200 dark:text-primary-400 rotate-180"
          />
        )}
      </Button>

      <DropdownMenu
        isOpen={isOpen}
        aria-label="Choose mode"
        position={position}
        onClose={() => setIsOpen(false)}
        minWidth={260}
        origin="top-left"
        initialFocus="selected"
        className="glass-input! space-y-0.5"
      >
        {options.map(({ mode, shortcutLabel }) => {
          return (
            <DropdownMenuItem
              key={mode}
              className="gap-4 px-3 py-1.5"
              selected={mode === value}
              indicator="none"
              onClick={() => handleModeChange(mode)}
            >
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-s font-medium text-primary-950 dark:text-primary-50">
                  {MODE_CONFIGS[mode].label}
                </span>
                <span
                  aria-hidden="true"
                  className="mt-0.5 block truncate text-xs font-normal text-primary-500 dark:text-primary-400"
                >
                  {MODE_CONFIGS[mode].description}
                </span>
              </span>
              {shortcutLabel && (
                <span
                  aria-hidden="true"
                  className="shrink-0 text-xs text-primary-500 dark:text-primary-400"
                >
                  {shortcutLabel}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenu>
    </>
  );
}
