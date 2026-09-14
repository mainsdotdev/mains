import { useState } from "react";
import { Web } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody } from "./_shared";
import { coerceToolOutput } from "../../lib/parse-tool-content";

export interface WebFetchParams {
  /** Copilot / Claude style */
  url?: string;
  /** Codex `WebSearch` and similar — URL or search string */
  query?: string;
  max_length?: number;
}

function targetFromParams(params: WebFetchParams): string {
  const u = params.url?.trim();
  if (u) return u;
  const q = params.query?.trim();
  if (q) return q;
  return "";
}

export function WebFetchDisplay({ params, output, isCompact = false }: { params: WebFetchParams; output?: unknown; isCompact?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const target = targetFromParams(params);
  const isQueryOnly = !params.url?.trim() && !!params.query?.trim();
  const label = isQueryOnly ? "Searched" : "Fetched";

  const content = parseWebFetchOutput(output);
  const hasContent = !!content;

  return (
    <div>
      <ToolHeader
        icon={<Web className="size-4" />}
        verb={label}
        hasDetails={hasContent}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        <code className={`font-sans truncate ${TOOL_ROW_TEXT}`}>
          {truncateUrl(target)}
        </code>
        {typeof params.max_length === "number" && (
          <span className={`shrink-0 ${TOOL_ROW_TEXT}`}>(max {params.max_length})</span>
        )}
      </ToolHeader>

      {hasContent && (
        <ToolCollapse isExpanded={isExpanded}>
          <ToolOutputBody className="text-s font-mono whitespace-pre-wrap">
            {content}
          </ToolOutputBody>
        </ToolCollapse>
      )}
    </div>
  );
}

function parseWebFetchOutput(output: unknown): string | null {
  const parsed = coerceToolOutput(output);

  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.content === "string") return obj.content;
    return JSON.stringify(obj, null, 2);
  }

  // Codex: "Searched: https://..."; plain text results
  if (typeof output === "string") return output;

  return null;
}

function truncateUrl(url: string): string {
  if (url.length <= 60) return url;
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? u.pathname.slice(0, 27) + "..." : u.pathname;
    return u.host + path;
  } catch {
    return url.slice(0, 57) + "...";
  }
}
