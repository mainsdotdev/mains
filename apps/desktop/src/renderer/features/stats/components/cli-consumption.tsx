import { memo, useRef, useState } from "react";
import { Button, Text, Tooltip } from "@/components/ui";
import { Info, Refresh } from "@/components/ui/icons";
import type { DashboardConsumptionData } from "@mains/contracts/stats";
import CliHistoryInfoModal from "./cli-history-info-modal";
import ConsumptionTable, { ConsumptionValue } from "./consumption-table";
import ConsumptionTrendChart from "./consumption-trend-chart";

function CliConsumption({ data, isError, isFetching, retry }: {
  data?: DashboardConsumptionData; isError: boolean; isFetching: boolean; retry: () => void;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const incomplete = data?.sources.some((source) => source.status === "partial" || source.status === "error");
  return <section aria-label="Claude and Codex CLI history" className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Text as="h2" size="base" weight="medium">CLI usage</Text>
        {incomplete && <Tooltip content="* marks partial data. Some CLI files or lines could not be read. Missing measurements or model prices can also affect marked totals. Open Sources & pricing for details.">
          <Text as="span" size="s" tone="warning" tabIndex={0}>Incomplete scan *</Text>
        </Tooltip>}
      </div>
      <div className="flex items-center gap-1">
        <Button ref={infoButtonRef} variant="icon" onClick={() => setInfoOpen(true)} disabled={!data}
          aria-label="Sources & pricing" aria-haspopup="dialog" tooltip="Sources & pricing">
          <Info className="size-4" aria-hidden="true" />
        </Button>
        <Button variant="icon" onClick={retry} disabled={isFetching} aria-label="Refresh CLI history" tooltip="Refresh history">
          <Refresh className={`size-4 ${isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} />
        </Button>
      </div>
    </div>
    {isError && <div className="rounded-3xl glass-surface p-6"><Text size="sm" tone="danger" role="alert">{data
      ? "Could not refresh CLI history. Showing the last loaded data." : "Could not load CLI history and API estimates."}</Text></div>}
    {!data ? !isError && <div className="h-64 rounded-3xl glass-surface animate-pulse motion-reduce:animate-none" aria-label="Loading CLI consumption" />
      : <>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[{ label: "Tokens", metric: "totalTokens" as const }, { label: "API estimate", metric: "estimatedCostUsd" as const, money: true },
            { label: "Cache savings", metric: "cacheSavingsUsd" as const, money: true }].map((item) => <div key={item.metric} className="rounded-3xl glass-surface p-5">
              <Tooltip content={item.money ? `${data.cli.totals.reportedMetrics[item.metric].toLocaleString()} of ${data.cli.totals.records.toLocaleString()} usage records priced. API equivalent, not a subscription bill.` : `${data.cli.totals.sessions.toLocaleString()} sessions`}>
                <Text as="div" size="sm" tone="subtle" tabIndex={0}>{item.label}</Text>
              </Tooltip>
              <Text as="div" size="3xl" className="mt-2 tabular-nums"><ConsumptionValue totals={data.cli.totals} metric={item.metric} money={item.money} /></Text>
            </div>)}
        </div>
        <ConsumptionTrendChart data={data} />
        <ConsumptionTable report={data.cli} scope="CLI" />
      </>}
    {data && <CliHistoryInfoModal data={data} isOpen={infoOpen} onClose={() => setInfoOpen(false)} returnFocusRef={infoButtonRef} />}
  </section>;
}

export default memo(CliConsumption);
