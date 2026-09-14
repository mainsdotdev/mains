import { useState } from "react";
import { Text } from "@/components/ui";
import { Infinite } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody, useToolStatus } from "./_shared";
import { toolOutputText } from "../../lib/parse-tool-content";

/**
 * Input to the `Monitor` tool — a background watch whose event stream is either
 * a shell `command`'s stdout (one notification per line) or a `ws` endpoint's
 * text frames. `persistent` runs for the whole session; otherwise the watch is
 * killed after `timeout_ms`.
 */
export interface MonitorParams {
  description?: string;
  command?: string;
  ws?: { url?: string; protocols?: string[] };
  timeout_ms?: number;
  persistent?: boolean;
}

/** `570000` → `"9m 30s"`. Returns "" for a missing/invalid duration. */
function formatDuration(ms: unknown): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

export function MonitorDisplay({
  params,
  output,
  isCompact = false,
}: {
  params: MonitorParams;
  output?: unknown;
  isCompact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const status = useToolStatus();

  const wsUrl = params.ws?.url;
  const source = wsUrl ?? params.command ?? "";
  const protocols = params.ws?.protocols?.filter(Boolean) ?? [];
  const result = toolOutputText(output);

  // A persistent watch has no deadline; a bounded one shows its timeout. Once
  // the call is no longer in flight the limit is history, so it only reads as a
  // live badge while running.
  const isRunning = status === "running" || status === "queued";
  const limit = params.persistent ? "persistent" : formatDuration(params.timeout_ms);

  const hasDetails = !!source || !!result;

  return (
    <div>
      <ToolHeader
        icon={<Infinite className="size-4" />}
        verb="Monitored"
        hasDetails={hasDetails}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        <span className={`truncate ${TOOL_ROW_TEXT}`}>
          {params.description || source || "watch"}
        </span>
        {limit && (
          <span
            className={`shrink-0 text-t tabular-nums ${
              isRunning && params.persistent ? "text-success" : TOOL_ROW_TEXT
            }`}
          >
            {limit}
          </span>
        )}
      </ToolHeader>

      {hasDetails && (
        <ToolCollapse isExpanded={isExpanded}>
          <ToolOutputBody as="div" className="text-s font-sans space-y-2">
            {source && (
              <div className="space-y-1">
                <Text as="div" size="t" tone="subtle" weight="medium">
                  {wsUrl ? "WebSocket" : "Command"}
                </Text>
                <Text as="pre" size="t" tone="inherit" className="noscrollbar whitespace-pre-wrap break-all font-mono overflow-x-auto">
                  {source}
                </Text>
                {protocols.length > 0 && (
                  <Text as="div" size="t" tone="subtle" className="font-mono">
                    {protocols.join(", ")}
                  </Text>
                )}
              </div>
            )}

            {result && (
              <div className="pt-1 border-t border-primary-100 dark:border-primary/10">
                <Text as="div" size="t" tone="subtle" weight="medium" className="mb-1">
                  {status === "error" ? "Error" : "Events"}
                </Text>
                <pre
                  className={`noscrollbar whitespace-pre-wrap text-t font-mono max-h-40 overflow-y-auto ${
                    status === "error" ? "text-danger" : ""
                  }`}
                >
                  {result}
                </pre>
              </div>
            )}
          </ToolOutputBody>
        </ToolCollapse>
      )}
    </div>
  );
}
