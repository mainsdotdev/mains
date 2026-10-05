import { useEffect, useLayoutEffect, useRef } from "react";
import { useMcpAppPanel } from "@/hooks/use-mcp-app-panel";
import { useMcpAppToolOpener } from "@/hooks/use-mcp-app-tool-opener";
import type { useWorkspacePage } from "./use-workspace-page";
import type { McpAppToolMetadata } from "../components/tools/mcp-app-display";

/** App messages and floating chat use the normal workspace conversation. */
export function useMcpAppConversation(ws: ReturnType<typeof useWorkspacePage>) {
  const panel = useMcpAppPanel();
  const register = panel?.registerConversation;
  const openTool = useMcpAppToolOpener();
  useLayoutEffect(() => {
    if (!register || !ws.ownerKey || !ws.contextParts) return;
    return register({ scope: ws.contextParts, ownerKey: ws.ownerKey, runId: ws.composerRun?.id,
      send: ws.handleExecute });
  }, [register, panel?.document?.id, panel?.ownerKey, ws.ownerKey, ws.contextParts, ws.composerRun?.id, ws.handleExecute]);

  const observed = useRef<{ ownerKey: string; since: number; seen: Set<string> } | null>(null);
  useEffect(() => {
    if (!openTool || !ws.composerRun?.id) return;
    if (observed.current?.ownerKey !== ws.ownerKey) {
      observed.current = { ownerKey: ws.ownerKey, since: Math.floor(Date.now() / 1000) * 1000, seen: new Set() };
    }
    for (const event of ws.currentEvents) {
      if (event.type !== "tool_call" || event.timestamp.getTime() < observed.current.since ||
          !["done", "completed"].includes(String(event.metadata?.status)) || !event.metadata?.mcpApp || observed.current.seen.has(event.id)) continue;
      let output = event.metadata.output;
      if (typeof output === "string") { try { output = JSON.parse(output); } catch { continue; } }
      if (!output || typeof output !== "object" || (output as { isError?: boolean }).isError) continue;
      const app = event.metadata.mcpApp as McpAppToolMetadata;
      if (!app.server || !app.tool || !app.resourceUri) continue;
      observed.current.seen.add(event.id);
      let input = event.metadata.input;
      if (typeof input === "string") { try { input = JSON.parse(input); } catch { input = {}; } }
      openTool({ runId: ws.composerRun.id, app, output, title: app.appName ?? event.content,
        input: input && typeof input === "object" ? input as Record<string, unknown> : {} }, true);
    }
  }, [openTool, ws.ownerKey, ws.composerRun?.id, ws.currentEvents]);
}
