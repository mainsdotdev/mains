import { useEffect, useRef } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Button, CircleSpinner, Heading3, Muted } from "@/components/ui";
import { PageShell } from "@/components/layout/page-shell";
import { useMcpAppPanel } from "@/hooks/use-mcp-app-panel";
import { useMcpAppExtensions } from "@/hooks/use-mcp-app-extensions";
import { mcpAppId } from "@/lib/mcp-app-extensions";

/** Rail and deep links show the page while connecting the shared app panel. */
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
  const error = panel?.error ?? (!isLoading && !app ? "This plugin app is no longer available." : null);
  return <PageShell className="flex min-h-0 flex-col">
    <Heading3>{app?.name ?? "Plugin app"}</Heading3>
    <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-16">
      <div role={error ? "alert" : "status"} className="flex items-center gap-2 text-primary-500">
        {!error && <CircleSpinner className="size-4" />}
        <Muted>{error ?? (app ? `Opening ${app.name}…` : "Loading plugin apps…")}</Muted>
      </div>
      {error && app && panel && <Button variant="primary" onClick={() => void panel.openGlobal(app)}>Retry</Button>}
    </div>
  </PageShell>;
}
