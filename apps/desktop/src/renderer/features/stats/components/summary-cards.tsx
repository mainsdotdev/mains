import { useState, useEffect } from "react";
import NumberFlow from "@number-flow/react";
import { Caption, Heading2 } from "@/components/ui";
import type { DashboardSummary } from "@/lib/redux/api";

interface SummaryCardsProps {
  summary: DashboardSummary;
}

export default function SummaryCards({ summary }: SummaryCardsProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  const cards = [
    { label: "Projects", value: summary.totalProjects },
    { label: "Runs Today", value: summary.runsToday },
    { label: "Total Sessions", value: summary.totalSessions },
    { label: "Est. Cost", value: summary.estimatedCostUsd, isCost: true },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-3xl glass-surface px-4 py-3.5 text-center"
        >
          <Heading2>
            <NumberFlow
              value={mounted ? card.value : 0}
              format={
                card.isCost
                  ? { style: "currency", currency: "USD", minimumFractionDigits: 2 }
                  : undefined
              }
              transformTiming={{ duration: 600, easing: "ease-out" }}
              spinTiming={{ duration: 600, easing: "ease-out" }}
            />
          </Heading2>
          <Caption>
            {card.label}
          </Caption>
        </div>
      ))}
    </div>
  );
}
