import { useLocalSearchParams } from "expo-router";
import { HistoryContentView } from "@/features/runs";

export default function HistoryContentScreen() {
  const params = useLocalSearchParams<{ runId: string; source: string; id: string }>();
  const source = params.source === "tool-input" || params.source === "tool-output" ? params.source : "artifact";
  return <HistoryContentView runId={params.runId ?? ""} source={source} id={Number(params.id)} />;
}
