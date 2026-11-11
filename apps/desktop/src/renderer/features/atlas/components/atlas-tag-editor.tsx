import { useId, useState } from "react";
import type { AtlasItem } from "@mains/contracts/atlas";
import { Button, Modal, ModalHeader, Select, Text } from "@/components/ui";
import { useListAtlasTagsQuery, useSetAtlasTagsMutation } from "@/lib/redux/api/atlasApi";
import { getTransport } from "@/lib/transport";
import { atlasError } from "../hooks/use-save-to-atlas";

export function AtlasTagEditor({ item, onClose }: { item: AtlasItem; onClose: () => void }) {
  const id = useId();
  const [tags, setTags] = useState((item.tags ?? []).map((tag) => tag.id));
  const [error, setError] = useState("");
  const known = useListAtlasTagsQuery({ accountId: item.accountId });
  const [save, saving] = useSetAtlasTagsMutation();
  const options = new Map((item.tags ?? []).map((tag) => [tag.id, { value: tag.id, label: tag.name }]));
  for (const tag of known.data ?? []) options.set(tag.id, { value: tag.id, label: tag.name });
  for (const tag of tags) if (!options.has(tag)) options.set(tag, { value: tag, label: tag });
  const close = () => { if (!saving.isLoading) onClose(); };
  const submit = async () => {
    if (saving.isLoading) return;
    const transport = getTransport();
    setError("");
    try {
      await save({ accountId: item.accountId, id: item.id, tags }).unwrap();
      if (getTransport() === transport) onClose();
    } catch (error) {
      if (getTransport() === transport) setError(atlasError(error));
    }
  };
  return (
    <Modal isOpen onClose={close} className="w-full max-w-lg">
      <ModalHeader onClose={close}><Text weight="medium">Edit tags</Text></ModalHeader>
      <form className="min-h-0 overflow-y-auto px-6 pb-6" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Text size="s" tone="subtle" className="mb-5 line-clamp-2">{item.title}</Text>
        <label htmlFor={id} className="mb-1.5 block text-xs text-primary-600 dark:text-primary-400">Tags</label>
        <Select id={id} aria-label="Tags" multiple showSelectedOptions={false} size="sm" value={tags} onChange={setTags} animationDirection="down"
          options={[...options.values()]} placeholder="Select or create tags" searchPlaceholder="Search tags"
          emptyMessage="No tags yet. Type to create one." maxSelected={30} maxSearchLength={64}
          disabled={saving.isLoading || known.isLoading}
          onCreateOption={(value) => {
            const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
            if (!name || name.length > 64) { setError("Tag names must be 64 characters or fewer"); return undefined; }
            return name;
          }} />
        {error && <Text role="alert" className="mt-4 text-danger">{error}</Text>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={saving.isLoading}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving.isLoading || known.isLoading}>{saving.isLoading ? "Saving…" : "Save tags"}</Button>
        </div>
      </form>
    </Modal>
  );
}
