import { useLocalSearchParams } from "expo-router";
import { AttachmentDocument } from "@/features/runs";

export default function AttachmentScreen() {
  const { runId, attachmentId } = useLocalSearchParams<{ runId: string; attachmentId: string }>();
  return <AttachmentDocument key={`${runId}:${attachmentId}`} runId={typeof runId === "string" ? runId : ""} attachmentId={typeof attachmentId === "string" ? attachmentId : ""} />;
}
