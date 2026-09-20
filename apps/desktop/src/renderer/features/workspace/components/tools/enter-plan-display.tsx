import { useState } from "react";
import { Text } from "@/components/ui";
import { EnterPlan } from "@/components/ui/icons";
import { ToolCollapse, ToolHeader, ToolOutputBody, useToolStatus } from "./_shared";
import { toolOutputText } from "../../lib/parse-tool-content";

/** EnterPlanMode takes no input — the CLI always sends `{}`. */
export type EnterPlanParams = Record<string, unknown>;

/**
 * The model switching the session into plan mode. The call has nothing to show
 * in the row; its output is the CLI's instructions to the model (explore, don't
 * edit, finish with ExitPlanMode), kept behind the chevron — or, when the
 * switch was refused, the reason.
 */
export function EnterPlanDisplay({
  output,
  isCompact = false,
}: {
  params: EnterPlanParams;
  output?: unknown;
  isCompact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const status = useToolStatus();

  const result = toolOutputText(output);
  const failed = status === "error";

  return (
    <div>
      <ToolHeader
        icon={<EnterPlan className="size-4" />}
        verb={failed ? "Couldn't enter plan mode" : "Entered plan mode"}
        hasDetails={!!result}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      />

      {result && (
        <ToolCollapse isExpanded={isExpanded}>
          <ToolOutputBody as="div" className="text-s font-sans space-y-1">
            <Text as="div" size="t" tone="subtle" weight="medium">
              {failed ? "Error" : "Instructions to Claude"}
            </Text>
            <div className={`whitespace-pre-wrap ${failed ? "text-danger" : ""}`}>
              {result}
            </div>
          </ToolOutputBody>
        </ToolCollapse>
      )}
    </div>
  );
}
