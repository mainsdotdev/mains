import { useState } from "react";
import { Button, Text } from "@/components/ui";
import { ImagePreviewModal } from "./image-preview-modal";
import { useArtifactImage } from "../lib/attachment-image";

function ReplicaImagePreview({ runId, artifactId, name, fallback, onClose }: {
  runId: string; artifactId: number; name: string; fallback: string; onClose(): void;
}) {
  const { src } = useArtifactImage(runId, artifactId, 1600, true);
  return <ImagePreviewModal name={name} src={src ?? fallback} onClose={onClose} />;
}

export function ReplicaImage({ runId, artifactId, name }: { runId: string; artifactId: number; name: string }) {
  const { observe, src, error } = useArtifactImage(runId, artifactId);
  const [expanded, setExpanded] = useState(false);
  return <div ref={observe} className="my-3 w-fit max-w-full">
    {error ? <Text size="xs" tone="muted">{error}</Text> :
      <Button aria-label={`Preview ${name}`} title={`Preview ${name}`} disabled={!src} onClick={() => setExpanded(true)} className="min-h-24 min-w-24 overflow-hidden rounded-xl">
        {src ? <img src={src} alt={name} className="max-h-64 max-w-full object-contain" /> : <Text size="xs" tone="muted">Loading {name}…</Text>}
      </Button>}
    {expanded && src && <ReplicaImagePreview runId={runId} artifactId={artifactId} name={name} fallback={src} onClose={() => setExpanded(false)} />}
  </div>;
}
