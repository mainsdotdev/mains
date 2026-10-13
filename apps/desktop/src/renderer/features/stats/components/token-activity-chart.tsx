import { memo, useState } from "react";
import { Text, Tooltip } from "@/components/ui";
import type { DashboardRange, TokenUsageBucket } from "@mains/contracts/stats";
import { formatBucketDate, formatTokens, usageCoverage } from "../lib/dashboard-format";
import { calendarCells, tokenIntensity } from "../lib/token-activity";
import StatsPanel from "./stats-panel";

const LEVELS = [15, 30, 50, 75, 100];
const heatColor = (level: number) => level === 0 ? undefined
  : `color-mix(in srgb, var(--viz-cat-1) ${LEVELS[level]}%, var(--color-primary-950))`;
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function describeDay(day: TokenUsageBucket, range: DashboardRange) {
  const date = formatBucketDate(day.date, { ...range, granularity: "day" }, true);
  if (day.completedTurns === 0) return `${date} · No completed turns`;
  if (day.totalTokens === null) return `${date} · Token usage not reported · ${day.completedTurns} completed turns`;
  return `${date} · ${formatTokens(day.totalTokens, true)} tokens · ${usageCoverage(day)}`;
}

// Hover/focus changes only the detail line; the calendar's static cells and
// accessible descriptions are rebuilt only when their input data changes.
const TokenCalendar = memo(function TokenCalendar({ data, range, onSelect }: {
  data: TokenUsageBucket[]; range: DashboardRange; onSelect: (date: string) => void;
}) {
  const year = range.period === "year";
  const week = range.period === "week";
  const cells = week ? data : calendarCells(data);
  const columns = year ? Math.max(1, cells.length / 7) : 7;
  const maximum = data.reduce((peak, day) => Math.max(peak, day.totalTokens ?? 0), 1);
  const months = year ? cells.flatMap((day, index) => day && (day.date.endsWith("-01") || day === data[0])
    ? [{ date: day.date, column: Math.floor(index / 7) + 1 }] : []) : [];
  return <div className="overflow-x-auto">
      <div className={year ? "min-w-[620px]" : "max-w-[720px] mx-auto"}>
        {!year && <div className="grid grid-cols-7 gap-2 mb-2">
          {(week ? data.map((day) => formatBucketDate(day.date, { ...range, period: "week" })) : weekdays).map((label, index) =>
            <Text key={index} as="span" size="s" tone="subtle" align="center">{label}</Text>)}
        </div>}
        <div className={`grid ${year ? "gap-1" : "gap-2"}`} style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          ...(year ? { gridTemplateRows: "repeat(7, minmax(0, 1fr))", gridAutoFlow: "column" } : {}),
        }} aria-label="Daily token activity">
          {cells.map((day, index) => {
            if (!day) return <span key={`pad-${index}`} className={year ? "aspect-square" : "h-10"} />;
            const level = tokenIntensity(day, maximum);
            const label = describeDay(day, range);
            return <Tooltip key={day.date} content={label}>
              <button type="button" aria-label={label} onMouseEnter={() => onSelect(day.date)}
                onFocus={() => onSelect(day.date)} onClick={() => onSelect(day.date)}
                className={`${year ? "aspect-square rounded-[4px]" : "h-10 rounded-lg"} relative bg-primary-200/70 dark:bg-primary-800/70 transition-opacity hover:opacity-75 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${level === null ? "border border-dashed border-warning/60" : ""}`}
                style={{ backgroundColor: level === null ? undefined : heatColor(level) }}>
                {!year && <Text as="span" size="s" tone={level && level >= 3 ? "contrast" : "secondary"}>{Number(day.date.slice(8))}</Text>}
              </button>
            </Tooltip>;
          })}
        </div>
        {year && <div className="grid mt-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {months.map((month) => <Text key={month.date} as="span" size="s" tone="subtle" className="whitespace-nowrap" style={{ gridColumn: month.column }}>
            {formatBucketDate(month.date, range).split(" ")[0]}
          </Text>)}
        </div>}
      </div>
    </div>;
});

export default function TokenActivityChart({ data, range }: { data: TokenUsageBucket[]; range: DashboardRange }) {
  const [selected, setSelected] = useState<string | null>(null);
  const activeDays = data.filter((day) => day.completedTurns > 0).length;
  const active = data.find((day) => day.date === selected);
  return <StatsPanel title="Token activity" action={<Text size="sm" tone="subtle">{activeDays} active days</Text>}>
    <TokenCalendar data={data} range={range} onSelect={setSelected} />
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <Text as="span" size="s" tone="subtle" aria-live="polite">{active
        ? `${formatBucketDate(active.date, { ...range, granularity: "day" }, true)} · ${active.completedTurns === 0 ? "No turns" : active.totalTokens === null ? "No data" : formatTokens(active.totalTokens) + " tokens"}`
        : range.timeZone}</Text>
      <div className="flex items-center gap-2" aria-hidden="true">
        <Text as="span" size="s" tone="subtle">Less</Text>
        {LEVELS.map((_, level) => <span key={level} className="size-3 rounded-[3px] bg-primary-200/70 dark:bg-primary-800/70" style={{ backgroundColor: heatColor(level) }} />)}
        <Text as="span" size="s" tone="subtle">More</Text>
      </div>
    </div>
  </StatsPanel>;
}
