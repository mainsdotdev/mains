import { Stack, useLocalSearchParams } from "expo-router";
import { HistoryContentView } from "@/features/runs";

export default function HistoryContentScreen() {
  const params = useLocalSearchParams<{ runId: string; source: string; id: string }>();
  const source = params.source === "tool-input" || params.source === "tool-output" || params.source === "turn-diff" ? params.source : "artifact";
  return <>
    <Stack.Screen options={{ title: source === "turn-diff" ? "Changes" : "Full content" }} />
    <HistoryContentView key={`${params.runId}:${source}:${params.id}`} runId={params.runId ?? ""} source={source} id={Number(params.id)} />
  </>;
}
