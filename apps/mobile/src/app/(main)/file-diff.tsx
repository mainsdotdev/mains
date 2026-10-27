import { Stack, useLocalSearchParams } from "expo-router";
import { TurnFileDiffView } from "@/features/runs";

export default function FileDiffScreen() {
  const params = useLocalSearchParams<{ backendId: string; runId: string; turnId: string; filePath: string; oldPath?: string }>();
  return <>
    <Stack.Screen options={{ title: params.filePath?.split("/").pop() || "Changes" }} />
    <TurnFileDiffView key={`${params.backendId}:${params.runId}:${params.turnId}:${params.filePath}`}
      backendId={params.backendId ?? ""} runId={params.runId ?? ""} turnId={Number(params.turnId)}
      filePath={params.filePath ?? ""} oldPath={params.oldPath} />
  </>;
}
