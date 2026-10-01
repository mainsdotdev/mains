import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import type { OpenMcpAppExtensionResponse } from "@mains/contracts/mcp-apps";
import type { ServiceResponse } from "@mains/contracts/service-response";
import { Button, Muted } from "@/components/ui";
import { Refresh } from "@/components/ui/icons";
import { PageShell } from "@/components/layout/page-shell";
import { McpAppDisplay } from "@/features/workspace/components/tools/mcp-app-display";
import { useMcpAppExtensions } from "@/hooks/use-mcp-app-extensions";
import { useSpaceProviderVariant } from "@/hooks/use-space-provider-variant";
import { mcpAppCompatibility, mcpAppId } from "@/lib/mcp-app-extensions";

export default function McpAppPage() {
  const { appId: appToken } = useParams();
  const appId = mcpAppId(appToken);
  const { available, entries, isLoading, error: inventoryError, refetch } = useMcpAppExtensions();
  const app = entries.find((entry) => entry.id === appId);
  const canOpen = available && Boolean(app);
  const title = app?.name ?? "Plugin app";
  const compatibility = mcpAppCompatibility(app);
  const provider = useSpaceProviderVariant();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    session?: OpenMcpAppExtensionResponse;
    error?: string;
  }>({ key: "" });
  const key = `${provider.providerId}:${appId}:${attempt}`;
  const session = canOpen && state.key === key ? state.session : undefined;
  const error = inventoryError ? "Could not load plugin apps. Reload to try again."
    : !isLoading && !app ? "This plugin app is no longer available. Enable or connect the plugin, then reload."
    : state.key === key ? state.error : undefined;

  useEffect(() => {
    if (!canOpen || !appId) return;
    let cancelled = false;
    let sessionId: string | undefined;
    const close = (id: string) => {
      void window.api.mcpApps.closeExtension({ sessionId: id }).catch(() => {});
    };
    const release = () => {
      cancelled = true;
      if (sessionId) close(sessionId);
    };
    window.addEventListener("beforeunload", release);
    void (async () => {
      const opened = await window.api.mcpApps.openExtension({
        providerId: provider.providerId, entrypointId: appId,
      }) as ServiceResponse<OpenMcpAppExtensionResponse>;
      if (!opened.success) throw new Error(opened.error);
      sessionId = opened.data.sessionId;
      if (cancelled) { close(sessionId); return; }
      setState({ key, session: opened.data });
    })().catch((reason: unknown) => {
      if (!cancelled) setState({ key, error: reason instanceof Error ? reason.message : String(reason) });
    });
    return () => {
      window.removeEventListener("beforeunload", release);
      release();
    };
  }, [canOpen, appId, provider.providerId, key]);

  if (!available) return <Navigate to="/" replace />;

  return (
    <PageShell className="flex min-h-0 max-w-none flex-col overflow-hidden px-0 pt-0">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-primary-200 px-4 dark:border-primary-800">
        <span className="text-sm font-medium text-primary-800 dark:text-primary-100">{title}</span>
        <Button variant="icon" aria-label={`Reload ${title}`} tooltip={`Reload ${title}`} onClick={() => {
          void refetch();
          setAttempt((value) => value + 1);
        }}>
          <Refresh className="size-4" />
        </Button>
      </header>
      {session && compatibility.notice && (
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-primary-200 bg-primary-100 px-4 py-2 text-xs text-primary-700 dark:border-primary-800 dark:bg-primary-900 dark:text-primary-300" role="note">
          <span>{compatibility.notice}</span>
          {compatibility.webUrl && <Button variant="secondary" className="shrink-0 text-xs" onClick={() => void window.api.shell.openExternal(compatibility.webUrl!)}>Open in browser</Button>}
        </div>
      )}
      {session ? (
        <div className="min-h-0 flex-1">
          <McpAppDisplay
            sessionId={session.sessionId}
            presentation="page"
            unsupportedTools={compatibility.unsupportedTools}
            app={{ ...session.app, appName: session.app.name }}
            input={{}}
            output={session.output}
            title={title}
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center" role={error ? "alert" : "status"}>
          <Muted>{error ?? (isLoading ? "Loading plugin apps…" : `Opening ${title}…`)}</Muted>
          {error && <Button variant="secondary" onClick={() => navigate("/plugins")}>Open plugins</Button>}
        </div>
      )}
    </PageShell>
  );
}
