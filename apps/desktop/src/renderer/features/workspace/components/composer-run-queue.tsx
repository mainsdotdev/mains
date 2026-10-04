import { useRef, useState } from "react";
import { Button, DropdownWrapper, SortableItem, SortableList, type SortableHandle } from "@/components/ui";
import { Edit, FileIconComponent, Option, Picture, Trash, Queue, Steer, Drag } from "@/components/ui/icons";
import { useClickOutside } from "@/hooks/use-click-outside";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { useTransientUploads } from "../hooks/use-transient-uploads";
import { buildQueuedMessagePreview, type QueuedMessagePreview } from "../lib/run-queue-preview";
import type { ComposerRunQueue } from "../hooks/use-composer-run-queue";
import type { QueuedRunMessage } from "@/lib/redux/slices/runQueueSlice";

const MESSAGE_STATUS_LABEL = {
  editing: "Editing queued message",
  sending: "Sending message…",
  unknown: "Delivery unconfirmed",
  error: "Message needs attention",
};

function QueuedAttachment({ attachment }: { attachment: NonNullable<QueuedMessagePreview["attachment"]> }) {
  const src = useLocalImageUrl(attachment.type === "image" ? attachment.src : undefined);
  const [failedSrc, setFailedSrc] = useState<string>();
  return (
    <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-primary-200/60 bg-primary-100 dark:border-primary-800 dark:bg-primary-900" title={attachment.name}>
      {attachment.type === "image" ? (
        src && src !== failedSrc
          ? <img src={src} alt={attachment.name} draggable={false} className="size-full object-cover" onError={() => setFailedSrc(src)} />
          : <Picture className="size-4 text-primary-500" />
      ) : (
        <FileIconComponent fileName={attachment.name} className="size-4" />
      )}
    </div>
  );
}

