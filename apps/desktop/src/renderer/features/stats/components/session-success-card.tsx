import { Text, Tooltip } from "@/components/ui";
import { Info } from "@/components/ui/icons";
import type { StatusBreakdown } from "@mains/contracts/stats";
import StatsPanel from "./stats-panel";

const EXPLANATION = "Successful sessions divided by successful and failed sessions. Excludes canceled and ongoing sessions. Uses the current status of sessions active in this period.";

export default function SessionSuccessCard({ data }: { data: StatusBreakdown }) {
  const finished = data.totalSucceeded + data.totalFailed;
  const rate = finished > 0 ? data.totalSucceeded / finished : null;
  const value = rate === null ? "No data" : `${(rate * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;

  return <StatsPanel title="Session success rate" className="flex min-w-0 flex-1 flex-col" action={
    <Tooltip content={EXPLANATION}>
      <Text as="span" size="inherit" tone="subtle" tabIndex={0} title={EXPLANATION}
        aria-label="How session success rate is calculated"
        className="flex rounded-md focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2">
        <Info className="size-4" aria-hidden="true" />
      </Text>
    </Tooltip>
  }>
    <div className="flex flex-1 items-center gap-6">
      <div role="img" aria-label={`Session success rate: ${value}`} className="relative size-32 shrink-0">
        <svg viewBox="0 0 120 120" className="size-full" aria-hidden="true">
          <circle cx="60" cy="60" r="46" fill="none" strokeWidth="8"
            stroke={rate === null ? "var(--color-primary-500)" : "var(--color-danger)"}
            opacity={rate === null ? 0.12 : 0.65} />
          {rate !== null && rate > 0 && <circle cx="60" cy="60" r="46" fill="none" strokeWidth="8"
            stroke="var(--color-success)" pathLength="100" strokeDasharray={`${rate * 100} 100`}
            transform="rotate(-90 60 60)" />}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <Text size={rate === null ? "sm" : "2xl"} className="tabular-nums">{value}</Text>
        </div>
      </div>
      <dl className="min-w-0 flex-1 space-y-4">
        {[{ label: "Successful", count: data.totalSucceeded, color: "bg-success" },
          { label: "Failed", count: data.totalFailed, color: "bg-danger" }].map((item) =>
          <div key={item.label} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <Text as="dt" size="sm" tone="subtle" className="flex items-center gap-2">
              <span className={`size-1.5 shrink-0 rounded-full ${item.color}`} aria-hidden="true" />{item.label}
            </Text>
            <Text as="dd" size="xl" className="tabular-nums">{item.count.toLocaleString()}</Text>
          </div>)}
      </dl>
    </div>
  </StatsPanel>;
}
