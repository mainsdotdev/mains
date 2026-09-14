import { Caption, ChartCard } from "@/components/ui";
import { Chat } from "@/components/ui/icons";
import type { RecentSession } from "@/lib/redux/api";
import { formatCostUSD, formatDurationMs } from "@/lib/format";

interface RecentSessionsListProps {
  sessions: RecentSession[];
}

const PROVIDER_COLORS: Record<string, string> = {
  claude_code: "var(--color-claude)",
  copilot_cli: "var(--color-copilot)",
  codex: "var(--color-codex)",
  cursor: "var(--color-cursor)",
};



export default function RecentSessionsList({ sessions }: RecentSessionsListProps) {
  return (
    <ChartCard
      title="Recent Sessions"
      icon={Chat}
      isEmpty={sessions.length === 0}
      emptyMessage="No sessions yet"
      emptyHeight="flex-1"
      className="h-full flex flex-col"
    >
      <div className="space-y-2 overflow-y-auto min-h-0 flex-1">
        {sessions.map((s) => (
          <div
            key={s.runId}
            className="flex items-center gap-2.5 py-1.5"
          >
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: PROVIDER_COLORS[s.providerId] ?? "var(--color-primary-500)" }}
            />
            <div className="flex-1 min-w-0">
              <Caption>
                {s.title ?? s.goal ?? "Untitled run"}
              </Caption>
              <div className="flex items-center gap-2 mt-0.5">
                {s.projectName && (
                  <Caption>
                    {s.projectName}
                  </Caption>
                )}
              </div>
            </div>
            {/* Metadata, so it sits a stop below the run's own title. The tone
                belongs on each `Caption` — one on this row would never reach
                them, since `Caption` colours itself. */}
            <div className="flex items-center gap-3 shrink-0">
              {s.durationMs !== null && (
                <Caption tone="subtle">{formatDurationMs(s.durationMs)}</Caption>
              )}
              {s.totalCostUsd !== null && s.totalCostUsd > 0 && (
                <Caption tone="subtle">{formatCostUSD(s.totalCostUsd)}</Caption>
              )}
            </div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}
