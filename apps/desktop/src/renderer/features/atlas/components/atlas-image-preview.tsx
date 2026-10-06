import { Button, Modal, Muted, Text } from "@/components/ui";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";

export function AtlasImagePreview({ title, path, onClose }: {
  title: string;
  path: string | null;
  onClose: () => void;
}) {
  const src = useLocalImageUrl(path ?? "");
  return <Modal isOpen onClose={onClose} aria-label={title} className="max-w-5xl p-4">
    <div className="mb-4 flex items-center justify-between gap-4">
      <Text weight="medium">{title}</Text>
      <Button variant="ghost" onClick={onClose}>Close</Button>
    </div>
    {src ? <img src={src} alt={title} className="max-h-[75vh] w-full object-contain" /> : <Muted>Opening image…</Muted>}
  </Modal>;
}
