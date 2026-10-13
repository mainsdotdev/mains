import type { ReactNode } from "react";
import { ChartCard, Text } from "@/components/ui";

export default function StatsPanel({ title, action, children, className }: {
  title: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return <ChartCard className={`p-5 sm:p-6 ${className ?? ""}`}>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
      <Text as="h3" size="base" weight="medium">{title}</Text>
      {action}
    </div>
    {children}
  </ChartCard>;
}
