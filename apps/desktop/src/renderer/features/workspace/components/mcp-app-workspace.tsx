import { useMcpAppPanel } from "@/hooks/use-mcp-app-panel";
import { mcpAppCompatibility } from "@/lib/mcp-app-extensions";
import { McpAppDisplay } from "./tools/mcp-app-display";

/** The document stays mounted while the surrounding panel changes size. */
export function McpAppWorkspace({ registerBeforeSuspend }: { registerBeforeSuspend?: (callback: () => Promise<void>) => () => void }) {
  const panel = useMcpAppPanel();
  if (!panel?.document) return null;
  const document = panel.document;
  return <McpAppDisplay
    sessionId={document.sessionId}
    resourceRunId={document.resourceRunId}
    runId={panel.runId}
    presentation="page"
    panelDisplayMode={panel.isExpanded ? "fullscreen" : "inline"}
    onDisplayModeChange={(mode) => {
      if ((mode === "fullscreen") !== panel.isExpanded) panel.toggleExpanded();
    }}
    isActive={panel.isOpen}
    registerBeforeSuspend={registerBeforeSuspend}
    unsupportedTools={mcpAppCompatibility(document.app).unsupportedTools}
    app={{ ...document.app, appName: document.app.name }}
    input={document.input}
    output={document.output}
    title={document.app.name}
    onMessage={panel.sendMessage}
    onModelContextChange={panel.updateModelContext}
    modelContext={panel.modelContext}
  />;
}
