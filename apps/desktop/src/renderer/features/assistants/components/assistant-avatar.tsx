import { normalizeAssistantAvatar, type AssistantAvatar as Avatar } from "@mains/contracts/assistants";
import { cn } from "@/lib/cn";

export const AVATAR_COLORS = {
  coral: { label: "Coral", fill: "#EE7567" },
  amber: { label: "Amber", fill: "#DDA13B" },
  lime: { label: "Lime", fill: "#95BD51" },
  mint: { label: "Mint", fill: "#42AE95" },
  cyan: { label: "Cyan", fill: "#36ABC5" },
  blue: { label: "Blue", fill: "#569ADB" },
  violet: { label: "Violet", fill: "#9274D3" },
  rose: { label: "Rose", fill: "#D96CA4" },
} as const;

export function AssistantAvatar({ avatar, className }: { avatar?: Avatar; className?: string }) {
  const selected = normalizeAssistantAvatar(avatar);
  return <span aria-hidden="true" data-avatar-shape={selected.shape}
    className={cn("inline-flex shrink-0 items-center justify-center", className)}
    style={{ color: AVATAR_COLORS[selected.color].fill }}>
    <svg viewBox="0 0 64 64" className="h-full w-full" fill="currentColor" focusable="false">
      {selected.shape === "sphere" ? <circle cx="32" cy="32" r="24" /> : <rect x="8" y="8" width="48" height="48" rx="8" />}
    </svg>
  </span>;
}
