import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/cn";
import Text, { Caption } from "../text";

interface ChartCardProps {
  title?: string;
  icon?: ComponentType<{ className?: string }>;
  headerRight?: ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
  emptyHeight?: string;
  className?: string;
  children: ReactNode;
}

export default function ChartCard({
  title,
  icon: Icon,
  headerRight,
  isEmpty,
  emptyMessage = "No data yet",
  emptyHeight = "h-36",
  className,
  children,
}: ChartCardProps) {
  return (
    <div
      className={cn(
        "rounded-3xl glass-surface p-4",
        className,
      )}
    >
      {title && (
        headerRight ? (
          <div className="flex items-start justify-between mb-1">
            <Caption className="gap-1.5 flex items-center">
              {Icon && <Icon className="w-3 h-3" />}
              {title}
            </Caption>
            {headerRight}
          </div>
        ) : (
          <Caption className="mb-3 flex items-center gap-1.5">
            {Icon && <Icon className="w-3 h-3" />}
            {title}
          </Caption>
        )
      )}
      {isEmpty ? (
        <Text
          as="div"
          size="xs"
          tone="subtle"
          className={cn("flex items-center justify-center", emptyHeight)}
        >
          {emptyMessage}
        </Text>
      ) : (
        children
      )}
    </div>
  );
}
