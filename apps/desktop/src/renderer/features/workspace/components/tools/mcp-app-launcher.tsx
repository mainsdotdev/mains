import type { ReactNode } from "react";
import { Button } from "@/components/ui";
import { Maximize } from "@/components/ui/icons";

import type { McpAppToolOpen } from "@mains/contracts/mcp-apps";
import { useMcpAppToolOpener } from "@/hooks/use-mcp-app-tool-opener";

export function McpAppLauncher({ icon, ...props }: McpAppToolOpen & { icon?: ReactNode }) {
  const openTool = useMcpAppToolOpener();
  return <Button variant="bare" className="my-2 gap-2 text-xs flex text-primary-700 dark:text-primary-300 decoration-dotted underline" onClick={() => openTool?.(props)}
    disabled={!openTool} tooltip={!openTool ? "App panel is unavailable in this window" : undefined}
    aria-label={`Open ${props.app.appName ?? props.title} in app panel`}>
    {icon && <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden>{icon}</span>}
    Open {props.app.appName ?? props.title}
    <Maximize className="size-4" />
  </Button>;
}
