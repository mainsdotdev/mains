import { useState, type ReactNode } from "react";
import { Text } from "@/components/ui";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody, useToolStatus } from "./_shared";
import { toolOutputText, previewParams } from "../../lib/parse-tool-content";

/** Guardrail so a huge param blob (a 200 KB `Write`) never lands in the DOM. */
const MAX_BODY_CHARS = 4000;

function toOneLine(value: string, max = 80): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function prettyJson(value: unknown): string {
  try {
    const text = JSON.stringify(value, null, 2);
    if (!text) return "";
    return text.length > MAX_BODY_CHARS
      ? `${text.slice(0, MAX_BODY_CHARS)}\n… (${text.length - MAX_BODY_CHARS} more chars)`
      : text;
  } catch {
    return "";
  }
}

function clamp(text: string): string {
  return text.length > MAX_BODY_CHARS
    ? `${text.slice(0, MAX_BODY_CHARS)}\n… (${text.length - MAX_BODY_CHARS} more chars)`
    : text;
}

interface GenericToolDisplayProps {
  icon: ReactNode;
  displayName: string;
  params: Record<string, unknown> | null;
  output?: unknown;
  /** Pre-computed summary from `parseToolContent`; used when params yield nothing. */
  summary?: string;
  isCompact?: boolean;
}

/**
 * Terminal fallback for any tool without a dedicated renderer — a provider we
 * haven't registered, a newly shipped SDK tool, or a plugin's own. Everything
 * is derived generically, so an unrecognized tool still gets the same
 * affordances as a first-class one: a status-aware header (spinner while
 * running, red on failure) and an expandable body showing the full input and
 * output. Without this, an unknown tool renders as a dead single line and its
 * result is unreachable in the UI.
 */
export function GenericToolDisplay({
  icon,
  displayName,
  params,
  output,
  summary,
  isCompact = false,
}: GenericToolDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const status = useToolStatus();

  const inputJson = params && Object.keys(params).length > 0 ? prettyJson(params) : "";
  const outputText = clamp(toolOutputText(output));

  // Params are the richer source; `summary` is the parsed-content fallback for
  // events whose input never survived as an object.
  const preview = previewParams(params) || toOneLine(summary ?? "");

  // In compact mode `ToolHeader` hides the icon and verb, so without a preview
  // the row would render empty — fall back to the tool's own name.
  const headerText = preview || (isCompact ? displayName : "");

  const hasDetails = !!inputJson || !!outputText;

  return (
    <div>
      <ToolHeader
        icon={icon}
        verb={displayName}
        hasDetails={hasDetails}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        {headerText && (
          <span className={`truncate ${TOOL_ROW_TEXT}`}>
            {headerText}
          </span>
        )}
      </ToolHeader>

      {hasDetails && (
        <ToolCollapse isExpanded={isExpanded}>
          <ToolOutputBody as="div" className="text-s font-sans space-y-2 max-h-64">
            {inputJson && (
              <div className="space-y-1">
                <Text as="div" size="t" tone="subtle" weight="medium">
                  Input
                </Text>
                <Text as="pre" size="t" tone="inherit" className="noscrollbar whitespace-pre-wrap wrap-break-word font-mono">
                  {inputJson}
                </Text>
              </div>
            )}

            {outputText && (
              <div
                className={`space-y-1 ${
                  inputJson ? "pt-1 border-t border-primary-100 dark:border-primary/10" : ""
                }`}
              >
                <Text as="div" size="t" tone="subtle" weight="medium">
                  {status === "error" ? "Error" : "Output"}
                </Text>
                <pre
                  className={`noscrollbar whitespace-pre-wrap wrap-break-word font-mono text-t ${
                    status === "error" ? "text-danger" : ""
                  }`}
                >
                  {outputText}
                </pre>
              </div>
            )}
          </ToolOutputBody>
        </ToolCollapse>
      )}
    </div>
  );
}