function QueuedMessageRow({ message, controls, canSteer, busy, sortHandle, canReorder }: {
  message: QueuedRunMessage; controls: ComposerRunQueue; canSteer: boolean; busy: boolean;
  sortHandle: SortableHandle; canReorder: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setMenuOpen(false), triggerRef);
  const editable = !controls.editing && ["queued", "error"].includes(message.status);
  const immutable = message.status === "sending" || message.status === "editing";
  const [uploads] = useTransientUploads(message.uploadOwnerKey);
  const preview = uploads.length ? buildQueuedMessagePreview(message, uploads) : message.preview ?? buildQueuedMessagePreview(message, uploads);
  return <div role="listitem" className="group/queued-message relative flex min-w-0 items-center gap-2 py-2.5 pl-7 pr-4 text-primary-600 dark:text-primary-400">
    {canReorder && (
      <Button ref={(element) => sortHandle.ref(element)}
        onPointerDown={(event) => sortHandle.listeners?.onPointerDown?.(event)}
        onKeyDown={(event) => sortHandle.onKeyDown?.(event)}
        aria-label={`Reorder queued message: ${preview.label}`} title="Drag to reorder, or use Alt+Arrow up/down"
        className="absolute left-1.5 top-1/2 flex size-4 -translate-y-1/2 touch-none items-center justify-center rounded-sm opacity-0 hover:text-primary-800 focus-visible:opacity-100 group-hover/queued-message:opacity-100 group-focus-within/queued-message:opacity-100 active:cursor-grabbing dark:hover:text-primary-200 cursor-grab [@media(hover:none)]:opacity-100">
        <Drag className="size-3.5" />
      </Button>
    )}
    <Queue className="size-3.5 rotate-180" />
    {preview.attachment && <QueuedAttachment attachment={preview.attachment} />}
    <div className="min-w-0 flex-1">
      <p title={preview.label} className="truncate text-s text-primary-800 dark:text-primary-200">{preview.label}</p>
      {message.status !== "queued" && <p className="truncate text-xs">{MESSAGE_STATUS_LABEL[message.status]}</p>}
      {message.error && <p className="truncate text-xs text-warning" title={message.error}>{message.error}</p>}
    </div>
      <div className="flex shrink-0 items-center gap-0.5 text-xs text-primary-600 dark:text-primary-400">
        {message.status !== "editing" &&
          <Button type="button" disabled={!canSteer || busy || message.status !== "queued"}
            onClick={() => controls.onSteer(message.id)} aria-label={`Steer: ${message.text || "attachment"}`}
            tooltip="Send to the active turn now" className="flex items-center gap-1 rounded-full px-1.5 py-1  hover:text-primary-700  dark:hover:text-primary-300 cursor-pointer">
            <Steer className="size-4" /> <span>Steer</span>
          </Button>}
        <Button variant="icon" iconSize="sm" type="button" disabled={immutable} onClick={() => controls.onRemove(message.id)}
          aria-label={`Remove queued message: ${message.text || "attachment"}`} tooltip="Remove message"
          className="enabled:hover:text-danger dark:enabled:hover:text-danger">
          <Trash className="size-4" />
        </Button>
        <div className="relative shrink-0">
          <Button variant="icon" iconSize="xs" ref={triggerRef} type="button" onClick={() => setMenuOpen((open) => !open)}
            aria-label="Queued message options" aria-haspopup="menu" aria-expanded={menuOpen}
          >
            <Option width={16} height={16} className="pointer-events-none size-4 shrink-0 rotate-90" />
          </Button>
          <DropdownWrapper isOpen={menuOpen} dropdownRef={menuRef} triggerRef={triggerRef} usePortal
            openUpward position="right" matchTriggerWidth={false} minWidth="min-w-48" aria-label="Queued message options">
            <div className="p-1">
              <Button role="menuitem" disabled={!editable} onClick={() => { setMenuOpen(false); controls.onEdit(message.id); }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-s hover:bg-primary-200/50 dark:hover:bg-primary/5 text-primary-800 dark:text-primary-200 ">
                <Edit className="size-4" /> Edit message
              </Button>
              <Button role="menuitem" onClick={() => { setMenuOpen(false); controls.onModeChange(controls.queue?.mode === "steer" ? "queue" : "steer"); }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-s hover:bg-primary-200/50 dark:hover:bg-primary/5 text-primary-800 dark:text-primary-200">
                <Queue className="size-3.5 rotate-180" /> Turn {controls.queue?.mode === "steer" ? "on" : "off"} queuing
              </Button>
            </div>
          </DropdownWrapper>
        </div>
      </div>
  </div>;
}

export function ComposerQueueCard({ controls, isRunning }: { controls: ComposerRunQueue; isRunning: boolean }) {
  const queue = controls.queue;
  if (!queue || (!queue.messages.length && queue.mode === "queue")) return null;
  const busy = queue.messages.some((message) => message.status === "sending");
  const canReorder = queue.messages.length > 1 && !controls.editing &&
    !queue.messages.some((message) => ["sending", "editing", "unknown"].includes(message.status));
  return (
    <div className="mx-auto mb-1 min-w-0 w-full max-w-210" aria-label="Queued messages">
      <div className="rounded-3xl glass-surface overflow-hidden">
        {queue.messages.length > 0 && (
          <div role="list" className="min-w-0 max-h-48 overflow-x-hidden overflow-y-auto">
            <SortableList ids={queue.messages.map((message) => message.id)} onReorder={controls.onReorder} disabled={!canReorder}
              className="divide-y divide-primary-200/50 dark:divide-primary-800/50">
              {queue.messages.map((message) => (
                <SortableItem key={message.id} id={message.id}>
                  {(sortHandle) => <QueuedMessageRow message={message} controls={controls} canSteer={isRunning} busy={busy} sortHandle={sortHandle} canReorder={canReorder} />}
                </SortableItem>
              ))}
            </SortableList>
          </div>
        )}
        {queue.pauseReason && queue.messages.length > 0 && (
          <div className="flex items-center gap-2 border-t border-primary-200/50 px-4 py-2 text-xs text-primary-600 dark:border-primary-800 dark:text-primary-400" role="status">
            <span className="min-w-0 flex-1">{queue.pauseReason}</span>
            <Button disabled={busy} onClick={controls.onResume} className="shrink-0 rounded-full px-2 py-1 text-primary-800 hover:bg-primary-200/40 dark:text-primary-200 dark:hover:bg-primary-800 cursor-pointer">
              {queue.messages.some((message) => message.status === "unknown") ? "Check delivery" : "Resume queue"}
            </Button>
          </div>
        )}
        {queue.mode === "steer" && (
          <div className="flex items-center justify-between gap-2 px-4 py-3 text-xs text-primary-600 dark:text-primary-400">
            <span>Messages {isRunning ? "steer the active turn" : "send directly"}</span>
            <Button onClick={() => controls.onModeChange("queue")} className="shrink-0 rounded-full px-2 py-1 text-primary-800 hover:bg-primary-200/40 dark:text-primary-200 dark:hover:bg-primary-800 cursor-pointer">
              Turn on queuing
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
