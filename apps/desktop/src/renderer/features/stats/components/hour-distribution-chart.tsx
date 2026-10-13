import { useState } from "react";
import { Text } from "@/components/ui";
import type { HourDistribution } from "@mains/contracts/stats";
import StatsPanel from "./stats-panel";

function point(radius: number, angle: number) {
  const radians = (angle - 90) * Math.PI / 180;
  return [150 + radius * Math.cos(radians), 150 + radius * Math.sin(radians)];
}
function sector(inner: number, outer: number, hour: number) {
  const start = hour * 15 + 1.5;
  const end = (hour + 1) * 15 - 1.5;
  const a = point(outer, start), b = point(outer, end), c = point(inner, end), d = point(inner, start);
  return `M${a} A${outer},${outer} 0 0 1 ${b} L${c} A${inner},${inner} 0 0 0 ${d} Z`;
}

export default function HourDistributionChart({ data, timeZone }: { data: HourDistribution[]; timeZone: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: data.find((item) => item.hour === hour)?.count ?? 0 }));
  const peak = hours.reduce((best, hour) => hour.count > best.count ? hour : best, hours[0]);
  const active = hours[selected ?? peak.hour];
  const total = hours.reduce((sum, hour) => sum + hour.count, 0);
  return <StatsPanel title="Activity by hour" action={<Text size="sm" tone="subtle" title={timeZone}>Local time</Text>}>
    {total === 0 ? <Text size="sm" tone="subtle" className="py-24 text-center">No activity in this period</Text>
      : <>
        <div className="relative mx-auto w-full max-w-[320px] aspect-square">
          <svg viewBox="0 0 300 300" className="w-full h-full" aria-label="Turns by local hour">
            {hours.map((hour) => <g key={hour.hour} role="button" tabIndex={0}
              aria-label={`${String(hour.hour).padStart(2, "0")}:00 · ${hour.count} turns`}
              className="cursor-pointer focus-visible:outline-none focus-visible:stroke-accent focus-visible:stroke-2"
              onMouseEnter={() => setSelected(hour.hour)} onFocus={() => setSelected(hour.hour)} onClick={() => setSelected(hour.hour)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(hour.hour); } }}>
              <title>{`${String(hour.hour).padStart(2, "0")}:00 · ${hour.count} turns`}</title>
              <path d={sector(66, 121, hour.hour)} fill="var(--color-primary-500)" opacity="0.12" />
              {hour.count > 0 && <path d={sector(66, 66 + hour.count / peak.count * 55, hour.hour)}
                fill="var(--viz-cat-1)" opacity={active.hour === hour.hour ? 1 : 0.65} />}
            </g>)}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <Text as="div" size="3xl" className="tabular-nums">{active.count.toLocaleString()}</Text>
            <Text size="sm" tone="subtle">turns</Text>
          </div>
          {[{ label: "00", left: "50%", top: "2%" }, { label: "06", left: "98%", top: "50%" },
            { label: "12", left: "50%", top: "98%" }, { label: "18", left: "2%", top: "50%" }].map((tick) =>
            <Text key={tick.label} as="span" size="s" tone="subtle" className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: tick.left, top: tick.top }}>{tick.label}</Text>)}
        </div>
        <div className="mt-5 flex items-center justify-between gap-3">
          <Text size="sm" tone="subtle">{selected === null ? "Busiest hour" : "Selected hour"}</Text>
          <Text size="sm" className="tabular-nums">{String(active.hour).padStart(2, "0")}:00–{String((active.hour + 1) % 24).padStart(2, "0")}:00</Text>
        </div>
      </>}
  </StatsPanel>;
}
