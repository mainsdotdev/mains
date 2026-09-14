import { Text, ChartCard, BarChart, BarLabels } from "@/components/ui";
import { Apps } from "@/components/ui/icons";
import type { ToolUsageItem } from "@/lib/redux/api";

interface ToolUsageChartProps {
  data: ToolUsageItem[];
}

const BAR_COLORS = [
  "#6366F1",
  "#8B5CF6",
  "#A78BFA",
  "#7BB3D4",
  "#4A9E6E",
  "#D4A843",
  "#F59E0B",
  "#9CA3AF",
];

export default function ToolUsageChart({ data }: ToolUsageChartProps) {
  const MAX_BARS = 10;
  const items = data.slice(0, MAX_BARS);
  const maxCount = Math.max(...items.map((d) => d.count), 1);
  const padCount = MAX_BARS - items.length;

  return (
    <ChartCard
      title="Top Tools"
      icon={Apps}
      isEmpty={data.length === 0}
      emptyMessage="No tool usage data yet"
    >
      <BarChart
        height={150}
        gap="gap-1.5"
        bars={[
          ...items.map((d, i) => ({
            key: d.toolName,
            hoverLabel: `${d.toolName}: ${d.count}`,
            topLabel: (
              <Text as="span" size="t" className="tabular-nums">
                {d.count}
              </Text>
            ),
            segments: [
              {
                percent: Math.max((d.count / maxCount) * 100, 3),
                color: BAR_COLORS[i % BAR_COLORS.length],
              },
            ],
          })),
          ...Array.from({ length: padCount }, (_, i) => ({
            key: `_pad_${i}`,
            segments: [] as { percent: number; color: string }[],
          })),
        ]}
      />
      <BarLabels
        gap="gap-1.5"
        labels={[
          ...items.map((d) => ({
            key: d.toolName,
            content: (
              <Text
                as="span"
                size="xt"
                tone="subtle"
                className="truncate block max-w-full"
              >
                {d.toolName}
              </Text>
            ),
          })),
          ...Array.from({ length: padCount }, (_, i) => ({
            key: `_pad_${i}`,
            content: null as unknown as React.ReactNode,
          })),
        ]}
      />
    </ChartCard>
  );
}
