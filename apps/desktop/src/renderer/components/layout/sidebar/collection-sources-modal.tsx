import { useRef, useState } from "react";
import {
  Body,
  Button,
  Caption,
  Input,
  Modal,
  ModalHeader,
  Text,
  Textarea,
  toast,
} from "@/components/ui";
import { Document, Plus, Trash } from "@/components/ui/icons";
import {
  useAddCollectionSourceMutation,
  useListCollectionSourcesQuery,
  useRemoveCollectionSourceMutation,
  type Collection,
} from "@/lib/redux/api";

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

interface CollectionSourcesModalProps {
  accountId: string;
  collection: Collection | null;
  onClose: () => void;
}

export function CollectionSourcesModal({
  accountId,
  collection,
  onClose,
}: CollectionSourcesModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showTextForm, setShowTextForm] = useState(false);
  const [textName, setTextName] = useState("");
  const [text, setText] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const { data: sources = [], isLoading } = useListCollectionSourcesQuery(
    { accountId, collectionId: collection?.id ?? "" },
    { skip: !collection || !accountId },
  );
  const [addSource, { isLoading: isAddingText }] =
    useAddCollectionSourceMutation();
  const [removeSource] = useRemoveCollectionSourceMutation();

  if (!collection) return null;

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
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

  const handleAddText = async () => {
    if (!textName.trim() || !text.trim()) return;
    try {
      await addSource({
        accountId,
        collectionId: collection.id,
        kind: "text",
        name: textName.trim(),
        text,
      }).unwrap();
      setTextName("");
      setText("");
      setShowTextForm(false);
      toast.success("Text source added");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to add text source"));
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      className="w-full max-w-xl rounded-3xl"
      closeOnEscape={!isUploading && !isAddingText}
      closeOnBackdrop={!isUploading && !isAddingText}
    >
      <ModalHeader onClose={onClose}>
        <div className="min-w-0">
          <Body as="h2" weight="medium" className="truncate">
            Sources
          </Body>
          <Caption className="truncate">{collection.name}</Caption>
        </div>
      </ModalHeader>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
        <div className="flex gap-2">
          <Input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => void handleFiles(event)}
          />
          <Button
            variant="primary"
            className="flex items-center gap-1.5"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus className="size-3.5" />
            {isUploading ? "Adding…" : "Add files"}
          </Button>
          <Button
            variant="subtle"
            className="flex items-center gap-1.5"
            onClick={() => setShowTextForm((value) => !value)}
          >
            <Document className="size-3.5" />
            Add text
          </Button>
        </div>

        {showTextForm && (
          <div className="flex flex-col gap-2 rounded-xl border border-primary-200 p-3 dark:border-primary-800">
            <Input
              value={textName}
              onChange={(event) => setTextName(event.target.value)}
              placeholder="Source name"
              aria-label="Text source name"
            />
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste notes, instructions, or reference text…"
              aria-label="Text source content"
              rows={6}
            />
            <div className="flex justify-end gap-2">
              <Button variant="subtle" onClick={() => setShowTextForm(false)}>
                Cancel
              </Button>
              <Button
                variant="submit"
                disabled={isAddingText || !textName.trim() || !text.trim()}
                onClick={() => void handleAddText()}
              >
                {isAddingText ? "Adding…" : "Add source"}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1">
          {isLoading ? (
            <Text size="xs" tone="muted" className="py-6 text-center">
              Loading sources…
            </Text>
          ) : sources.length === 0 ? (
            <Text size="xs" tone="muted" className="py-6 text-center">
              Files and text added here stay with this project.
            </Text>
          ) : (
            sources.map((source) => (
              <div
                key={source.id}
                className="group/source flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-primary/50 dark:hover:bg-primary/5"
              >
                <Document className="size-4 shrink-0 text-primary-600 dark:text-primary-300" />
                <div className="min-w-0 flex-1">
                  <Text size="s" tone="contrast" className="truncate">
                    {source.name}
                  </Text>
                  <Text size="xxs" tone="muted">
                    {source.kind === "text" ? "Text" : source.mimeType} · {formatBytes(source.byteSize)}
                  </Text>
                </div>
                <Button
                  tooltip="Remove source"
                  aria-label={`Remove ${source.name}`}
                  className="p-1 opacity-0 group-hover/source:opacity-100 focus:opacity-100"
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
                  <Trash className="size-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
