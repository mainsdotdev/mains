import { useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  Button,
  Input,
  Modal,
  ModalHeader,
  Text,
  toast,
} from "@/components/ui";
import { FileIconComponent, Plus, Trash } from "@/components/ui/icons";
import { useClickOutside } from "@/hooks/use-click-outside";
import { classifyDocType } from "@/lib/document-viewer";
import {
  DEFAULT_ICON_COLOR,
  formatIcon,
  iconKindOf,
  splitStoredIcon,
} from "@/lib/icon-registry";
import {
  useAddCollectionSourceMutation,
  useListCollectionSourcesQuery,
  useRemoveCollectionSourceMutation,
  useUpdateCollectionMutation,
  type Collection,
} from "@/lib/redux/api";
import { DOC_TYPE_ICONS } from "@/features/workspace/components/document-viewer/doc-type-icons";
import { CollectionIconPreview } from "./collection-modal";
import { IconPickerPanel, type IconPickerMode } from "./icon-picker-panel";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "error" in error) {
    const value = (error as { error?: unknown }).error;
    if (typeof value === "string") return value;
  }
  return fallback;
}

function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(((reader.result as string).split(",", 2)[1] ?? "").trim());
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SourceTypeIcon({ name }: { name: string }) {
  const docType = classifyDocType(name);
  if (docType) {
    const Icon = DOC_TYPE_ICONS[docType];
    return <Icon className="size-5 shrink-0" />;
  }
  return <FileIconComponent fileName={name} className="size-5 shrink-0" />;
}

interface CollectionSettingsModalProps {
  accountId: string;
  collection: Collection;
  onClose: () => void;
}

