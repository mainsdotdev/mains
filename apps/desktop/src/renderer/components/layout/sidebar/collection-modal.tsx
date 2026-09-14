import { useId, useRef, useState } from "react";
import { Body, Button, Caption, Input, Modal } from "@/components/ui";
import { ProjectFolder } from "@/components/ui/icons";
import { useClickOutside } from "@/hooks/use-click-outside";
import {
  DEFAULT_ICON_COLOR,
  formatIcon,
  iconKindOf,
  iconTintClass,
  iconRegistry,
  splitStoredIcon,
} from "@/lib/icon-registry";
import { IconPickerPanel, type IconPickerMode } from "./icon-picker-panel";

export interface CollectionDraft {
  name: string;
  icon: string | null;
}

interface CollectionModalProps {
  isOpen: boolean;
  /** The collection being edited. Absent = the modal creates a new one. */
  collection?: { id: string; name: string; icon: string | null } | null;
  isSaving: boolean;
  onSave: (draft: CollectionDraft) => void;
  onClose: () => void;
}

/**
 * The chosen icon, or the folder the sidebar falls back to when none is set.
 * Keyed off the value itself rather than the picker's open tab — browsing the
 * other tab must not turn a chosen icon into its own name in text.
 */
function IconPreview({ value, color }: { value: string; color: string }) {
  const IconComp = value ? iconRegistry[value] : undefined;
  if (IconComp) return <IconComp className={`size-5 ${iconTintClass(color)}`} />;
  if (value) return <span className="text-lg leading-none">{value}</span>;
  return <ProjectFolder className={`size-5 ${iconTintClass(null)}`} />;
}

/**
 * One modal for both halves of a project's identity — its name and its icon —
 * used to create a collection and to edit one. A separate "edit" copy of the
 * create dialog would drift from it the first time either side changed.
 */
export default function CollectionModal({
  isOpen,
  collection,
  isSaving,
  onSave,
  onClose,
}: CollectionModalProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  // The picker's open tab. What was *picked* is read off the value itself
  // (`iconKindOf`), so switching tabs never relabels or drops the selection.
  const [iconTab, setIconTab] = useState<IconPickerMode>("emoji");
  const [iconColor, setIconColor] = useState(DEFAULT_ICON_COLOR);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);

  // Seed from the record on the transition into open (React's supported
  // adjust-during-render pattern), so reopening never shows the last edit.
  if (isOpen && !wasOpen) {
    setWasOpen(true);
    const parsed = splitStoredIcon(collection?.icon);
    setName(collection?.name ?? "");
    setIcon(parsed.value);
    setIconTab(parsed.mode);
    setIconColor(parsed.color);
    setIsPickerOpen(false);
  } else if (!isOpen && wasOpen) {
    setWasOpen(false);
  }

  useClickOutside(pickerRef, () => {
    if (isPickerOpen) setIsPickerOpen(false);
  });

  const isEditing = !!collection;
  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed || isSaving) return;
    onSave({
      name: trimmed,
      icon: formatIcon(iconKindOf(icon), icon, iconColor),
    });
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      aria-labelledby={titleId}
      initialFocusRef={inputRef}
      closeOnEscape={!isSaving}
      closeOnBackdrop={!isSaving}
      // `overflow-visible` overrides the dialog's own clipping (Modal ships
      // `overflow-hidden` to protect its rounded corners): the icon popover
      // hangs below the trigger and must be allowed out of the box.
      className="max-w-md w-full rounded-4xl px-6 pt-5 pb-6 overflow-visible"
    >
      <Body as="h2" id={titleId} weight="medium" className="mb-4">
        {isEditing ? "Edit project" : "Create project"}
      </Body>
      <Caption className="mb-1.5 block">Project name</Caption>
      <div className="flex items-start gap-2">
        <div ref={pickerRef} className="relative shrink-0">
          <Button
            type="button"
            onClick={() => setIsPickerOpen((open) => !open)}
            aria-label="Choose project icon"
            aria-expanded={isPickerOpen}
            className="size-9.5 flex items-center justify-center rounded-xl glass-outline cursor-pointer"
          >
            <IconPreview value={icon} color={iconColor} />
          </Button>
          <IconPickerPanel
            icon={icon}
            iconMode={iconTab}
            isOpen={isPickerOpen}
            onSelectEmoji={(emoji) => {
              setIcon(emoji);
              setIsPickerOpen(false);
            }}
            onSelectIcon={setIcon}
            onSwitchMode={setIconTab}
            onClear={() => {
              setIcon("");
              setIconColor(DEFAULT_ICON_COLOR);
            }}
            iconColor={iconColor}
            onSelectColor={setIconColor}
            className="absolute top-full left-0 mt-1.5 w-72 rounded-xl"
          />
        </div>
        <Input
          ref={inputRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Research"
          aria-label="Project name"
          className="flex-1"
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      </div>
      <div className="mt-5 flex gap-3">
        <Button
          className="flex-1"
          variant="primary"
          onClick={onClose}
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button
          className="flex-1"
          variant="submit"
          onClick={submit}
          disabled={isSaving || !trimmed}
        >
          {isSaving
            ? isEditing
              ? "Saving..."
              : "Creating..."
            : isEditing
              ? "Save"
              : "Create"}
        </Button>
      </div>
    </Modal>
  );
}
