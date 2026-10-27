import { useRouter, type Href } from "expo-router";
import type { PromptDocument } from "@/lib/prompt-documents";
import { isDesktopOnlyOutput } from "@/lib/output-presentation";
import { RunFileCard } from "../outputs/output-file-card";

export function PromptAttachmentCard({ document }: { document: PromptDocument }) {
  const router = useRouter();
  const attachmentId = document.attachmentId;
  return <RunFileCard name={document.name} byteSize={document.byteSize} desktopOnly={isDesktopOnlyOutput(document)}
    status={document.pending ? "Sending…" : !document.attachmentId ? "Preview unavailable" : undefined}
    onPress={attachmentId ? () => router.push({ pathname: "/attachment/[attachmentId]", params: { runId: document.runId, attachmentId } } as Href) : undefined} />;
}
