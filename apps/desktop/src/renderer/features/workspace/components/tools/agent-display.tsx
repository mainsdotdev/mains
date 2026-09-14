import { useState } from "react";
import { Text } from "@/components/ui";
import { Bot } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader } from "./_shared";

export interface AgentParams {
  subagent_type?: string;
  description?: string;
  prompt?: string;
}

export function AgentDisplay({ params, isCompact = false }: { params: AgentParams; isCompact?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasPrompt = !!params.prompt;

  return (
    <div>
      <ToolHeader
        icon={<Bot className="size-4" />}
        verb="Ran subagent"
        hasDetails={hasPrompt}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        <span className={`truncate ${TOOL_ROW_TEXT}`}>
          {params.description || "Subagent task"}
        </span>
      </ToolHeader>

      {hasPrompt && (
        <ToolCollapse isExpanded={isExpanded}>
          <Text as="div" size="s" tone="contrast" className="noscrollbar whitespace-pre-wrap bg-primary-50 dark:bg-primary/5 rounded-lg p-3 max-h-48 overflow-y-auto">
            {params.prompt}
          </Text>
        </ToolCollapse>
      )}
    </div>
  );
}
