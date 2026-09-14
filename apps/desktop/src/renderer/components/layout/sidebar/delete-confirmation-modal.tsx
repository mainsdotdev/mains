import { Alert } from "@/components/ui";

interface DeleteConfirmationModalProps {
    isOpen: boolean;
    isDeleting: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    title?: string;
    description?: string;
}

export default function DeleteConfirmationModal({
    isOpen,
    isDeleting,
    onConfirm,
    onCancel,
    title = "Delete",
    description = "This action cannot be undone. The workspace will be permanently deleted.",
}: DeleteConfirmationModalProps) {
    return (
        <Alert
            isOpen={isOpen}
            title={title}
            description={description}
            primaryButtonText="Delete"
            secondaryButtonText="Cancel"
            onPrimary={onConfirm}
            onSecondary={onCancel}
            isPrimaryLoading={isDeleting}
            primaryButtonVariant="danger"
        />
    );
}
