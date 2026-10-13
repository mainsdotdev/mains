import { useToolExpansion } from "../../lib/transcript-view-state";
import { resolveTool } from "../../lib/resolve-tool";
import { ToolHeader, ToolCollapse, type ToolStatus } from "./_shared";
import { type McpAppToolMetadata } from "./mcp-app-display";
import { McpAppLauncher } from "./mcp-app-launcher";
import { McpResultNotice, McpResultText } from "./mcp-result-notice";
import {
  mcpOutputSegments,
  mcpStructuredContentOmitted,
} from "../../lib/mcp-output";

interface McpDisplayProps {
  displayName: string;
  /** Pre-resolved icon. When omitted, falls back to looking it up by name. */
  icon?: React.ReactNode;
  params: Record<string, unknown> | null;
  /** MCP tool call result (`metadata.output`), often `{ content: [{ type: "text", text: string }] }`. */
  output?: unknown;
  isCompact?: boolean;
  status?: ToolStatus;
  runId?: string;
  mcpApp?: McpAppToolMetadata;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** An app resource is tied to a completed, successful originating tool call. */
function hasUsableMcpAppResult(output: unknown): boolean {
  // Older Claude transcripts store text-only tools as their MCP content blocks.
  if (Array.isArray(output)) return output.length > 0;
  const result = asRecord(output);
  if (!result || result.isError === true || mcpStructuredContentOmitted(output))
    return false;

  const structured = asRecord(result.structuredContent);
  if (typeof structured?.error_code === "string") return false;

  const meta = asRecord(result._meta);
  const codexApps = asRecord(meta?._codex_apps);
  const authFailure = asRecord(codexApps?.connector_auth_failure);
  return authFailure?.is_auth_failure !== true;
}

function formatCodePayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

/**
 * Renders every output segment in a SINGLE monospace block (ack + structured
 * details together), separated by blank lines — one container, not a separate
 * card per segment.
 */
function McpOutput({ segments }: { segments: string[] }) {
  const body = segments.map(formatCodePayload).join("\n\n");
  return <McpResultText body={body} />;
}

/**
 * Compact, single-line preview of the input params shown next to the verb in
 * the header. Picks string-ish values, joins with " · ", truncates long ones.
 */
// function summarizeInput(params: Record<string, unknown> | null): string {
//   if (!params) return "";
//   const parts: string[] = [];
//   for (const [key, value] of Object.entries(params)) {
//     if (key === "content" && Array.isArray(value)) continue;
//     if (typeof value === "string") {
//       const trimmed = value.trim();
//       if (trimmed) parts.push(trimmed);
//     } else if (typeof value === "number" || typeof value === "boolean") {
//       parts.push(String(value));
//     } else if (Array.isArray(value) && value.length > 0) {
//       const flat = value
//         .filter((v) => typeof v === "string" || typeof v === "number")
//         .slice(0, 3)
//         .join(", ");
//       if (flat) parts.push(flat);
//     }
//     if (parts.length >= 2) break;
//   }
//   return parts.join(" · ");
// }

export function McpDisplay({
  displayName,
  icon,
  params,
  output,
  isCompact = false,
  status = "done",
  runId,
  mcpApp,
}: McpDisplayProps) {
  const [isExpanded, setIsExpanded] = useToolExpansion(false);
  const resolvedIcon = icon ?? resolveTool(displayName).icon;

  const hasOutput = output != null && output !== "";

  return (
    <div>
      <ToolHeader
        icon={resolvedIcon}
        verb={displayName}
        hasDetails={hasOutput}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      ></ToolHeader>

      <McpResultNotice output={output} />

      {runId &&
        mcpApp &&
        status === "done" &&
        hasUsableMcpAppResult(output) && (
          <McpAppLauncher
            icon={resolvedIcon}
            runId={runId}
            app={mcpApp}
            input={params}
            output={output}
            title={displayName}
          />
        )}

      {hasOutput && (
        <ToolCollapse isExpanded={isExpanded}>
          <div className="pt-1">
            <McpDetails output={output} />
          </div>
        </ToolCollapse>
      )}
    </div>
  );
}

function McpDetails({ output }: { output: unknown }) {
  const segments = mcpOutputSegments(output);
  return segments.length > 0 ? <McpOutput segments={segments} /> : null;
}
