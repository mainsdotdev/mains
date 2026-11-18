import type { AssignmentStatus } from "@mains/contracts/assistants";
import { cn } from "@/lib/cn";

const warningStatus = "bg-warning/15 text-[color:color-mix(in_srgb,var(--color-warning)_50%,var(--color-primary-950))] dark:text-warning";
const statusStyle = {
  queued: { label: "Queued", tone: "bg-primary-200/65 text-primary-700 dark:bg-primary/10 dark:text-primary-300" },
  running: { label: "Running", tone: "bg-accent/12 text-[color:color-mix(in_srgb,var(--color-accent)_50%,var(--color-primary-950))] dark:text-accent" },
  blocked: { label: "Blocked", tone: warningStatus },
  completed: { label: "Completed", tone: "bg-success/15 text-[color:color-mix(in_srgb,var(--color-success)_50%,var(--color-primary-950))] dark:text-success" },
  failed: { label: "Failed", tone: "bg-danger/15 text-[color:color-mix(in_srgb,var(--color-danger)_50%,var(--color-primary-950))] dark:text-danger" },
  canceled: { label: "Canceled", tone: "bg-primary-200/50 text-primary-600 dark:bg-primary/5 dark:text-primary-400" },
  uncertain: { label: "Delivery uncertain", tone: warningStatus },
} satisfies Record<AssignmentStatus, { label: string; tone: string }>;

export function AssignmentStatusBadge({ status }: { status: AssignmentStatus }) {
  const { label, tone } = statusStyle[status];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", tone)}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}
