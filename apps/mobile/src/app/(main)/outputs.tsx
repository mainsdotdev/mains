import { useLocalSearchParams } from "expo-router";
import { OutputsPanel } from "@/features/runs";

export default function OutputsScreen() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  return <OutputsPanel key={runId} runId={typeof runId === "string" ? runId : ""} />;
}
