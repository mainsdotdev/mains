import { Activity, startTransition, useCallback, useId, useMemo, useState } from "react";
import { useGetDashboardQuery, useGetConsumptionQuery } from "@/lib/redux/api";
import type { DashboardPeriod, ProviderFilter } from "@mains/contracts/stats";
import SummaryCards from "./summary-cards";
import TokenActivityChart from "./token-activity-chart";
import HourDistributionChart from "./hour-distribution-chart";
import ToolUsageChart from "./tool-usage-chart";
import SessionSuccessCard from "./session-success-card";
import { Button, getSegmentedTabId, Heading3, SegmentedTabs, Select, Text, Tooltip } from "@/components/ui";
import { useIsMobile } from "@/lib/platform";
import { PROVIDER_VARIANTS } from "@/lib/provider-variants";
import { formatRange, getClientTimeZone } from "../lib/dashboard-format";
import { isDashboardConsumptionData, isDashboardViewData } from "../lib/dashboard-data";
import CliConsumption from "./cli-consumption";
import ConsumptionTable from "./consumption-table";

const PROVIDERS = [
  { value: "all" as ProviderFilter, label: "All" },
  ...[PROVIDER_VARIANTS.claude, PROVIDER_VARIANTS.codex].map((provider) => ({ value: provider.providerId as ProviderFilter, label: provider.label })),
];
const PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "year", label: "Year" },
];
const PERIOD_LABELS: Record<DashboardPeriod, string> = { week: "Last 7 days", month: "Last 30 days", year: "Last 12 months" };
const SCOPES = [{ value: "cli", label: "CLI" }, { value: "mains", label: "Mains" }] as const;

export default function DashboardPage() {
  const [scope, setScope] = useState<"cli" | "mains">("cli");
  const [visitedMains, setVisitedMains] = useState(false);
  const scopeTabsId = useId();
  const scopePanelId = `${scopeTabsId}-panel`;
  const [filter, setFilter] = useState<ProviderFilter>("all");
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const [timeZone] = useState(getClientTimeZone);
  const isMobile = useIsMobile();
  const dashboard = useGetDashboardQuery(
    { provider: filter, period, timeZone },
    { pollingInterval: scope === "mains" ? 30_000 : 0, skipPollingIfUnfocused: true, refetchOnMountOrArgChange: true },
  );
  const consumption = useGetConsumptionQuery({ provider: filter, period, timeZone }, {
    pollingInterval: scope === "cli" ? 60_000 : 0, skipPollingIfUnfocused: true, refetchOnMountOrArgChange: true,
  });
  const { refetch: refetchDashboard } = dashboard;
  const { refetch: refetchConsumption } = consumption;
  const retryDashboard = useCallback(() => { void refetchDashboard(); }, [refetchDashboard]);
  const retryConsumption = useCallback(() => { void refetchConsumption(); }, [refetchConsumption]);
  const selectScope = (next: "cli" | "mains") => startTransition(() => {
    setScope(next);
    if (next === "mains") setVisitedMains(true);
  });
  const data = useMemo(() => isDashboardViewData(dashboard.currentData) ? dashboard.currentData : undefined, [dashboard.currentData]);
  const consumptionData = useMemo(() => isDashboardConsumptionData(consumption.currentData) ? consumption.currentData : undefined, [consumption.currentData]);
  const isError = dashboard.isError || !data && (dashboard.currentData !== undefined || dashboard.isSuccess && !dashboard.isFetching);
  const consumptionError = consumption.isError || !consumptionData && (consumption.currentData !== undefined || consumption.isSuccess && !consumption.isFetching);
  const range = consumptionData?.range ?? data?.range;
  return <div className="space-y-7 pb-16">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <Heading3>Dashboard</Heading3>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Tooltip content={`${PERIOD_LABELS[period]} · ${timeZone}`}>
            <Text size="sm" tone="subtle">{range ? formatRange(range) : PERIOD_LABELS[period]}</Text>
          </Tooltip>
          <SegmentedTabs id={scopeTabsId} value={scope} onChange={selectScope} options={SCOPES}
            semantics="tabs" panelId={scopePanelId} aria-label="Dashboard scope" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedTabs value={period} onChange={setPeriod} options={PERIODS} semantics="radiogroup" aria-label="Dashboard period" />
        {isMobile ? <Select value={filter} options={PROVIDERS} onChange={setFilter} aria-label="Dashboard provider" />
          : <SegmentedTabs value={filter} onChange={setFilter} options={PROVIDERS} semantics="radiogroup" aria-label="Dashboard provider" />}
      </div>
    </div>
    <div id={scopePanelId} role="tabpanel" aria-labelledby={getSegmentedTabId(scopeTabsId, scope)}>
      <Activity mode={scope === "cli" ? "visible" : "hidden"}>
        <CliConsumption data={consumptionData} isError={consumptionError} isFetching={consumption.isFetching} retry={retryConsumption} />
      </Activity>
      {visitedMains && <Activity mode={scope === "mains" ? "visible" : "hidden"}>
        <section aria-label="Usage recorded in Mains" className="space-y-5">
        <div className="flex min-h-7 items-center">
          <Text as="h2" size="base" weight="medium">Mains</Text>
        </div>
        {isError && <div className="rounded-3xl glass-surface p-5 flex items-center justify-between gap-3" role="alert">
          <Text size="sm" tone="danger">Failed to load dashboard data.</Text><Button variant="ghost" onClick={retryDashboard} disabled={dashboard.isFetching}>Retry</Button>
        </div>}
        {data ? <>
          <SummaryCards summary={data.summary} consumption={consumptionData?.mains.totals} />
          <TokenActivityChart data={data.tokenActivity} range={data.range} />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <div className="flex min-w-0 flex-col gap-5">
              <ToolUsageChart data={data.toolUsage} />
              <SessionSuccessCard data={data.statusBreakdown} />
            </div>
            <HourDistributionChart data={data.hourDistribution} timeZone={timeZone} />
          </div>
        </> : !isError && <div className="space-y-4 animate-pulse motion-reduce:animate-none" aria-label="Loading dashboard">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 rounded-3xl glass-surface" />)}</div>
          <div className="h-72 rounded-3xl glass-surface" />
        </div>}
        {consumptionData && <ConsumptionTable report={consumptionData.mains} scope="Mains" />}
        </section>
      </Activity>}
    </div>
  </div>;
}
