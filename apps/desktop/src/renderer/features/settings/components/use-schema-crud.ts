import { toast } from "@/components/ui";
import { useUpdateProviderMutation } from "@/lib/redux/api";
import type { StructuredOutputEntry } from "../../../../shared/adapter.types";
import type { SchemaProperty } from "./schema-editor-tab";
import { schemaToProperties, propertiesToSchema } from "./schema-utils";
import { extractErrorMessage } from "@/lib/extract-error-message";

interface SchemaCrudDeps {
  providerId: string;
  config: Record<string, unknown>;
  entries: Record<string, StructuredOutputEntry>;
  selectedId: string | null;
  enableFlag: boolean;
  editingId: string | null;
  editorName: string;
  editorProperties: SchemaProperty[];
  renameValue: string;
  deleteTargetId: string | null;
  updateState: (patch: Record<string, any>) => void;
}

export function useSchemaCrud({
  providerId,
  config,
  entries,
  selectedId,
  enableFlag,
  editingId,
  editorName,
  editorProperties,
  renameValue,
  deleteTargetId,
  updateState,
}: SchemaCrudDeps) {
  const [updateProvider] = useUpdateProviderMutation();

  async function persistConfig(
    newEntries: Record<string, StructuredOutputEntry>,
    newSelectedId: string | null,
  ) {
    try {
      await updateProvider({
        id: providerId,
        payload: {
          config: {
            ...config,
            structuredOutputs: newEntries,
            structuredOutputsSelectedId: newSelectedId,
            ...(enableFlag && {
              structuredOutputEnabled: newSelectedId !== null,
            }),
          },
        },
      }).unwrap();
    } catch (err: any) {
      toast.error(extractErrorMessage(err, "Failed to save structured output config"));
    }
  }

  function openNewEditor() {
    updateState({
      editingId: null,
      editorName: "",
      editorProperties: [],
      activeTab: "editor",
    });
  }

  function openEditEditor(id: string) {
    const entry = entries[id];
    if (!entry) return;
    updateState({
      editingId: id,
      editorName: entry.name,
      editorProperties: schemaToProperties(entry.schema),
      activeTab: "editor",
    });
  }

  function handleAddProperty() {
    updateState({
      editorProperties: [
        ...editorProperties,
        {
          id: crypto.randomUUID(),
          name: "",
          type: "string",
          isArray: false,
          isRequired: false,
        },
      ],
    });
  }

  function handleUpdateProperty(
    index: number,
    updates: Partial<SchemaProperty>,
  ) {
    const updated = [...editorProperties];
    updated[index] = { ...updated[index], ...updates };
    updateState({ editorProperties: updated });
  }

  function handleRemoveProperty(index: number) {
    updateState({
      editorProperties: editorProperties.filter((_, i) => i !== index),
    });
  }

  async function handleSaveSchema() {
    if (!editorName.trim()) {
      toast.error("Name is required");
      return;
    }
    const hasEmptyName = editorProperties.some((p) => p.name.trim() === "");
    if (editorProperties.length > 0 && hasEmptyName) {
      toast.error("All properties must have a name");
      return;
    }

    updateState({ isSaving: true });
    try {
      const schema = propertiesToSchema(editorProperties);
      const now = Math.floor(Date.now() / 1000);

      let newEntries: Record<string, StructuredOutputEntry>;
      if (editingId && entries[editingId]) {
        newEntries = {
          ...entries,
          [editingId]: {
            ...entries[editingId],
            name: editorName.trim(),
            schema,
            updatedAt: now,
          },
        };
      } else {
        const id = crypto.randomUUID();
        newEntries = {
          ...entries,
          [id]: { id, name: editorName.trim(), schema, createdAt: now, updatedAt: now },
        };
      }

      await persistConfig(newEntries, selectedId);
      toast.success(editingId ? "Schema updated" : "Schema created");
      updateState({
        activeTab: "schemas",
        editingId: null,
        editorName: "",
        editorProperties: [],
      });
    } finally {
      updateState({ isSaving: false });
    }
  }

  async function handleSelectSchema(id: string | null) {
    await persistConfig(entries, id);
  }

  async function handleDuplicateSchema(id: string) {
    const entry = entries[id];
    if (!entry) return;
    const newId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const newEntries = {
      ...entries,
      [newId]: {
        id: newId,
        name: `${entry.name} (copy)`,
        schema: { ...entry.schema },
        createdAt: now,
        updatedAt: now,
      },
    };
    await persistConfig(newEntries, selectedId);
    toast.success("Schema duplicated");
  }

  async function handleConfirmDelete() {
    if (!deleteTargetId) return;
    const { [deleteTargetId]: _, ...rest } = entries;
    const newSelectedId = selectedId === deleteTargetId ? null : selectedId;
    await persistConfig(rest, newSelectedId);
    if (editingId === deleteTargetId) {
      updateState({
        editingId: null,
        editorName: "",
        editorProperties: [],
        activeTab: "schemas",
        deleteTargetId: null,
      });
    } else {
      updateState({ deleteTargetId: null });
    }
    toast.success("Schema deleted");
  }

  async function handleRenameConfirm(id: string) {
    const trimmed = renameValue.trim();
    if (!trimmed || !entries[id]) {
      updateState({ renamingId: null });
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const newEntries = {
      ...entries,
      [id]: { ...entries[id], name: trimmed, updatedAt: now },
    };
    await persistConfig(newEntries, selectedId);
    updateState({ renamingId: null });
  }

  return {
    openNewEditor,
    openEditEditor,
    handleAddProperty,
    handleUpdateProperty,
    handleRemoveProperty,
    handleSaveSchema,
    handleSelectSchema,
    handleDuplicateSchema,
    handleConfirmDelete,
    handleRenameConfirm,
  };
}
