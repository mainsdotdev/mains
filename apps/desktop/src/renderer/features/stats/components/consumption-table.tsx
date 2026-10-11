import { useState } from "react";
import { SegmentedTabs, Text } from "@/components/ui";
import { formatModelDisplayName } from "@/lib/model-display";
import type {
  ConsumptionMetric,
  ConsumptionReport,
  ConsumptionTotals,
} from "@mains/contracts/stats";
import {
  formatEstimatedCost,
  formatTokens,
  providerColor,
  providerDescriptor,
} from "../lib/dashboard-format";

const COLUMNS: {
  key: ConsumptionMetric;
  label: string;
  money?: boolean;
  description: string;
}[] = [
  {
    key: "totalTokens",
    label: "Tokens",
    description: "Inclusive input + output; cache tokens counted once",
  },
  {
    key: "cacheReadTokens",
    label: "Cache read",
    description: "Input served from cache",
  },
  {
    key: "cacheWriteTokens",
    label: "Cache write",
    description: "Input written to cache",
  },
  {
    key: "uncachedInputTokens",
    label: "Uncached input",
    description: "Input outside the reported cache categories",
  },
  {
    key: "outputTokens",
    label: "Output",
    description: "Includes reasoning when the provider includes it in output",
  },
  {
    key: "estimatedCostUsd",
    label: "API cost",
    money: true,
    description: "API-equivalent estimate, not your subscription bill",
  },
  {
    key: "cacheSavingsUsd",
    label: "Cache savings",
    money: true,
    description: "Cache read tokens × (normal input rate − cache read rate)",
  },
];

export function ConsumptionValue({
  totals,
  metric,
  money = false,
}: {
  totals: ConsumptionTotals;
  metric: ConsumptionMetric;
  money?: boolean;
}) {
  const value = totals[metric];
  const reported = totals.reportedMetrics[metric];
  const partial = value !== null && reported < totals.records;
  const formatted = money ? formatEstimatedCost(value) : formatTokens(value);
  const explanation =
    value === null
      ? "No measurement or applicable model price available"
      : `${reported.toLocaleString()} of ${totals.records.toLocaleString()} usage records included`;
  return (
    <span
      className="whitespace-nowrap tabular-nums"
      title={explanation}
      aria-label={`${formatted}${partial ? ` · partial: ${explanation}` : ""}`}
    >
      {formatted}
      {partial && (
        <span className="ml-0.5 text-warning" aria-hidden="true">
          *
        </span>
      )}
    </span>
  );
}

export default function ConsumptionTable({
  report,
  scope,
}: {
  report: ConsumptionReport;
  scope: "CLI" | "Mains";
}) {
  const [breakdown, setBreakdown] = useState<"provider" | "model">("provider");
  const rows = breakdown === "provider" ? report.providers : report.models;
  return (
    <div className="rounded-2xl glass-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text as="h3" size="sm" weight="medium">
          {scope} breakdown
        </Text>
        <SegmentedTabs
          value={breakdown}
          onChange={setBreakdown}
          options={[
            { value: "provider", label: "Provider" },
            { value: "model", label: "Model" },
          ]}
          semantics="radiogroup"
          aria-label={`${scope} consumption breakdown`}
        />
      </div>
      <div className="mt-5">
        <div className="overflow-auto max-h-112">
          <Text
            as="table"
            size="s"
            className="w-full min-w-225"
            aria-label={`${scope} consumption table`}
          >
            <thead className="sticky top-0 z-10 bg-primary-50 dark:bg-primary-950">
              <tr className="border-b border-primary-200/60 dark:border-primary-800/60 text-left">
                <th className="px-4 py-4 font-medium">
                  {breakdown === "provider" ? "Provider" : "Model"}
                </th>
                <th className="px-2 py-4 text-right font-medium">Sessions</th>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    title={column.description}
                    className="pl-4 py-4 last:pr-4 text-right font-medium whitespace-nowrap"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center">
                    <Text size="sm" tone="subtle">
                      No recorded consumption in this period.
                    </Text>
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const provider = providerDescriptor(row.providerId);
                  const Icon = provider?.icon;
                  return (
                    <tr
                      key={JSON.stringify([row.providerId, row.model])}
                      className="border-b border-primary-200/35 dark:border-primary-800/35 last:border-0"
                    >
                      <th
                        scope="row"
                        className="px-4 py-3.5 font-normal text-left"
                      >
                        <div className="flex items-center gap-2.5 min-w-32">
                          {Icon ? (
                            <Icon className="size-4 shrink-0" />
                          ) : (
                            <span
                              className="size-2 rounded-full shrink-0"
                              style={{
                                backgroundColor: providerColor(row.providerId),
                              }}
                            />
                          )}
                          <div>
                            <Text
                              as="div"
                              size="s"
                              weight="medium"
                              title={`${provider?.label ?? row.providerId}${row.model ? ` · ${row.model}` : ""} · ${row.records.toLocaleString()} usage records`}
                            >
                              {breakdown === "model"
                                ? row.model
                                  ? formatModelDisplayName(
                                      row.model,
                                      provider?.variant,
                                    )
                                  : "Unreported model"
                                : (provider?.label ?? row.providerId)}
                            </Text>
                          </div>
                        </div>
                      </th>
                      <td className="px-2 text-right tabular-nums">
                        {row.sessions.toLocaleString()}
                      </td>
                      {COLUMNS.map((column) => (
                        <td
                          key={column.key}
                          className="pl-4 last:pr-4 text-right"
                        >
                          <ConsumptionValue
                            totals={row}
                            metric={column.key}
                            money={column.money}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t border-primary-200/60 dark:border-primary-800/60">
                <tr>
                  <th scope="row" className="px-4 pt-4 text-left font-medium">
                    {scope} total
                  </th>
                  <td className="px-2 pt-4 text-right tabular-nums">
                    {report.totals.sessions.toLocaleString()}
                  </td>
                  {COLUMNS.map((column) => (
                    <td
                      key={column.key}
                      className="pl-4 pt-4 last:pr-4 text-right font-medium"
                    >
                      <ConsumptionValue
                        totals={report.totals}
                        metric={column.key}
                        money={column.money}
                      />
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </Text>
        </div>
        {COLUMNS.some(
          (column) =>
            report.totals[column.key] !== null &&
            report.totals.reportedMetrics[column.key] < report.totals.records,
        ) && (
          <Text
            size="s"
            tone="subtle"
            className="mt-4"
            title="Only measured or priced records are included. Unknown measurements stay No data; measured zero stays zero. A multi-model turn retains its recorded total."
          >
            * Partial data
          </Text>
        )}
      </div>
    </div>
  );
}
