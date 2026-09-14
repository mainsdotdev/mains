import { useState } from "react";
import { Layers } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody } from "./_shared";
import { coerceToolOutput } from "../../lib/parse-tool-content";

export interface SqlParams {
  query?: string;
  description?: string;
  args?: string;
}

/** Copilot's `sql` tool (session-state todo bookkeeping): { description, query }. */
export function SqlDisplay({
  params,
  isCompact = false,
}: {
  params: SqlParams;
  isCompact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { query, description } = normalize(params);
  const hasDetails = !!query;
  const summary = description || query.split("\n").find((l) => l.trim()) || "query";

  return (
    <div>
      <ToolHeader
        icon={<Layers className="size-4" />}
        verb="SQL"
        hasDetails={hasDetails}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        <span className={`truncate ${TOOL_ROW_TEXT}`}>
          {summary}
        </span>
      </ToolHeader>

      {hasDetails && (
        <ToolCollapse isExpanded={isExpanded}>
          <ToolOutputBody className="text-s font-mono whitespace-pre-wrap">
            {query}
          </ToolOutputBody>
        </ToolCollapse>
      )}
    </div>
  );
}

/** Tolerate the `{ args: "<json>" }` envelope the adapter wraps non-object tool args in. */
function normalize(params: SqlParams): { query: string; description: string } {
  let p: SqlParams = params;
  const parsed = coerceToolOutput(params.args);
  if (parsed && typeof parsed === "object") p = { ...params, ...parsed };
  return {
    query: typeof p.query === "string" ? p.query : "",
    description: typeof p.description === "string" ? p.description : "",
  };
}
