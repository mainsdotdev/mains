import { useLocalSearchParams } from "expo-router";
import { OutputDocument } from "@/features/runs";

export default function OutputScreen() {
  const { runId, artifactId } = useLocalSearchParams<{ runId: string; artifactId: string }>();
  return <OutputDocument key={`${runId}:${artifactId}`} runId={typeof runId === "string" ? runId : ""} artifactId={Number(artifactId)} />;
}
