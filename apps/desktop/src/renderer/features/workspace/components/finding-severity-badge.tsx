import { StatusBadge, type StatusTone } from "@/components/ui";
import type { FindingSeverity } from "@/lib/redux/api";

const tones: Record<FindingSeverity, StatusTone> = {
  critical: "danger",
  warning: "warning",
  info: "info",
};

export function FindingSeverityBadge({ severity }: { severity: string }) {
  const tone = Object.prototype.hasOwnProperty.call(tones, severity) ? tones[severity as FindingSeverity] : "neutral";
  return <StatusBadge tone={tone} className="capitalize">{severity}</StatusBadge>;
}
