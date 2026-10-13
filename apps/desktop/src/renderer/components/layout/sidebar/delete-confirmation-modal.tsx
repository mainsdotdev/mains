import { Alert } from "@/components/ui";
import type { RefObject } from "react";

interface DeleteConfirmationModalProps {
    isOpen: boolean;
    isDeleting: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    title?: string;
    description?: string;
    returnFocusRef?: RefObject<HTMLElement | null>;
}

export default function DeleteConfirmationModal({
    isOpen,
    isDeleting,
    onConfirm,
    onCancel,
    title = "Delete",
    description = "This action cannot be undone. The workspace will be permanently deleted.",
    returnFocusRef,
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
            returnFocusRef={returnFocusRef}
        />
    );
}
