import { useId, useRef, useState } from "react";
import type { AtlasItem } from "@mains/contracts/atlas";
import { Button, Input, Modal, ModalHeader, Select, Text, Textarea, toast } from "@/components/ui";
import { Generate, Page } from "@/components/ui/icons";
import { Bookmark } from "@/components/ui/icons/space";
import { useListCollectionsQuery } from "@/lib/redux/api";
import { useAtlasAutoTaggingQuery, useListAtlasTagsQuery, useSaveAtlasBookmarkMutation } from "@/lib/redux/api/atlasApi";
import { getTransport } from "@/lib/transport";
import { atlasError } from "../hooks/use-save-to-atlas";

export function AtlasBookmarkEditor({ accountId, item, collectionId, onClose }: {
  accountId: string; item?: AtlasItem; collectionId?: string; onClose: () => void;
}) {
  const prefix = useId(), urlRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(item?.url ?? "");
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  const [project, setProject] = useState(item?.collectionId ?? collectionId ?? "");
  const [tags, setTags] = useState((item?.tags ?? []).map((tag) => tag.id));
  const [error, setError] = useState("");
  const knownTags = useListAtlasTagsQuery({ accountId });
  const automatic = useAtlasAutoTaggingQuery({ accountId });
  const aiEnabled = automatic.currentData?.enabled === true;
  const tagOptions = new Map((item?.tags ?? []).map((tag) => [tag.id, { value: tag.id, label: tag.name }]));
  for (const tag of knownTags.data ?? []) tagOptions.set(tag.id, { value: tag.id, label: tag.name });
  for (const tag of tags) if (!tagOptions.has(tag)) tagOptions.set(tag, { value: tag, label: tag });
  const { data: collections = [] } = useListCollectionsQuery({ accountId });
  const [save, saving] = useSaveAtlasBookmarkMutation();
  const createTag = (value: string) => {
    const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!name || name.length > 64) { setError("Tag names must be 64 characters or fewer"); return undefined; }
    return name;
  };
  const submit = async () => {
    if (saving.isLoading) return;
    const transport = getTransport(); setError("");
    try {
      await save({ accountId, id: item?.id, url, title: item ? title : title.trim() || undefined, description: item ? description : description || undefined,
        note, collectionId: project || null, tags }).unwrap();
      if (getTransport() !== transport) return;
      toast.success("Bookmark saved to Atlas"); onClose();
    } catch (error) { setError(atlasError(error)); }
  };
  return <Modal isOpen onClose={() => { if (!saving.isLoading) onClose(); }} initialFocusRef={urlRef} className="w-full max-w-xl">
    <ModalHeader onClose={onClose}><Bookmark className="size-4 text-primary-500" /><Text weight="medium">{item ? "Edit bookmark" : "Save a bookmark"}</Text></ModalHeader>
    <form className="min-h-0 overflow-y-auto px-6 pb-6" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="space-y-4">
        <label className="block space-y-1.5 text-xs text-primary-600 dark:text-primary-400" htmlFor={`${prefix}-url`}>URL
          <Input ref={urlRef} id={`${prefix}-url`} type="url" required maxLength={4096} placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} className="mt-1.5" />
        </label>
        <div>
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs text-primary-600 dark:text-primary-400" htmlFor={`${prefix}-title`}>Title</label>
            <span className="inline-flex items-center gap-1 rounded-md bg-primary-100 px-1.5 py-0.5 text-xxs text-primary-500 dark:bg-primary-800/60"><Page aria-hidden="true" className="size-3" />From page</span>
          </div>
          <Input id={`${prefix}-title`} maxLength={240} placeholder="Fetched automatically if left blank" value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1.5" />
        </div>
        <div>
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs text-primary-600 dark:text-primary-400" htmlFor={`${prefix}-description`}>Description</label>
            <span className="inline-flex items-center gap-1 rounded-md bg-primary-100 px-1.5 py-0.5 text-xxs text-primary-500 dark:bg-primary-800/60"><Page aria-hidden="true" className="size-3" />From page</span>
          </div>
          <Textarea id={`${prefix}-description`} maxLength={2000} rows={2} placeholder="Fetched automatically if left blank" value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1.5" />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <label htmlFor={`${prefix}-tags`} className="text-xs text-primary-600 dark:text-primary-400">Tags</label>
            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xxs ${aiEnabled ? "bg-accent/10 text-accent" : "bg-primary-100 text-primary-500 dark:bg-primary-800/60"}`}>
              <Generate aria-hidden="true" className="size-3" />{automatic.isLoading ? "Checking AI…" : automatic.error ? "AI unavailable" : aiEnabled ? "AI-assisted" : "AI off"}
            </span>
          </div>
          <Select id={`${prefix}-tags`} aria-label="Tags" multiple size="sm" value={tags} onChange={setTags}
            options={[...tagOptions.values()].map((option) => ({ ...option,
              selectedIcon: item?.tags?.find((tag) => tag.id === option.value)?.source === "ai" ? <Generate aria-label="AI-generated tag" className="size-3 shrink-0" /> : undefined }))}
            placeholder="Select or create tags" searchPlaceholder="Search tags" emptyMessage="No tags yet. Type to create one."
            disabled={saving.isLoading || knownTags.isLoading} maxSelected={30} maxSearchLength={64} onCreateOption={createTag} />
          <Text size="xs" tone="subtle" className="mt-2 leading-relaxed">
            {automatic.isLoading ? "Checking automatic tagging settings…" : automatic.error ? "Could not check AI settings. You can still choose tags manually."
              : aiEnabled ? "AI adds tags and identifies the content type after saving. Your own tags are kept."
              : "Choose multiple tags or create new ones. Enable AI suggestions in Settings → Atlas."}
          </Text>
        </div>
        <label className="block text-xs text-primary-600 dark:text-primary-400" htmlFor={`${prefix}-note`}>Note
          <Textarea id={`${prefix}-note`} maxLength={10000} rows={2} placeholder="Why are you saving this?" value={note} onChange={(event) => setNote(event.target.value)} className="mt-1.5" />
        </label>
        <div>
          <label className="text-xs text-primary-600 dark:text-primary-400" htmlFor={`${prefix}-project`}>Project</label>
          <div className="mt-1.5">
            <Select id={`${prefix}-project`} aria-label="Project" size="sm" value={project} onChange={setProject}
              options={[{ value: "", label: "No project" }, ...collections.map((collection) => ({ value: collection.id, label: collection.name }))]} />
          </div>
        </div>
      </div>
      {error && <Text role="alert" className="mt-4 text-danger">{error}</Text>}
      <div className="mt-6 flex items-center justify-between gap-4">
        <Text size="xs" tone="subtle">Only the URL is required. Automatic fields are filled after saving.</Text>
        <Button type="submit" variant="primary" disabled={saving.isLoading || !url.trim()}>{saving.isLoading ? "Saving…" : "Save bookmark"}</Button>
      </div>
    </form>
  </Modal>;
}
