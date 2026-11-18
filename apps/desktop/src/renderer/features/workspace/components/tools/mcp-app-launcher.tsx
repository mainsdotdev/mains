import type { ReactNode } from "react";
import { Button } from "@/components/ui";
import { Maximize } from "@/components/ui/icons";

import type { McpAppToolOpen } from "@mains/contracts/mcp-apps";
import { useMcpAppToolOpener } from "@/hooks/use-mcp-app-tool-opener";

export function McpAppLauncher({ icon, appearance = "link", ...props }: McpAppToolOpen & { icon?: ReactNode; appearance?: "link" | "card" }) {
  const openTool = useMcpAppToolOpener();
  return <Button variant="bare" className={appearance === "card"
    ? "glass-card my-2 flex w-full min-w-0 max-w-transcript-bubble items-center gap-3 rounded-transcript-bubble px-4 py-3 text-left text-sm leading-relaxed text-primary-700 hover:bg-primary-100/50 dark:text-primary-300 dark:hover:bg-primary/5"
    : "my-2 gap-2 text-xs flex text-primary-700 dark:text-primary-300 decoration-dotted underline"} onClick={() => openTool?.(props)}
    disabled={!openTool} tooltip={!openTool ? "App panel is unavailable in this window" : undefined}
    aria-label={`Open ${props.app.appName ?? props.title} in app panel`}>
    {icon && <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden>{icon}</span>}
    <span className="min-w-0 flex-1 truncate">Open {props.app.appName ?? props.title}</span>
    <Maximize className="size-4 shrink-0" />
  </Button>;
}