/** One project surface for identity and shared sources. */
export function CollectionSettingsModal({
  accountId,
  collection,
  onClose,
}: CollectionSettingsModalProps) {
  const nameInputId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iconPickerRef = useRef<HTMLDivElement>(null);
  const initialIcon = splitStoredIcon(collection.icon);
  const [name, setName] = useState(collection.name);
  const [icon, setIcon] = useState(initialIcon.value);
  const [iconTab, setIconTab] = useState<IconPickerMode>(initialIcon.mode);
  const [iconColor, setIconColor] = useState(initialIcon.color);
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const { data: sources = [], isLoading, isError } = useListCollectionSourcesQuery(
    { accountId, collectionId: collection.id },
    { refetchOnMountOrArgChange: true },
  );
  const [updateCollection, { isLoading: isSaving }] = useUpdateCollectionMutation();
  const [addSource] = useAddCollectionSourceMutation();
  const [removeSource, { isLoading: isRemoving }] = useRemoveCollectionSourceMutation();

  useClickOutside(iconPickerRef, () => setIsIconPickerOpen(false));

  const trimmedName = name.trim();
  const storedIcon = formatIcon(iconKindOf(icon), icon, iconColor);
  const originalIcon = formatIcon(
    iconKindOf(initialIcon.value),
    initialIcon.value,
    initialIcon.color,
  );
  const isDirty = trimmedName !== collection.name || storedIcon !== originalIcon;
  const isBusy = isSaving || isUploading || isRemoving;
  const close = () => {
    if (!isBusy) onClose();
  };

  const handleSave = async () => {
    if (!trimmedName || !isDirty || isBusy) return;
    try {
      await updateCollection({
        id: collection.id,
        accountId,
        payload: { name: trimmedName, icon: storedIcon },
      }).unwrap();
      toast.success("Project settings saved");
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save project settings"));
    }
  };

  const addFiles = async (files: File[]) => {
    if (files.length === 0 || isUploading) return;
    const oversized = files.find((file) => file.size > MAX_SOURCE_BYTES);
    if (oversized) {
      toast.error(`${oversized.name} is larger than 20 MB`);
      return;
    }

    setIsUploading(true);
    try {
      for (const file of files) {
        await addSource({
          accountId,
          collectionId: collection.id,
          kind: "file",
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          data: await fileAsBase64(file),
        }).unwrap();
      }
      toast.success(files.length === 1 ? "Source added" : "Sources added");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to add source"));
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void addFiles(files);
  };

  const handleFileDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void addFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <Modal
      isOpen
      onClose={close}
      initialFocusRef={nameInputRef}
      closeOnEscape={!isBusy}
      closeOnBackdrop={!isBusy}
      className="w-full max-w-xl rounded-3xl overflow-visible text-primary-900 dark:text-primary-100"
    >
      <ModalHeader onClose={close}>
        <Text as="h2" size="base" weight="semibold" tone="contrast">
          Project settings
        </Text>
      </ModalHeader>

      <div className="relative z-20 shrink-0 px-6 pb-5 pt-5">
        <label htmlFor={nameInputId} className="mb-2 block">
          <Text as="span" size="s" tone="contrast" weight="medium">
            Project name
          </Text>
        </label>
        <div className="flex items-center gap-1 rounded-2xl  glass-input">
          <div ref={iconPickerRef} className="relative shrink-0 p-1">
            <Button
              variant="bare"
              aria-label="Choose project icon"
              aria-expanded={isIconPickerOpen}
              onClick={() => setIsIconPickerOpen((open) => !open)}
              className="flex size-9 items-center justify-center rounded-xl text-primary-800 hover:bg-primary-200/50 dark:text-primary-200 dark:hover:bg-primary-800/60"
            >
              <CollectionIconPreview value={icon} color={iconColor} />
            </Button>
            <IconPickerPanel
              icon={icon}
              iconMode={iconTab}
              isOpen={isIconPickerOpen}
              onSelectEmoji={(value) => {
                setIcon(value);
                setIsIconPickerOpen(false);
              }}
              onSelectIcon={(value) => {
                setIcon(value);
                setIsIconPickerOpen(false);
              }}
              onSwitchMode={setIconTab}
              onClear={() => {
                setIcon("");
                setIconColor(DEFAULT_ICON_COLOR);
                setIsIconPickerOpen(false);
              }}
              iconColor={iconColor}
              onSelectColor={setIconColor}
              className="absolute left-0 top-full mt-2 w-72 rounded-2xl"
            />
          </div>
          <Input
            id={nameInputId}
            ref={nameInputRef}
            variant="bare"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleSave();
            }}
            aria-label="Project name"
            className="h-5 flex-1 text-sm text-primary-900 dark:text-primary-100"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <Text as="h3" size="sm" tone="contrast" weight="semibold">
            Available sources
          </Text>
          <Button
            variant="primary"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-2 py-1 "
          >
            <Plus className="size-4" />
            <span>Add files</span>
          </Button>
        </div>

        <Input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />

        {isLoading ? (
          <Text size="xs" tone="muted" className="py-12 text-center">
            Loading sources…
          </Text>
        ) : isError ? (
          <Text size="xs" tone="muted" className="py-12 text-center">
            Could not load project sources.
          </Text>
        ) : sources.length === 0 ? (
          <button
            type="button"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleFileDrop}
            className={`flex min-h-64 w-full flex-col items-center justify-center rounded-2xl border border-dashed px-5 text-center transition-colors sm:min-h-72 ${
              isDragging
                ? "border-primary-600 bg-primary-100/60 dark:border-primary-300 dark:bg-primary-800/40"
                : "border-primary-200 bg-primary-50/20 hover:bg-primary-50/60 dark:border-primary-800 dark:bg-primary-950/20 dark:hover:bg-primary-900/40"
            }`}
          >
            <Text as="span" size="sm" tone="muted">
              {isUploading ? "Adding files…" : "Add files for Mains to work with"}
            </Text>
            <Text as="span" size="xs" tone="subtle" className="mt-1">
              Drop files here or click to choose
            </Text>
          </button>
        ) : (
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleFileDrop}
            className="flex flex-col gap-1"
          >
            {sources.map((source) => (
              <div
                key={source.id}
                className="group/source flex items-center gap-3 rounded-xl border border-primary-200/70 bg-primary-50/60 px-3 py-3 dark:border-primary-800/70 dark:bg-primary-900/50"
              >
                <SourceTypeIcon name={source.name} />
                <div className="min-w-0 flex-1">
                  <Text size="s" tone="contrast" className="truncate" title={source.name}>
                    {source.name}
                  </Text>
                  <Text size="xxs" tone="muted">
                    {source.kind === "text" ? "Text" : source.mimeType} · {formatBytes(source.byteSize)}
                  </Text>
                </div>
                <Button
                  variant="bare"
                  tooltip="Remove source"
                  aria-label={`Remove ${source.name}`}
                  className="rounded-lg p-1.5 text-primary-600 opacity-60 hover:bg-primary-200/60 hover:text-danger focus:opacity-100 group-hover/source:opacity-100 dark:text-primary-300 dark:hover:bg-primary-800/60 dark:hover:text-danger"
                  onClick={async () => {
                    try {
                      await removeSource({
                        accountId,
                        id: source.id,
                        collectionId: collection.id,
                      }).unwrap();
                    } catch (error) {
                      toast.error(errorMessage(error, "Failed to remove source"));
                    }
                  }}
                >
                  <Trash className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 justify-end px-6 py-4 ">
        <Button
          variant="submit"
          className="min-w-24"
          disabled={!trimmedName || !isDirty || isBusy}
          onClick={() => void handleSave()}
        >
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Modal>
  );
}
