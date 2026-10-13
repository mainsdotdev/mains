import { Heading2, Text, Tooltip } from "@/components/ui";
import type { ConsumptionTotals, DashboardSummary } from "@mains/contracts/stats";
import { formatEstimatedCost, formatTokens, usageCoverage } from "../lib/dashboard-format";

export default function SummaryCards({ summary, consumption }: { summary: DashboardSummary; consumption?: ConsumptionTotals }) {
  const cost = consumption?.estimatedCostUsd ?? summary.estimatedCostUsd;
  const costCoverage = consumption ? `${consumption.costEstimatedRecords} of ${consumption.records} records priced` : usageCoverage(summary, "cost");
  const cards = [
    { label: "Sessions", value: summary.totalSessions.toLocaleString(), detail: "Active in the selected period", partial: false },
    { label: "Turns", value: summary.totalTurns.toLocaleString(), detail: `${summary.completedTurns.toLocaleString()} completed`, partial: false },
    { label: "Tokens", value: formatTokens(summary.totalTokens), detail: usageCoverage(summary), partial: summary.totalTokens !== null && summary.tokenReportedTurns < summary.completedTurns },
    { label: "API estimate", value: formatEstimatedCost(cost), detail: costCoverage, partial: cost !== null && (consumption ? consumption.costEstimatedRecords < consumption.records : summary.costReportedTurns < summary.completedTurns) },
  ];
  return <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
    {cards.map((card) => <Tooltip key={card.label} content={card.detail}>
      <div tabIndex={0} aria-label={`${card.label}: ${card.value}`} title={card.detail} className="rounded-3xl glass-surface p-5 min-w-0 focus-visible:outline-2 focus-visible:outline-accent">
        <Text size="sm" tone="subtle">{card.label}</Text>
        <Heading2 size="3xl" className="mt-2 tabular-nums">{card.value}{card.partial && <Text as="span" size="sm" tone="warning" className="ml-1" aria-hidden="true">*</Text>}</Heading2>
      </div>
    </Tooltip>)}
  </div>;
}
