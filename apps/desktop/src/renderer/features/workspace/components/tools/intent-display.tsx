import { useState } from "react";
import { Notes } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody } from "./_shared";

export interface IntentParams {
  intent?: string;
}

export function IntentDisplay({ params, isCompact = false }: { params: IntentParams; isCompact?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasIntent = !!params.intent;

  return (
    <div>
      <ToolHeader
        icon={<Notes className="size-4" />}
        verb="Intent"
        hasDetails={hasIntent}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        <span className={`truncate ${TOOL_ROW_TEXT}`}>
          {params.intent || "Unknown intent"}
        </span>
      </ToolHeader>

      {hasIntent && (
        <ToolCollapse isExpanded={isExpanded}>
          <ToolOutputBody as="div" className="text-s whitespace-pre-wrap">
            {params.intent}
          </ToolOutputBody>
        </ToolCollapse>
      )}
    </div>
  );
}
