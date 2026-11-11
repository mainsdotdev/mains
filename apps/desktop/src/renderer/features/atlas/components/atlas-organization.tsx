import { useState } from "react";
import type { AtlasTag } from "@mains/contracts/atlas";
import { Button, Input, Modal, ModalHeader, Muted, Text, toast } from "@/components/ui";
import { Trash } from "@/components/ui/icons";
import { useListAtlasTagsQuery, useRemoveAtlasTagMutation, useRenameAtlasTagMutation } from "@/lib/redux/api/atlasApi";
import DeleteConfirmationModal from "@/components/layout/sidebar/delete-confirmation-modal";
import { atlasError } from "../hooks/use-save-to-atlas";

export function AtlasOrganization({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  return <Modal isOpen onClose={onClose} className="w-full max-w-lg max-h-[min(32rem,80dvh)]">
    <ModalHeader onClose={onClose}><Text weight="medium">Manage tags</Text></ModalHeader>
    <TagManager accountId={accountId} />
  </Modal>;
}
function TagManager({ accountId }: { accountId: string }) {
  const tags = useListAtlasTagsQuery({ accountId });
  const [remove, removing] = useRemoveAtlasTagMutation();
  const [deleting, setDeleting] = useState<AtlasTag | null>(null);
  return <div className="flex min-h-0 flex-col overflow-hidden px-6 pb-6">
    <Muted className="shrink-0 text-xs">Tags are shared across your Atlas library. Renaming a tag updates every item that uses it.</Muted>
    <div className="relative flex max-h-80 min-h-0 flex-col">
      <div role="region" aria-label="Tags" className="min-h-0 overflow-y-auto overscroll-contain py-6 pr-1 [scroll-padding-block:1.5rem]">
        {tags.isLoading ? <Muted>Loading tags…</Muted> : tags.error ? <Text role="alert">{atlasError(tags.error)}</Text> : !tags.data?.length ? <Muted>No tags yet. Add one when saving a bookmark.</Muted> :
          tags.data.map((tag) => <TagRow key={tag.id} accountId={accountId} tag={tag} onDelete={() => setDeleting(tag)} />)}
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-linear-to-b from-(--glass-fill-surface) to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-linear-to-t from-(--glass-fill-surface) to-transparent" />
    </div>
    <DeleteConfirmationModal isOpen={!!deleting} isDeleting={removing.isLoading} title={`Delete “${deleting?.name ?? "tag"}”?`}
      description="This removes the tag from every Atlas item. Your saved items are kept."
      onCancel={() => setDeleting(null)} onConfirm={() => { if (deleting) void remove({ accountId, id: deleting.id }).unwrap().then(() => setDeleting(null)).catch((error) => toast.error(atlasError(error))); }} />
  </div>;
}
function TagRow({ accountId, tag, onDelete }: { accountId: string; tag: AtlasTag; onDelete: () => void }) {
  const [name, setName] = useState(tag.name);
  const [rename, renaming] = useRenameAtlasTagMutation();
  return <form className="mb-2 flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void rename({ accountId, id: tag.id, name }).unwrap().catch((error) => toast.error(atlasError(error))); }}>
    <Input aria-label={`Name for ${tag.name}`} maxLength={64} value={name} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1" />
    <Text size="xs" tone="subtle" className="w-8 text-center" title="Items using this tag">{tag.count}</Text>
    <Button type="submit" variant="ghost" disabled={renaming.isLoading || !name.trim() || name === tag.name}>Save</Button>
    <Button type="button" variant="icon" aria-label={`Delete tag ${tag.name}`} onClick={onDelete}><Trash className="size-4" /></Button>
  </form>;
}
