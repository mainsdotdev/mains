import { useNavigate } from "react-router-dom";
import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";
import { Button, Heading3, Muted, toast } from "@/components/ui";
import { External } from "@/components/ui/icons";
import type { McpAppLaunchIssue } from "@/lib/mcp-app-extensions";

export function McpAppUnavailable({ app, issue, providerId }: {
  app: McpAppEntrypoint;
  issue: McpAppLaunchIssue;
  providerId?: string;
}) {
  const navigate = useNavigate();
  const openInBrowser = async () => {
    if (issue.kind !== "unsupported") return;
    try {
      await window.api.shell.openExternal(issue.webUrl);
    } catch {
      toast.error(`Could not open ${app.name} in your browser. Try again.`);
    }
  };
  const reconnect = () => {
    const params = new URLSearchParams();
    if (providerId) params.set("provider", providerId);
    if (app.pluginId) params.set("plugin", app.pluginId);
    navigate(`/plugins${params.size ? `?${params}` : ""}`);
  };
  return <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 pb-16 text-center">
    <Heading3>{app.name}</Heading3>
    <Muted role="status" className="max-w-sm">{issue.message}</Muted>
    {issue.kind === "unsupported"
      ? <Button variant="primary" className="inline-flex gap-2" leftIcon={<External className="size-4" />} onClick={() => void openInBrowser()}>Open in browser</Button>
      : <Button variant="primary" onClick={reconnect}>Reconnect {app.name}</Button>}
  </div>;
}
