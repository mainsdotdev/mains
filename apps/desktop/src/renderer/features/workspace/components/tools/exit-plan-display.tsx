import { useState } from "react";
import { Text } from "@/components/ui";
import { ExitPlan } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader } from "./_shared";

export interface ExitPlanParams {
  plan?: string;
  allowedPrompts?: { tool: string; prompt: string }[];
}

export function ExitPlanDisplay({ params }: { params: ExitPlanParams }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const plan = params.plan || "";
  const charCount = plan.length;
  const hasPlan = !!plan;

  return (
    <div>
      <ToolHeader
        icon={<ExitPlan className="size-4" />}
        verb="Plan"
        hasDetails={hasPlan}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
      >
        <span className={`truncate ${TOOL_ROW_TEXT}`}>
          {charCount > 0 ? `(${charCount} chars)` : "No plan content"}
        </span>
      </ToolHeader>

      {hasPlan && (
        <ToolCollapse isExpanded={isExpanded}>
          <Text as="div" size="sm" tone="contrast" className="noscrollbar whitespace-pre-wrap bg-primary-50 dark:bg-primary/5 rounded-md p-3 max-h-80 overflow-y-auto">
            {plan}
          </Text>
        </ToolCollapse>
      )}
    </div>
  );
}
