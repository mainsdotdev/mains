import { ChartCard, BarChart, BarLabels, Text } from "@/components/ui";
import { Clock } from "@/components/ui/icons";
import type { HourDistribution } from "@/lib/redux/api";

interface HourHeatmapProps {
  data: HourDistribution[];
}

const LABEL_HOURS = [0, 6, 12, 18];

// Night 0-5, Morning 6-11, Afternoon 12-17, Evening 18-23
const PERIOD_COLORS = ["#D4A843", "#4A9E6E", "#3D7A45", "#5B8DBF"];

function getBarColor(hour: number): string {
  if (hour < 6) return PERIOD_COLORS[0];
  if (hour < 12) return PERIOD_COLORS[1];
  if (hour < 18) return PERIOD_COLORS[2];
  return PERIOD_COLORS[3];
}

export default function HourHeatmap({ data }: HourHeatmapProps) {
  const full = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    count: data.find((d) => d.hour === i)?.count ?? 0,
  }));

  const maxCount = Math.max(...full.map((d) => d.count), 1);

  return (
    <ChartCard
      title="Hour Distribution"
      icon={Clock}
      isEmpty={data.length === 0}
      emptyHeight="h-44"
    >
      <BarChart
        height={180}
        bars={full.map((d) => ({
          key: d.hour,
          hoverLabel: d.count > 0 ? `${d.hour}:00 · ${d.count}` : undefined,
          segments: [
            {
              percent: Math.max((d.count / maxCount) * 100, d.count > 0 ? 3 : 0),
              color: getBarColor(d.hour),
            },
          ],
        }))}
      />
      <BarLabels
        labels={full.map((d) => ({
          key: d.hour,
          content: LABEL_HOURS.includes(d.hour) ? (
            <Text as="span" size="xt" tone="subtle">
              {d.hour}
            </Text>
          ) : null,
        }))}
      />
    </ChartCard>
  );
}
