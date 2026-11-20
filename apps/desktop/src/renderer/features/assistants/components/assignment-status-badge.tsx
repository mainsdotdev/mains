import type { AssignmentStatus } from "@mains/contracts/assistants";
import { StatusBadge, type StatusTone } from "@/components/ui";
import { Check, Clock, Close, Play, Stop, Warning } from "@/components/ui/icons";

const statusStyle = {
  queued: { label: "Queued", tone: "info", icon: Clock },
  running: { label: "Running", tone: "info", icon: Play },
  blocked: { label: "Blocked", tone: "warning", icon: Warning },
  completed: { label: "Completed", tone: "success", icon: Check },
  failed: { label: "Failed", tone: "danger", icon: Close },
  canceled: { label: "Canceled", tone: "neutral", icon: Stop },
  uncertain: { label: "Delivery uncertain", tone: "warning", icon: Warning },
} satisfies Record<AssignmentStatus, { label: string; tone: StatusTone; icon: typeof Check }>;

export function AssignmentStatusBadge({ status }: { status: AssignmentStatus }) {
  const { label, tone, icon } = statusStyle[status];
  return <StatusBadge tone={tone} icon={icon}>{label}</StatusBadge>;
}
