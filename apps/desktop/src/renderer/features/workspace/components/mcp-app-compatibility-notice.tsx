import { useEffect, useRef } from "react";
import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";
import { toast } from "@/components/ui";
import { mcpAppCompatibility } from "@/lib/mcp-app-extensions";

const NOTICE_DELAY_MS = 800;

/** One neutral toast across the loading route and panel, until dismissed or left. */
export function McpAppCompatibilityNotice({ app }: {
  app?: McpAppEntrypoint;
}) {
  const appId = app?.id;
  const notice = mcpAppCompatibility(app).notice;
  const dismissedApps = useRef(new Set<string>());
  useEffect(() => {
    if (!appId || !notice || dismissedApps.current.has(appId)) return;
    let active = true;
    const dismiss = () => { dismissedApps.current.add(appId); };
    let id: string | undefined;
    const timer = setTimeout(() => {
      id = toast(notice, {
        duration: Infinity,
        action: { label: "Dismiss", onClick: dismiss },
        onDismiss: () => { if (active) dismiss(); },
      });
    }, NOTICE_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
      if (id) toast.dismiss(id, { animate: true });
    };
  }, [appId, notice]);
  return null;
}
