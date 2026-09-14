import { useState } from "react";
import { Mains } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader } from "./_shared";
import { Tiny } from "@/components/ui";

export interface SaveReviewParams {
  title?: string;
  summary?: string;
  status?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
}


export function SaveReviewDisplay({
  params,
  isCompact = false,
}: {
  params: SaveReviewParams;
  isCompact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasSummary = !!params.summary;

  return (
    <div>
      <ToolHeader
        icon={<Mains className="size-4" />}
        verb="Saved review"
        hasDetails={hasSummary}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        <span className={`truncate ${TOOL_ROW_TEXT}`}>
          {params.title || "Untitled review"}
        </span>
      </ToolHeader>

      {hasSummary && (
        <ToolCollapse isExpanded={isExpanded}>
          <Tiny as="div" className="whitespace-pre-wrap bg-primary-50 dark:bg-primary/5 rounded-md p-2">
            {params.summary}
          </Tiny>
        </ToolCollapse>
      )}
    </div>
  );
}
