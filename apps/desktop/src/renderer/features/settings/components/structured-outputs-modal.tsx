import { useId, useReducer } from "react";
import {
  useGetProviderByIdQuery,
} from "@/lib/redux/api";
import { getSegmentedTabId, Modal } from "@/components/ui";
import { SchemaListTab } from "./schema-list-tab";
import { SchemaEditorTab, type SchemaProperty } from "./schema-editor-tab";
import { SchemaDeleteDialog } from "./schema-delete-dialog";
import { SchemaModalHeader } from "./schema-modal-header";
import { useSchemaCrud } from "./use-schema-crud";
import { StructuredOutputEntry } from "../../../../shared/adapter.types";

type Tab = "schemas" | "editor";

interface ModalState {
  activeTab: Tab;
  editingId: string | null;
  editorName: string;
  editorProperties: SchemaProperty[];
  isSaving: boolean;
  deleteTargetId: string | null;
  renamingId: string | null;
  renameValue: string;
  prevOpen: boolean;
}

const mergeState = (
  prev: ModalState,
  next: Partial<ModalState>,
): ModalState => ({
  ...prev,
  ...next,
});

interface StructuredOutputsModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  enableFlag?: boolean;
}

export function StructuredOutputsModal({
  isOpen,
  onClose,
  providerId,
  enableFlag = false,
}: StructuredOutputsModalProps) {
  const titleId = useId();
  const { data: provider } = useGetProviderByIdQuery(providerId);
  const config = (provider?.config ?? {}) as Record<string, unknown>;

  const entries = (config.structuredOutputs ?? {}) as Record<
    string,
    StructuredOutputEntry
  >;
  const selectedId =
    (config.structuredOutputsSelectedId as string | null) ?? null;

  const [state, updateState] = useReducer(mergeState, {
    activeTab: "schemas" as Tab,
    editingId: null,
    editorName: "",
    editorProperties: [] as SchemaProperty[],
    isSaving: false,
    deleteTargetId: null,
    renamingId: null,
    renameValue: "",
    prevOpen: false,
  });
  const {
    activeTab,
    editingId,
    editorName,
    editorProperties,
    isSaving,
    deleteTargetId,
  } = state;

  // Reset state when modal opens
  if (isOpen && !state.prevOpen) {
    updateState({
      activeTab: "schemas",
      editingId: null,
      editorName: "",
      editorProperties: [],
      deleteTargetId: null,
      renamingId: null,
    });
  }
  if (isOpen !== state.prevOpen) updateState({ prevOpen: isOpen });

  const crud = useSchemaCrud({
    providerId,
    config,
    entries,
    selectedId,
    enableFlag,
    editingId,
    editorName,
    editorProperties,
    renameValue: state.renameValue,
    deleteTargetId,
    updateState,
  });

  // ─── Render ───

  if (!isOpen) return null;

  const sortedEntries = Object.values(entries).sort(
    (a, b) => a.createdAt - b.createdAt,
  );

  const hasEmptyPropertyName = editorProperties.some(
    (p) => p.name.trim() === "",
  );
  const canSave =
    editorName.trim() !== "" &&
    (editorProperties.length === 0 || !hasEmptyPropertyName);

  return (
    <Modal
      isOpen
      // Keep any fallback dismissal scoped to the nested confirmation first.
      onClose={
        deleteTargetId ? () => updateState({ deleteTargetId: null }) : onClose
      }
      aria-labelledby={titleId}
      className="w-full max-w-180 h-120 rounded-3xl"
    >
      <SchemaModalHeader
        titleId={titleId}
        activeTab={activeTab}
        editingId={editingId}
        onTabChange={(tab) => updateState({ activeTab: tab })}
        onClose={onClose}
      />

      <div
        id="structured-outputs-panel"
        role="tabpanel"
        aria-labelledby={getSegmentedTabId(
          "structured-outputs-tabs",
          activeTab,
        )}
        className="flex min-h-0 flex-1 flex-col"
      >
        {activeTab === "schemas" && (
          <SchemaListTab
            sortedEntries={sortedEntries}
            selectedId={selectedId}
            renamingId={state.renamingId}
            renameValue={state.renameValue}
            onSelectSchema={crud.handleSelectSchema}
            onOpenNewEditor={crud.openNewEditor}
            onOpenEditEditor={crud.openEditEditor}
            onDuplicate={crud.handleDuplicateSchema}
            onRequestDelete={(id) => updateState({ deleteTargetId: id })}
            onRenameChange={(value) => updateState({ renameValue: value })}
            onRenameConfirm={crud.handleRenameConfirm}
            onRenameCancel={() => updateState({ renamingId: null })}
          />
        )}

        {activeTab === "editor" && (
          <SchemaEditorTab
            editorName={editorName}
            editorProperties={editorProperties}
            editingId={editingId}
            isSaving={isSaving}
            canSave={canSave}
            onNameChange={(name) => updateState({ editorName: name })}
            onAddProperty={crud.handleAddProperty}
            onUpdateProperty={crud.handleUpdateProperty}
            onRemoveProperty={crud.handleRemoveProperty}
            onReset={() => updateState({ editorProperties: [] })}
            onSave={crud.handleSaveSchema}
          />
        )}
      </div>

      {deleteTargetId && (
        <SchemaDeleteDialog
          schemaName={entries[deleteTargetId]?.name ?? ""}
          onCancel={() => updateState({ deleteTargetId: null })}
          onConfirm={crud.handleConfirmDelete}
        />
      )}
    </Modal>
  );
}
