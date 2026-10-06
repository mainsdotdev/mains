import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PR_ATTACHMENT_LIMIT, prMediaType, validatePrMedia } from "@mains/contracts/pr-attachments";
import { toast } from "@/components/ui";
import { onTransportChange } from "@/lib/transport";

export interface PrMediaAsset { id: string; file: File; url: string; type: string }

/** The PR row owns Files and object URLs, so moving its fields never loses media. */
export function usePrAttachments(workspaceId: string, onDiscard: (ids: string[]) => void) {
  const onDiscardRef = useRef(onDiscard);
  useLayoutEffect(() => { onDiscardRef.current = onDiscard; }, [onDiscard]);
  const [assets, setAssets] = useState<PrMediaAsset[]>([]);
  const [owner, setOwner] = useState(workspaceId);
  if (owner !== workspaceId) {
    setOwner(workspaceId);
    setAssets([]);
  }
  const current = useRef(assets);
  const clear = useCallback(() => {
    onDiscardRef.current(current.current.map((asset) => asset.id));
    current.current.forEach((asset) => URL.revokeObjectURL(asset.url));
    current.current = [];
    setAssets([]);
  }, []);
  useEffect(() => {
    const unsubscribe = onTransportChange(clear);
    return () => {
      unsubscribe();
      current.current.forEach((asset) => URL.revokeObjectURL(asset.url));
      current.current = [];
    };
  }, [workspaceId, clear]);

  const add = useCallback((files: File[]) => {
    const next = [...current.current];
    const accepted: PrMediaAsset[] = [];
    for (const file of files) {
      const error = validatePrMedia(file.name, file.size);
      if (error) { toast.error(error); continue; }
      const existing = next.find((asset) => asset.file.name === file.name && asset.file.size === file.size && asset.file.lastModified === file.lastModified);
      if (existing) { accepted.push(existing); continue; }
      if (next.length >= PR_ATTACHMENT_LIMIT) { toast.error(`You can attach up to ${PR_ATTACHMENT_LIMIT} files.`); break; }
      const type = prMediaType(file.name)!;
      const asset = { id: crypto.randomUUID(), file, type, url: URL.createObjectURL(new Blob([file], { type })) };
      next.push(asset);
      accepted.push(asset);
    }
    current.current = next;
    setAssets(next);
    return accepted;
  }, []);
  const remove = useCallback((id: string) => {
    const asset = current.current.find((entry) => entry.id === id);
    if (asset) URL.revokeObjectURL(asset.url);
    onDiscardRef.current([id]);
    const next = current.current.filter((entry) => entry.id !== id);
    current.current = next;
    setAssets(next);
  }, []);
  return { assets, add, remove, clear };
}
