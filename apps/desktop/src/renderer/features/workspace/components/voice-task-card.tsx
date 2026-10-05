import { useEffect } from "react";
import type { VoiceTaskLink } from "@mains/contracts/realtime";
import { Button, Text } from "@/components/ui";
import { Codex } from "@/components/ui/icons";
import { useGetRunByIdQuery } from "@/lib/redux/api";
import { appEvents } from "@/lib/transport";
import { useJumpToRun } from "../hooks/use-jump-to-run";

/** A navigation card; the actual worker transcript stays in its own chat. */
export function VoiceTaskCard({ task }: { task: VoiceTaskLink }) {
  const jump = useJumpToRun();
  const { data: run, refetch, isLoading } = useGetRunByIdQuery(task.id);
  useEffect(() => {
    const update = ({ runId }: { runId: string }) => { if (runId === task.id) void refetch(); };
    const offStatus = appEvents.runs.onStatusChanged(update);
    const offUpdated = appEvents.runs.onUpdated(update);
    return () => { offStatus(); offUpdated(); };
  }, [task.id, refetch]);
  const status = !run ? isLoading ? "Starting…" : "Unavailable"
    : run.status === "running" || run.status === "queued" ? "Working"
    : run.status === "succeeded" ? "Reply ready" : run.status === "canceled" ? "Stopped" : "Failed";
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-3xl glass-card px-5 py-4">
        <Codex className="size-6 dark:text-primary-200 text-primary-800" />
      <div className="min-w-0 flex-1">
        <Text size="sm" weight="medium" className="truncate">{run?.title || task.title}</Text>
        <Text size="xs" tone="muted" role="status">{status}</Text>
      </div>
      <Button variant="secondary" type="button" disabled={!run || run.isArchived} onClick={() => { void jump(run || task); }}
        aria-label={`Open chat: ${run?.title || task.title}`} className="shrink-0 rounded-xl  px-3 py-1.5 text-xs cursor-pointer">
        Open chat
      </Button>
    </div>
  );
}
