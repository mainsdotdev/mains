import { ChartCard, BarChart, BarLabels, Text } from "@/components/ui";
import { Calendar } from "@/components/ui/icons";
import type { DailyActivity } from "@/lib/redux/api";

interface ActivityChartProps {
  data: DailyActivity[];
}

function padTo30(data: DailyActivity[]) {
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const filled = sorted.map((d) => ({
    claude: d.claude,
    copilot: d.copilot,
    codex: d.codex,
    cursor: d.cursor,
    other: d.other,
    total: d.claude + d.copilot + d.codex + d.cursor + d.other,
  }));
  const padding = 30 - filled.length;
  if (padding > 0) {
    const empty = Array.from({ length: padding }, () => ({
      claude: 0,
      copilot: 0,
      codex: 0,
      cursor: 0,
      other: 0,
      total: 0,
    }));
    return [...filled, ...empty];
  }
  return filled.slice(-30);
}

export default function ActivityChart({ data }: ActivityChartProps) {
  const isEmpty = data.length === 0 || data.every(d => d.claude + d.copilot + d.codex + d.cursor + d.other === 0);
  const chartData = padTo30(data);
  const maxTotal = Math.max(...chartData.map((d) => d.total), 1);

  return (
    <ChartCard
      title="Daily Activity (30d)"
      icon={Calendar}
      isEmpty={isEmpty}
      emptyMessage="No activity data yet"
      emptyHeight="h-45"
    >
      <BarChart
        height={180}
        bars={chartData.map((d, i) => ({
          key: i,
          hoverLabel: d.total > 0 ? `${d.total} runs` : undefined,
          segments: [
            { percent: (d.other / maxTotal) * 100, color: "var(--color-primary-500)" },
            { percent: (d.cursor / maxTotal) * 100, color: "var(--color-cursor)" },
            { percent: (d.codex / maxTotal) * 100, color: "var(--color-codex)" },
            { percent: (d.copilot / maxTotal) * 100, color: "var(--color-copilot)" },
            { percent: (d.claude / maxTotal) * 100, color: "var(--color-claude)" },
          ],
        }))}
      />
      <BarLabels
        labels={chartData.map((_, i) => ({
          key: i,
          content: [1, 5, 10, 15, 20, 25].includes(i + 1) ? (
            <Text as="span" size="xt" tone="subtle">
              {i + 1}
            </Text>
          ) : null,
        }))}
      />
    </ChartCard>
  );
}
