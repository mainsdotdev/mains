import { useEffect, useRef } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Muted } from "@/components/ui";
import { PageShell } from "@/components/layout/page-shell";
import { useMcpAppPanel } from "@/hooks/use-mcp-app-panel";
import { useMcpAppExtensions } from "@/hooks/use-mcp-app-extensions";
import { mcpAppId } from "@/lib/mcp-app-extensions";

/** Legacy/deep links launch the shared panel and land on its conversation. */
export default function McpAppPage() {
  const { appId: token } = useParams();
  const id = mcpAppId(token);
  const { available, entries, isLoading } = useMcpAppExtensions();
  const panel = useMcpAppPanel();
  const started = useRef<string | undefined>(undefined);
  const app = entries.find((entry) => entry.id === id);
  useEffect(() => {
    if (!app || !panel || started.current === app.id) return;
    started.current = app.id;
    void panel.openGlobal(app);
  }, [app, panel]);
  if (!available) return <Navigate to="/" replace />;
  return <PageShell className="flex min-h-0 items-center justify-center">
    <div role={panel?.error || !isLoading && !app ? "alert" : "status"}>
      <Muted>{panel?.error ?? (isLoading ? "Loading plugin apps…" : app ? `Opening ${app.name}…` : "This plugin app is no longer available.")}</Muted>
    </div>
  </PageShell>;
}
