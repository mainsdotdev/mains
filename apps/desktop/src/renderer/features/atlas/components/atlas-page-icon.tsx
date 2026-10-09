import { Page } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { iconTintClass, parseIcon } from "@/lib/icon-registry";

export function AtlasPageIcon({ icon, className }: { icon?: string | null; className?: string }) {
  const parsed = icon ? parseIcon(icon) : null;
  const Icon = parsed?.type === "icon" ? parsed.value : Page;
  return <span aria-hidden="true" className={cn("inline-flex size-4 shrink-0 items-center justify-center text-base leading-none", className,
    parsed?.type === "icon" && iconTintClass(parsed.color))}>
    {parsed?.type === "emoji" ? parsed.value : <Icon className="size-full" />}
  </span>;
}
