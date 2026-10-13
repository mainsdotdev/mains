import { memo, useId, useMemo, useState } from "react";
import { SegmentedTabs, Text } from "@/components/ui";
import type { ConsumptionBucket, DashboardConsumptionData } from "@mains/contracts/stats";
import { formatBucketDate, formatEstimatedCost, formatTokens, providerColor, providerDescriptor } from "../lib/dashboard-format";
import { trendSegments, trendX } from "../lib/consumption-trend";
import BucketLabels from "./bucket-labels";
import StatsPanel from "./stats-panel";

function ConsumptionTrendChart({ data }: { data: DashboardConsumptionData }) {
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens");
  const [selected, setSelected] = useState<string | null>(null);
  const id = useId().replace(/:/g, "");
  const cost = metric === "cost";
  const key = cost ? "estimatedCostUsd" : "totalTokens";
  const report = data.cli;
  const format = (value: number | null) => cost ? formatEstimatedCost(value) : formatTokens(value);
  const maximum = report.buckets.reduce((peak, bucket) => Math.max(peak, bucket[key] ?? 0), 1);
  const series = useMemo(() => report.providers.map((provider) => ({
    providerId: provider.providerId,
    segments: trendSegments(report.buckets.map((bucket) => {
      const row = bucket.providers.find((item) => item.providerId === provider.providerId);
      return row ? row[key] : 0;
    }), maximum).map((segment) => ({
      segment, path: segment.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" "),
    })),
  })), [report, key, maximum]);
  const activeIndex = report.buckets.findIndex((bucket) => bucket.date === selected);
  const active = report.buckets[activeIndex];
  const x = activeIndex < 0 ? null : trendX(activeIndex, report.buckets.length);
  const describe = (bucket: ConsumptionBucket) => {
    const date = formatBucketDate(bucket.date, data.range, true);
    if (bucket.records === 0) return `${date} · No recorded usage`;
    return `${date} · ${format(bucket[key])}${cost ? " API estimate" : " tokens"} · ${bucket.reportedMetrics[key]} of ${bucket.records} usage records included`;
  };
  return <StatsPanel title="Consumption" action={<SegmentedTabs value={metric} onChange={setMetric}
    options={[{ value: "tokens", label: "Tokens" }, { value: "cost", label: "Cost" }]} semantics="radiogroup" aria-label="CLI chart metric" />}>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-7 min-h-6">
      <div className="flex flex-wrap gap-5">
        {report.providers.map((provider) => {
          const descriptor = providerDescriptor(provider.providerId);
          const Icon = descriptor?.icon;
          return <div key={provider.providerId} className="flex items-center gap-2">
            <span style={{ color: providerColor(provider.providerId) }}>{Icon && <Icon className="size-4" />}</span>
            <Text as="span" size="sm" tone="subtle">{descriptor?.label ?? provider.providerId}</Text>
            <Text as="span" size="sm" className="tabular-nums">{format(provider[key])}</Text>
          </div>;
        })}
      </div>
      <Text as="span" size="s" tone="subtle" aria-live="polite">{active
        ? `${formatBucketDate(active.date, data.range)} · ${format(active[key])}`
        : data.range.granularity === "month" ? "Monthly" : "Daily"}</Text>
    </div>
    {report.totals[key] === null ? <Text size="sm" tone="subtle" className="h-60 flex items-center justify-center">
      {cost ? "No cost estimates available" : "No token usage available"}
    </Text> : <div className="relative pl-12 pt-1">
      <div aria-hidden="true" className="absolute left-0 right-0 top-1 h-60 flex flex-col justify-between pointer-events-none">
        {[maximum, maximum / 2, 0].map((value, index) => <div key={index} className="ml-12 border-b border-primary-200/50 dark:border-primary-800/50">
          <Text as="span" size="s" tone="subtle" className="absolute left-0 -translate-y-1/2">{format(cost ? value : Math.round(value))}</Text>
        </div>)}
      </div>
      <div className="relative h-60" aria-label={`CLI ${metric} by ${data.range.granularity}`}>
        <svg viewBox="0 0 1000 240" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible pointer-events-none" aria-hidden="true">
          <defs>{report.providers.map((provider, index) => <linearGradient key={provider.providerId} id={`${id}-${index}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={providerColor(provider.providerId)} stopOpacity="0.22" />
            <stop offset="100%" stopColor={providerColor(provider.providerId)} stopOpacity="0.02" />
          </linearGradient>)}</defs>
          {series.flatMap((provider, providerIndex) => {
            return provider.segments.map(({ segment, path }, index) => {
              return <g key={`${provider.providerId}-${index}`}>
                <path d={`${path} L${segment.at(-1)!.x},240 L${segment[0].x},240 Z`} fill={`url(#${id}-${providerIndex})`} />
                <path d={path} fill="none" stroke={providerColor(provider.providerId)} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                {segment.length === 1 && <circle cx={segment[0].x} cy={segment[0].y} r="3" fill={providerColor(provider.providerId)} />}
              </g>;
            });
          })}
          {x !== null && <line x1={x} x2={x} y1="0" y2="240" stroke="var(--color-primary-500)" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />}
        </svg>
        {report.buckets.map((bucket, index) => <button key={bucket.date} type="button" aria-label={describe(bucket)} title={describe(bucket)}
          onMouseEnter={() => setSelected(bucket.date)} onFocus={() => setSelected(bucket.date)} onClick={() => setSelected(bucket.date)}
          className="absolute inset-y-0 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 rounded-md"
          style={{ left: `${index / report.buckets.length * 100}%`, width: `${100 / report.buckets.length}%` }}>
          {bucket.records > 0 && bucket[key] === null && <span className="absolute bottom-0 left-1/2 size-2 rounded-full border border-dashed border-warning" />}
          {bucket[key] !== null && bucket.reportedMetrics[key] < bucket.records && <span className="absolute bottom-0 left-1/2 size-1 rounded-full bg-warning" />}
        </button>)}
      </div>
      <BucketLabels dates={report.buckets.map((bucket) => bucket.date)} range={data.range} />
    </div>}
  </StatsPanel>;
}

export default memo(ConsumptionTrendChart);
