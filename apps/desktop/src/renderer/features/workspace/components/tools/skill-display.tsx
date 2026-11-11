import type { ReactNode } from "react";
import { Sparkles } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolHeader } from "./_shared";

export interface SkillParams {
  skill?: string;
  args?: string;
}

/** Header-only display — a skill invocation has no expandable body. */
export function SkillDisplay({
  params,
  isCompact = false,
  icon,
}: {
  params: SkillParams;
  isCompact?: boolean;
  /** Plugin-derived icon override; falls back to the Sparkles glyph when absent. */
  icon?: ReactNode;
}) {
  const skillName = params.skill || "unknown";

  return (
    <div>
      <ToolHeader
        icon={icon ?? <Sparkles className="size-4" />}
        verb="Skill"
        hasDetails={false}
        isExpanded={false}
        onToggle={() => {}}
        isCompact={isCompact}
      >
        <span className={TOOL_ROW_TEXT}>
          /{skillName}
        </span>
        {params.args && (
          <span className={`truncate ${TOOL_ROW_TEXT}`}>
            {params.args}
          </span>
        )}
      </ToolHeader>
    </div>
  );
}
