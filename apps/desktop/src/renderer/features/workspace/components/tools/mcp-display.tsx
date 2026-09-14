import { useState } from "react";
import { Text } from "@/components/ui";
import { resolveTool } from "../../lib/resolve-tool";
import { ToolHeader, ToolCollapse } from "./_shared";

interface McpDisplayProps {
  displayName: string;
  /** Pre-resolved icon. When omitted, falls back to looking it up by name. */
  icon?: React.ReactNode;
  params: Record<string, unknown> | null;
  /** MCP tool call result (`metadata.output`), often `{ content: [{ type: "text", text: string }] }`. */
  output?: unknown;
  isCompact?: boolean;
}

/** Pulls `{ type: "text", text }` bodies from MCP-style `content` arrays. */
function extractMcpContentTexts(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const content = (value as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const t = item as { type?: string; text?: string };
    if (t.type === "text" && typeof t.text === "string") {
      out.push(t.text);
    }
  }
  return out;
}

/**
 * Collect every renderable segment from an MCP result. Newer codex builds put a
 * generic ack ("Action completed.") in `content[].text` and the *real* payload
 * in `structuredContent` — which is either a nested MCP envelope
 * (`{ content: [{ type:"text", text:"<json>" }] }`) or a plain data object. We
 * surface both, ack first, so the expanded row shows the ack and the details
 * together instead of dropping the data.
 */
function extractMcpOutputSegments(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  const segments = [...extractMcpContentTexts(obj)];

  const structured = obj.structuredContent;
  if (structured && typeof structured === "object") {
    const nested = extractMcpContentTexts(structured);
    if (nested.length > 0) {
      segments.push(...nested);
    } else {
      try {
        segments.push(JSON.stringify(structured, null, 2));
      } catch {
        /* non-serializable structured payload → skip */
      }
    }
  }
  return segments;
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
  return (
    <Text as="pre" size="xs" tone="contrast" className="noscrollbar whitespace-pre-wrap font-mono bg-primary-50 dark:bg-primary/5 rounded-md p-2 max-h-64 overflow-y-auto">
      <code>{body}</code>
    </Text>
  );
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

export function McpDisplay({ displayName, icon, output, isCompact = false }: McpDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const resolvedIcon = icon ?? resolveTool(displayName).icon;

  const outputSegments = extractMcpOutputSegments(output);
  //const inputSummary = summarizeInput(params);
  const hasOutput = outputSegments.length > 0;

  return (
    <div>
      <ToolHeader
        icon={resolvedIcon}
        verb={displayName}
        hasDetails={hasOutput}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >

      </ToolHeader>

      {hasOutput && (
        <ToolCollapse isExpanded={isExpanded}>
          <div className="pt-1">
            <McpOutput segments={outputSegments} />
          </div>
        </ToolCollapse>
      )}
    </div>
  );
}
