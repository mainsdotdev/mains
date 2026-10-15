import { Button, CircleSpinner, Text } from "@/components/ui";
import { Close, ProjectFolder, Refresh } from "@/components/ui/icons";
import type { PendingWorkspaceClone } from "@/hooks/use-sidebar-actions";

export default function PendingWorkspaceItem({
  clone,
  onCancel,
  onRetry,
  onDismiss,
}: {
  clone: PendingWorkspaceClone;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const failed = clone.status === "failed";
  const canceling = clone.status === "canceling";

  return (
    <div className="rounded-xl px-2 py-1">
      <div className="flex min-w-0 items-center gap-2">
        <div role="status" aria-label={`${clone.name} clone status`} aria-live="polite" aria-atomic="true" className="flex min-w-0 flex-1 items-center gap-1.5">
          {failed ? (
            <ProjectFolder className="size-3.5 shrink-0 text-primary-600 dark:text-primary-400" />
          ) : (
            <span className="flex size-3.5 shrink-0 items-center justify-center text-primary-500">
              <CircleSpinner className="size-3" />
            </span>
          )}
          <Text as="span" size="s" tone="secondary" className="min-w-0 flex-1 truncate" title={clone.url}>
            {clone.name}
          </Text>
          <Text as="span" size="xxs" tone={failed ? "danger" : "faint"} className="shrink-0">
            {failed ? "Clone failed" : canceling ? "Canceling…" : "Cloning…"}
          </Text>
        </div>
        {failed ? (
          <div className="flex shrink-0 items-center">
            <Button variant="icon" iconSize="xs" tooltip="Retry clone" aria-label={`Retry cloning ${clone.name}`} onClick={onRetry}>
              <Refresh className="size-3.5" />
            </Button>
            <Button variant="icon" iconSize="xs" tooltip="Dismiss error" aria-label={`Dismiss clone error for ${clone.name}`} onClick={onDismiss}>
              <Close className="size-3.5" />
            </Button>
          </div>
        ) : (
          <Button variant="icon" iconSize="xs" tooltip="Cancel" aria-label={`Cancel cloning ${clone.name}`} disabled={canceling} onClick={onCancel}>
            <Close className="size-3.5" />
          </Button>
        )}
      </div>
      {failed && clone.error && (
        <Text as="p" size="xxs" tone="muted" className="mt-0.5 pl-5 line-clamp-2 break-all" title={clone.error}>
          {clone.error}
        </Text>
      )}
    </div>
  );
}
