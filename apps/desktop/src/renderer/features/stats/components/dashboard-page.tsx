import { useState } from "react";
import { useGetDashboardQuery } from "@/lib/redux/api";
import type { ProviderFilter } from "@/lib/redux/api";
import SummaryCards from "./summary-cards";
import ActivityChart from "./activity-chart";
import HourHeatmap from "./hour-heatmap";
import CostByModelChart from "./cost-by-model-chart";
import ToolUsageChart from "./tool-usage-chart";
import RecentSessionsList from "./recent-sessions-list";
import { Caption, Heading3, SegmentedTabs, Select } from "@/components/ui";
import SuccessRateChart from "./success-rate-chart";
import { useIsMobile } from "@/lib/platform";
import { PROVIDER_VARIANTS } from "@/lib/provider-variants";

const TABS: { id: ProviderFilter; label: string }[] = [
  { id: "all", label: "All" },
  ...Object.values(PROVIDER_VARIANTS).map((d) => ({
    id: d.providerId as ProviderFilter,
    label: d.label,
  })),
];

const OPTIONS = TABS.map((t) => ({ value: t.id, label: t.label }));

export default function DashboardPage() {
  const [filter, setFilter] = useState<ProviderFilter>("all");
  const isMobile = useIsMobile();
  const { data, isLoading, isError } = useGetDashboardQuery(filter);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-32 bg-primary-200 dark:bg-primary-800 rounded" />
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 bg-primary-200/50 dark:bg-primary-800/20 rounded-lg" />
            ))}
          </div>
          <div className="h-56 bg-primary-200/50 dark:bg-primary-800/20 rounded-lg" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Caption>
        Failed to load dashboard data.
      </Caption>
    );
  }

  return (
    <div className="space-y-4 pb-16">
      <div className="flex items-center justify-between mb-8 gap-3">
        <Heading3>Dashboard</Heading3>
        {isMobile ? (
          <Select
            value={filter}
            options={OPTIONS}
            onChange={setFilter}
            aria-label="Dashboard provider"
          />
        ) : (
          <SegmentedTabs
            value={filter}
            onChange={setFilter}
            options={OPTIONS}
            semantics="radiogroup"
            aria-label="Dashboard provider"
          />
        )}
      </div>

      <SummaryCards summary={data.summary} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ActivityChart data={data.dailyActivity} />
        <HourHeatmap data={data.hourDistribution} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <CostByModelChart data={data.costByModel} />
        <ToolUsageChart data={data.toolUsage} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SuccessRateChart data={data.statusBreakdown} />
        <div className="relative">
          <div className="absolute inset-0">
            <RecentSessionsList sessions={data.recentSessions} />
          </div>
        </div>
      </div>
    </div>
  );
}
