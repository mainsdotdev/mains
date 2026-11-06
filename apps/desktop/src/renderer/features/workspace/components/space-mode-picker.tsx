import { Button } from "@/components/ui";
import { MODE_ICONS } from "@/lib/mode-icons";
import { MODE_CONFIGS } from "@/lib/mode-config";
import {
  useKeyboardShortcut,
  useKeyboardShortcutBinding,
} from "@/providers/keyboard-shortcuts-provider";
import { MODE_IDS, providerModes, type ModeId } from "../../../../shared/modes";
import { keyboardShortcutLabel } from "../../../../shared/keyboard-shortcuts";

interface SpaceModePickerProps {
  value: ModeId;
  onChange: (mode: ModeId) => void;
  /**
   * The space's provider. Not every agent drives every experience — a provider
   * with one mode has nothing to pick, so the control becomes the current
   * mode's label rather than a row of one. Omitted = unrestricted.
   */
  providerId?: string;
}

const ICON = "size-4 shrink-0";

const FOCUS = "focus-visible:ring-2 focus-visible:ring-accent/40";

/** Shared shape. Width comes from the label track, so the row slides instead of jumping. */
const BUTTON =
  `flex h-8 items-center rounded-full px-2 text-s font-medium tracking-tight transition-[color,background-color,padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${FOCUS}`;

/** Selected experience: icon and its name, in one pill. */
const SELECTED =
  "glass-outline text-primary-900 dark:text-primary-50";

/** The other experiences stay icon-only until they are the current one. */
const IDLE =
  "text-primary-500 hover:bg-primary-200/70 hover:text-primary-800 dark:text-primary-400 dark:hover:bg-primary-800/70 dark:hover:text-primary-100";

/** The name is always mounted; the track collapses so opening and closing ease. */
const LABEL_TRACK =
  "grid transition-[grid-template-columns,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";

/**
 * Code, Work, and Chat as one row. The current mode wears its label; the
 * others are icons. Command+1/2/3 still selects them.
 */
export function SpaceModePicker({
  value,
  onChange,
  providerId,
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
  const options = MODE_IDS.filter((mode) => available.includes(mode));

  const handleModeChange = (mode: ModeId) => {
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

  const CurrentIcon = MODE_ICONS[value];
  const currentLabel = MODE_CONFIGS[value].label;

  // One mode is not a choice — the pill stays so the shell still says which
  // experience is running, without a control that cannot switch.
  if (options.length < 2) {
    return (
      <span className={`${BUTTON} ${SELECTED}`}>
        <CurrentIcon aria-hidden="true" className={ICON} />
        <span className="pl-1.5">{currentLabel}</span>
      </span>
    );
  }

  return (
    <div role="radiogroup" aria-label="Choose mode" className="flex items-center gap-1">
      {options.map((mode, index) => {
        const selected = mode === value;
        const label = MODE_CONFIGS[mode].label;
        const Icon = MODE_ICONS[mode];
        const shortcut = keyboardShortcutLabel(shortcutByMode[mode]);
        return (
          <Button
            key={mode}
            variant="bare"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            tooltip={MODE_CONFIGS[mode].description}
            tooltipShortcut={shortcut || undefined}
            tooltipPosition={index === 0 ? "bottom-right" : "bottom"}
            onClick={() => handleModeChange(mode)}
            className={`${BUTTON} ${selected ? SELECTED : IDLE}`}
          >
            <Icon aria-hidden="true" className={ICON} />
            <span
              data-mode-label
              data-open={selected ? "true" : "false"}
              className={`${LABEL_TRACK} ${selected ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0"}`}
            >
              <span className="min-w-0 overflow-hidden">
                <span className="block whitespace-nowrap pl-1.5">{label}</span>
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}
