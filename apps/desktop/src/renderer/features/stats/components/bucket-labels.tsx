import { Text } from "@/components/ui";
import type { DashboardRange } from "@mains/contracts/stats";
import { formatBucketDate, showBucketLabel } from "../lib/dashboard-format";

export default function BucketLabels({ dates, range }: { dates: string[]; range: DashboardRange }) {
  return (
    <div className="relative h-4 mt-2" aria-hidden="true">
      {dates.map((date, index) => showBucketLabel(index, dates.length) && (
        <Text as="span" key={date} size="s" tone="subtle" className="absolute whitespace-nowrap"
          style={{
            left: `${((index + 0.5) / dates.length) * 100}%`,
            transform: index === 0 ? "none" : index === dates.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
          }}>
          {formatBucketDate(date, range)}
        </Text>
      ))}
    </div>
  );
}
