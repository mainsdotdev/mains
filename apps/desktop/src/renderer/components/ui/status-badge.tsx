import type { ComponentType, ReactNode, SVGProps } from "react";
import { cn } from "@/lib/cn";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";
type StatusIcon = ComponentType<SVGProps<SVGSVGElement>>;

type StatusBadgeProps = {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
  title?: string;
} & ({ icon?: StatusIcon; iconOnly?: false } | { icon: StatusIcon; iconOnly: true });

export function StatusBadge({ tone, icon: Icon, iconOnly, children, className, title }: StatusBadgeProps) {
  return (
    <span
      data-status-tone={tone}
      title={title}
      className={cn(
        "status-badge inline-flex min-h-5 shrink-0 items-center gap-1 rounded-full font-sans text-xs leading-4 font-medium whitespace-nowrap",
        iconOnly ? "size-5 justify-center" : "px-2 py-0.5",
        className,
      )}
    >
      {Icon && <Icon aria-hidden="true" className="size-3 shrink-0" />}
      {iconOnly ? <span className="sr-only">{children}</span> : children}
    </span>
  );
}
