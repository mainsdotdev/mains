import { Body, Input, Button, Select } from "@/components/ui";
import { Trash, Asterisk } from "@/components/ui/icons";

export interface SchemaProperty {
  id: string;
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  isArray: boolean;
  isRequired: boolean;
}

const typeOptions: { value: string; label: string }[] = [
  { value: "string", label: "string" },
  { value: "number", label: "number" },
  { value: "boolean", label: "boolean" },
  { value: "array", label: "array" },
  { value: "object", label: "object" },
];

function PropertyRow({
  property,
  onUpdate,
  onRemove,
}: {
  property: SchemaProperty;
  onUpdate: (updates: Partial<SchemaProperty>) => void;
  onRemove: () => void;
}) {
  const isNameEmpty = property.name.trim() === "";

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <Input
          type="text"
          value={property.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="Property name"
          hasError={isNameEmpty}
          className="py-2.5 "
        />
      </div>
      <div className="w-51.5 shrink-0">
        <Select
          value={property.type}
          aria-label="Property type"
          options={typeOptions}
          onChange={(val) => onUpdate({ type: val as SchemaProperty["type"] })}
          placeholder="Type"
        />
      </div>
      <Button
        onClick={() => onUpdate({ isArray: !property.isArray })}
        className={`shrink-0 px-2.5 py-2 border  border-primary-950/10 dark:border-primary/10 rounded-xl text-sm transition-all  ${
          property.isArray
            ? "bg-primary-950/10 dark:bg-primary/20 text-primary-800 dark:text-primary-200"
            : "bg-primary-950/5 dark:bg-primary/5 text-primary-600 dark:text-primary-400"
        }`}
        tooltip="Is Array"
      >
        [ ]
      </Button>
      <Button
        onClick={() => onUpdate({ isRequired: !property.isRequired })}
        className={`shrink-0 py-2.5 px-2 border border-primary-950/10 dark:border-primary/10 rounded-xl text-sm transition-all ${
          property.isRequired
            ? "bg-primary-950/10 dark:bg-primary/20 text-primary-800 dark:text-primary-200"
            : "bg-primary-950/5 dark:bg-primary/5 text-primary-600 dark:text-primary-400"
        }`}
        tooltip="Required"
      >
        <Asterisk className="w-4 h-4" />
      </Button>
      <Button
        onClick={onRemove}
        className="shrink-0 p-2 text-primary-500 cursor-pointer hover:text-danger rounded-lg transition-colors"
        tooltip="Remove"
      >
        <Trash className="w-4 h-4" />
      </Button>
    </div>
  );
}

interface SchemaEditorTabProps {
  editorName: string;
  editorProperties: SchemaProperty[];
  editingId: string | null;
  isSaving: boolean;
  canSave: boolean;
  onNameChange: (name: string) => void;
  onAddProperty: () => void;
  onUpdateProperty: (index: number, updates: Partial<SchemaProperty>) => void;
  onRemoveProperty: (index: number) => void;
  onReset: () => void;
  onSave: () => void;
}

export function SchemaEditorTab({
  editorName,
  editorProperties,
  editingId,
  isSaving,
  canSave,
  onNameChange,
  onAddProperty,
  onUpdateProperty,
  onRemoveProperty,
  onReset,
  onSave,
}: SchemaEditorTabProps) {
  return (
    <>
      <div className="p-4 pt-0">
        <div className="h-78 overflow-y-auto overflow-x-visible">
          <Body className="my-2">Name</Body>
          <Input
            type="text"
            value={editorName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Schema name"
            className="w-full mb-2  "
          />
          <div className="space-y-3 flex-col">
            <Body className="mt-1 mb-2">Property</Body>
            {editorProperties.map((prop, index) => (
              <PropertyRow
                key={prop.id}
                property={prop}
                onUpdate={(updates) => onUpdateProperty(index, updates)}
                onRemove={() => onRemoveProperty(index)}
              />
            ))}
            <div className="px-2 -ml-2">
              <Button
                onClick={onAddProperty}
                variant="primary"
              >
                + Add property
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 p-4 border-t border-primary-950/5 dark:border-primary/10">
        <Button onClick={onReset} variant="ghost">
          Reset
        </Button>
        <Button
          onClick={onSave}
          disabled={!canSave}
          isLoading={isSaving}
          variant="submit"
        >
          {editingId ? "Update" : "Save"}
        </Button>
      </div>
    </>
  );
}
