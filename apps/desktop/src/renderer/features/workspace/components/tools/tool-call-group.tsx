import { memo, useState } from "react";
import { TOOL_ROW_TEXT } from "./_shared";
import { ArrowUp } from "@/components/ui/icons";
import { groupConsecutiveToolCalls } from "../../lib/group-tool-calls";
import { resolveTool } from "../../lib/resolve-tool";
import {
  normalizeSlug,
  renderPluginIcon,
  usePluginLogoMap,
} from "../../hooks";
import { ToolSubGroupAccordion } from "./tool-sub-group-accordion";
import type { EventGroup } from "../../lib/group-events";
import { Button } from "@/components/ui";

interface ToolCallGroupProps {
  group: EventGroup;
  defaultExpanded?: boolean;
  variant?: "copilot" | "claude" | "codex" | "cursor";
}

function ToolCallGroupImpl({
  group,
  defaultExpanded = false,
}: ToolCallGroupProps) {
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const isExpanded = expandedOverride ?? defaultExpanded;
  const pluginLogos = usePluginLogoMap();

  const subGroups = groupConsecutiveToolCalls(group.events);
  const toolCount = subGroups.reduce((acc, sg) => acc + sg.events.length, 0);

  // Single tool call: skip the outer group wrapper entirely and render the
  // item directly (ToolSubGroupAccordion already collapses 1-event subgroups).
  if (toolCount === 1 && subGroups.length === 1) {
    return (
      <div>
        <ToolSubGroupAccordion subGroup={subGroups[0]} />
      </div>
    );
  }

  const toolTypes = new Set(subGroups.map((sg) => sg.displayName));
  const toolSummary = Array.from(toolTypes).slice(0, 3).join(", ");
  const moreCount = toolTypes.size > 3 ? ` +${toolTypes.size - 3}` : "";
  const toolIcons = new Map<string, React.ReactNode>();

  for (const subGroup of subGroups) {
    const resolved = resolveTool(subGroup.events[0].content);
    const iconKey = resolved.vendorId
      ? `vendor:${normalizeSlug(resolved.vendorId)}`
      : `tool:${resolved.groupKey}`;

    if (toolIcons.has(iconKey)) continue;

    const pluginIcon = resolved.vendorId
      ? renderPluginIcon(
          pluginLogos.get(normalizeSlug(resolved.vendorId)),
          "size-4",
        )
      : null;
    toolIcons.set(iconKey, pluginIcon ?? subGroup.icon);
  }

  return (
    <div className="mb-2">
      <Button
        onClick={() => setExpandedOverride(!isExpanded)}
        className="group w-full flex items-center gap-1 mb-1 text-s font-sans cursor-pointer"
      >
        <div className="flex items-center transition-all duration-200">
          {/* Collapsing on `grid-template-columns` rather than `max-width` —
              the same trick `ToolCollapse` uses vertically. A max-width
              animation has to guess a cap (it was 5rem), and every pixel
              between the cap and the strip's real width is dead time: the
              strip sat still, then clipped in the last moment. `1fr` resolves
              to the strip's own width, whether that is one icon or five, so
              the whole 200ms is the actual shrink. */}
          <span
            aria-hidden="true"
            className={`grid shrink-0 overflow-hidden transition-[grid-template-columns,opacity,margin] duration-200 ease-out ${ isExpanded ? "mr-0 grid-cols-[0fr] opacity-0" : "mr-1 grid-cols-[1fr] opacity-100" } ${TOOL_ROW_TEXT}`}
          >
            <span className="flex min-w-0 items-center gap-1 overflow-hidden">
              {Array.from(toolIcons.entries()).slice(0, 5).map(([key, icon]) => (
                <span
                  key={key}
                  className="flex size-4 items-center justify-center [&>svg]:size-4"
                >
                  {icon}
                </span>
              ))}
            </span>
          </span>
          <span className={`mr-0.5 ${TOOL_ROW_TEXT}`}>
            {toolCount} tool call{toolCount !== 1 ? "s" : ""}
          </span>
          <span className={`truncate ${TOOL_ROW_TEXT}`}>
            ({toolSummary}
            {moreCount})
          </span>
        </div>
        <ArrowUp
          className={`size-4 shrink-0 opacity-100 transition-all duration-200 group-hover:opacity-100 ${isExpanded ? "rotate-180" : "rotate-90"} ${TOOL_ROW_TEXT}`}
        />
{/*
        {group.isRunning && (
          <Text as="span" size="xs" tone="muted" className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            Running
          </Text>
        )} */}
      </Button>

      <div className={`grid transition-all duration-200 ease-out ${isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-0.5 max-h-160 overflow-y-auto">
            {subGroups.map((subGroup) => (
              <ToolSubGroupAccordion key={subGroup.id} subGroup={subGroup} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Memoized so a streamed token re-renders only the live tool group, not every
 * historical one. Relies on `reconcileEventGroups` keeping `group` referentially
 * stable for unchanged groups (see `group-events.ts`).
 */
export const ToolCallGroup = memo(ToolCallGroupImpl);

// Re-export for backwards compatibility
export { InfoGroup } from "./info-group";
export {
  groupEvents,
  reconcileEventGroups,
  isPlanToolCallGroup,
  toolEventPlanName,
  type EventGroup,
} from "../../lib/group-events";
