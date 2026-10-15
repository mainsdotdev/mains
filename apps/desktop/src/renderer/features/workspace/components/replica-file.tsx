import { Button, Text, toast } from "@/components/ui";
import { FileIconComponent } from "@/components/ui/icons";
import { appApi } from "@/lib/transport";
import { useDocumentViewer } from "@/hooks/use-document-viewer";
import { classifyDocType } from "@/lib/document-viewer";

export function ReplicaFile({ runId, artifactId, name }: { runId: string; artifactId: number; name: string }) {
  const { open } = useDocumentViewer(), docType = classifyDocType(name);
  return <Button className="my-3 flex max-w-full items-center gap-3 rounded-xl glass-card p-3" disabled={!docType} aria-label={`Open ${name}`} onClick={async () => {
    try {
      const result = await appApi.runArtifacts.resolveFilePath({ runId, artifactId });
      if (!result.success) throw new Error(result.error);
      if (docType) open({ path: result.data, fileName: name, docType });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not open file"); }
  }}><FileIconComponent fileName={name} className="size-5" /><Text size="sm" className="truncate">{name}</Text></Button>;
}
