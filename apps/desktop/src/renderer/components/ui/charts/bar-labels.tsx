import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface LabelItem {
  key: string | number;
  content: ReactNode;
}

interface BarLabelsProps {
  labels: LabelItem[];
  gap?: string;
  className?: string;
}

export default function BarLabels({
  labels,
  gap = "gap-0.5",
  className,
}: BarLabelsProps) {
  return (
    <div className={cn("flex mt-1.5", gap, className)}>
      {labels.map((l) => (
        <div key={l.key} className="flex-1 min-w-0 text-center overflow-hidden">
          {l.content}
        </div>
      ))}
    </div>
  );
}
