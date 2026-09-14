import { useRef, useEffect } from "react";
import { Trash, Edit, Duplicate } from "@/components/ui/icons";
import { Input, Button, Caption } from "@/components/ui";
import type { StructuredOutputEntry } from "../../../../shared/adapter.types";

function RadioDot({ active }: { active: boolean }) {
  return (
    <span
      className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${
        active
          ? "border-primary-500 dark:border-primary-300 bg-primary-400 dark:bg-primary-600"
          : "border-primary-400 dark:border-primary-600"
      }`}
    />
  );
}

interface SchemaListTabProps {
  sortedEntries: StructuredOutputEntry[];
  selectedId: string | null;
  renamingId: string | null;
  renameValue: string;
  onSelectSchema: (id: string | null) => void;
  onOpenNewEditor: () => void;
  onOpenEditEditor: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRequestDelete: (id: string) => void;
  onRenameChange: (value: string) => void;
  onRenameConfirm: (id: string) => void;
  onRenameCancel: () => void;
}

export function SchemaListTab({
  sortedEntries,
  selectedId,
  renamingId,
  renameValue,
  onSelectSchema,
  onOpenNewEditor,
  onOpenEditEditor,
  onDuplicate,
  onRequestDelete,
  onRenameChange,
  onRenameConfirm,
  onRenameCancel,
}: SchemaListTabProps) {
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  return (
    <>
      <div className="p-4 pt-0">
        <div className="h-78 overflow-y-auto space-y-1">
          <Button
            onClick={() => onSelectSchema(null)}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm transition-colors cursor-pointer ${
              selectedId === null
                ? "bg-primary-950/10 dark:bg-primary/10 text-primary-900 dark:text-primary-100"
                : "text-primary-600 dark:text-primary-400 hover:bg-primary-950/5 dark:hover:bg-primary/5"
            }`}
          >
            <RadioDot active={selectedId === null} />
            <span>Do not use structured output</span>
          </Button>

          {sortedEntries.map((entry) => (
            <div
              key={entry.id}
              className={`group flex items-center h-10 gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                selectedId === entry.id
                  ? "bg-primary-950/10 dark:bg-primary/10 text-primary-900 dark:text-primary-100"
                  : "text-primary-600 dark:text-primary-400 hover:bg-primary-950/5 dark:hover:bg-primary/5"
              }`}
            >
              <Button
                onClick={() => onSelectSchema(entry.id)}
                className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer"
              >
                <RadioDot active={selectedId === entry.id} />
                {renamingId === entry.id ? (
                  <Input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => onRenameChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onRenameConfirm(entry.id);
                      if (e.key === "Escape") onRenameCancel();
                    }}
                    onBlur={() => onRenameConfirm(entry.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="truncate">{entry.name}</span>
                )}
              </Button>

              <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                <Button
                  tooltip="Edit Schema"
                  onClick={() => onOpenEditEditor(entry.id)}
                  className="p-1 rounded hover:bg-primary-200 dark:hover:bg-primary-800 transition-colors cursor-pointer"
                >
                  <Edit className="size-4" />
                </Button>
                <Button
                  tooltip="Duplicate Schema"
                  onClick={() => onDuplicate(entry.id)}
                  className="p-1 rounded hover:bg-primary-200 dark:hover:bg-primary-800 transition-colors cursor-pointer"
                >
                  <Duplicate className="size-4" />
                </Button>
                <Button
                  tooltip="Delete Schema"
                  onClick={() => onRequestDelete(entry.id)}
                  className="p-1 rounded hover:bg-danger/10 dark:hover:bg-danger/20 text-danger transition-colors cursor-pointer"
                >
                  <Trash className="size-4" />
                </Button>
              </div>
            </div>
          ))}

          {sortedEntries.length === 0 && (
            <Caption className="px-3 py-4 text-center">
              No schemas yet. Create one using the editor tab.
            </Caption>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 p-4 border-t border-primary-950/5 dark:border-primary/10">
        <Button variant="primary" onClick={onOpenNewEditor}>
          New schema
        </Button>
      </div>
    </>
  );
}
