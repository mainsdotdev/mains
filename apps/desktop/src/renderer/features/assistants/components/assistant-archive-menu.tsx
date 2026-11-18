import { useId, useLayoutEffect, useRef, useState } from "react";
import type { Assistant } from "@mains/contracts/assistants";
import DeleteConfirmationModal from "@/components/layout/sidebar/delete-confirmation-modal";
import { Button, DropdownMenu, Input, Muted, toast } from "@/components/ui";
import { Archive, Search, Trash, Undo } from "@/components/ui/icons";
import { useArchiveAssistantMutation, useRemoveAssistantMutation } from "@/lib/redux/api/assistantsApi";
import { getTransport } from "@/lib/transport";
import { errorText } from "../lib/assistant-ui";
import { AssistantAvatar } from "./assistant-avatar";

const actionClass = "flex size-8 shrink-0 items-center justify-center rounded-lg text-primary-500 focus-visible:ring-2";

export function AssistantArchiveMenu({ accountId, assistants, error, onOpen, onRemoved }: {
  accountId: string;
  assistants?: Assistant[];
  error?: unknown;
  onOpen(id: string): void;
  onRemoved(id: string): void;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const removedCallback = useRef<typeof onRemoved | null>(onRemoved);
  useLayoutEffect(() => {
    removedCallback.current = onRemoved;
    return () => { removedCallback.current = null; };
  }, [onRemoved]);
  const [position, setPosition] = useState<{ x: number; y: number; anchorTop: number } | null>(null);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<Assistant | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pending = useRef(false);
  const [archive] = useArchiveAssistantMutation();
  const [remove] = useRemoveAssistantMutation();
  const search = query.trim().toLocaleLowerCase();
  const matches = (assistants ?? []).filter(mate => mate.isArchived &&
    (!search || `${mate.name} ${mate.description}`.toLocaleLowerCase().includes(search)))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  async function update(mate: Assistant, action: "restore" | "delete") {
    if (pending.current) return;
    const transport = getTransport();
    const payload = { accountId, id: mate.id };
    pending.current = true;
    setPendingId(mate.id);
    try {
      if (action === "restore") {
        await archive({ ...payload, archived: false }).unwrap();
        if (getTransport() === transport) searchRef.current?.focus();
      } else {
        await remove(payload).unwrap();
        if (getTransport() === transport) {
          setDeleting(null);
          removedCallback.current?.(mate.id);
        }
      }
    } catch (cause) {
      if (removedCallback.current && getTransport() === transport) toast.error(errorText(cause));
    } finally {
      pending.current = false;
      setPendingId(null);
    }
  }

  return <>
    <Button id={id} ref={triggerRef} aria-haspopup="menu" aria-expanded={!!position}
      className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-s text-primary-950 hover:bg-primary/50 aria-expanded:bg-primary/50 dark:text-primary dark:hover:bg-primary/5 dark:aria-expanded:bg-primary/5"
      onMouseDown={event => { if (position) event.stopPropagation(); }}
      onClick={(event) => {
        if (position) { setPosition(null); return; }
        const rect = event.currentTarget.getBoundingClientRect();
        setQuery("");
        setPosition({ x: rect.right + 8, y: rect.bottom, anchorTop: rect.bottom });
      }}>
      <Archive className="size-4 shrink-0" aria-hidden />
      Archived
    </Button>
    <DropdownMenu isOpen={!!position} position={position ?? { x: 0, y: 0 }} onClose={() => setPosition(null)}
      aria-labelledby={id} initialFocusRef={searchRef} openUpward origin="bottom-left" minWidth={0}
      className="flex max-h-[min(560px,calc(100vh-16px))] w-[min(320px,calc(100vw-16px))] flex-col p-2">
      <div className="relative m-1 mb-3 shrink-0">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary-500" aria-hidden />
        <Input ref={searchRef} aria-label="Search archived mates" placeholder="Search archived mates"
          value={query} onChange={event => setQuery(event.target.value)} className="glass-input pl-9" />
      </div>
      <div className="min-h-0 overflow-y-auto noscrollbar">
        {error ? <p role="alert" className="px-3 py-4 text-sm text-danger">{errorText(error)}</p>
          : !assistants ? <Muted className="px-3 py-8 text-center">Loading archived mates…</Muted>
          : !matches.length ? <Muted className="px-3 py-8 text-center">{search ? "No matching mates" : "No archived mates"}</Muted>
          : matches.map(mate => (
            <div key={mate.id} className="flex items-center gap-1 rounded-xl px-1 hover:bg-primary-200/40 focus-within:bg-primary-200/40 dark:hover:bg-primary/5 dark:focus-within:bg-primary/5">
              <Button role="menuitem" tabIndex={-1} aria-label={`Open ${mate.name}`}
                onClick={() => { setPosition(null); onOpen(mate.id); }}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left focus-visible:ring-2 focus-visible:ring-accent/40">
                <AssistantAvatar avatar={mate.avatar} animated={false} className="size-6" />
                <span className="min-w-0">
                  <span className="block truncate text-s text-primary-900 dark:text-primary-100">{mate.name}</span>
                  {mate.description && <span className="block truncate text-xs text-primary-500">{mate.description}</span>}
                </span>
              </Button>
              <Button role="menuitem" tabIndex={-1} aria-label={`Restore ${mate.name}`} title="Restore"
                disabled={!!pendingId} aria-busy={pendingId === mate.id}
                onClick={() => void update(mate, "restore")}
                className={`${actionClass} hover:bg-primary-200/40 hover:text-primary-900 focus-visible:ring-accent/40 dark:hover:bg-primary/5 dark:hover:text-primary-100`}>
                <Undo className="size-4" aria-hidden />
              </Button>
              <Button role="menuitem" tabIndex={-1} aria-label={`Delete ${mate.name} permanently`} title="Delete permanently"
                disabled={!!pendingId} onClick={() => { setPosition(null); setDeleting(mate); }}
                className={`${actionClass} hover:bg-danger/10 hover:text-danger focus-visible:ring-danger/40`}>
                <Trash className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
      </div>
    </DropdownMenu>
    <DeleteConfirmationModal isOpen={!!deleting} isDeleting={!!deleting && pendingId === deleting.id}
      onConfirm={() => { if (deleting) void update(deleting, "delete"); }}
      onCancel={() => { if (!pending.current) setDeleting(null); }}
      title={`Delete ${deleting?.name ?? "mate"} permanently?`}
      description="This permanently deletes this Mate, its conversations, private memory, routines, and assignments it received."
      returnFocusRef={triggerRef} />
  </>;
}
