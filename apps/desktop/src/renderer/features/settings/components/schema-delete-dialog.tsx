import { Alert } from "@/components/ui";

interface SchemaDeleteDialogProps {
  schemaName: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SchemaDeleteDialog({
  schemaName,
  onCancel,
  onConfirm,
}: SchemaDeleteDialogProps) {
  return (
    <Alert
      isOpen
      title="Delete schema?"
      description={`“${schemaName}” will be permanently removed.`}
      primaryButtonText="Delete"
      secondaryButtonText="Cancel"
      primaryButtonVariant="danger"
      onPrimary={onConfirm}
      onSecondary={onCancel}
    />
  );
}
