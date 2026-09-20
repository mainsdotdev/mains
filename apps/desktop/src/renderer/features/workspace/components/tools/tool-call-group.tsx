import { memo, useCallback, useEffect, useRef, useState } from "react";
import { TOOL_ROW_TEXT } from "./_shared";
import { ArrowUp } from "@/components/ui/icons";
import { prepareToolCalls } from "../../lib/group-tool-calls";
import { resolveTool } from "../../lib/resolve-tool";
import {
  normalizeSlug,
  renderPluginIcon,
  usePluginLogoMap,
} from "../../hooks";
import { ToolCallItem } from "./tool-call-item";
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
  const [showTopFade, setShowTopFade] = useState(false);
  const [showBottomFade, setShowBottomFade] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const isExpanded = expandedOverride ?? defaultExpanded;
  const pluginLogos = usePluginLogoMap();

  const updateScrollFades = useCallback(() => {
    const element = scrollContainerRef.current;
    if (!element) return;

    setShowTopFade(element.scrollTop > 1);
    const hasMoreBelow =
      element.scrollHeight - element.scrollTop - element.clientHeight > 1;
    setShowBottomFade(hasMoreBelow);
  }, []);

  useEffect(() => {
    if (!isExpanded) return;

    const frame = requestAnimationFrame(updateScrollFades);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateScrollFades);

    if (scrollContainerRef.current) observer?.observe(scrollContainerRef.current);
    if (scrollContentRef.current) observer?.observe(scrollContentRef.current);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [isExpanded, updateScrollFades]);

  // Preparation keeps the plan filtering and cumulative edit snapshots, but
  // every remaining invocation renders as a peer inside the main tool group.
  const toolEvents = prepareToolCalls(group.events);
  const toolCount = toolEvents.length;

  // Single tool call: skip the outer group wrapper entirely.
  if (toolCount === 1) {
    return (
      <div>
        <ToolCallItem event={toolEvents[0]} isCompact={false} />
      </div>
    );
  }

  const toolTypes = new Set(
    toolEvents.map((event) => resolveTool(event.content).groupLabel),
  );
  const toolSummary = Array.from(toolTypes).slice(0, 3).join(", ");
  const moreCount = toolTypes.size > 3 ? ` +${toolTypes.size - 3}` : "";
  const toolIcons = new Map<string, React.ReactNode>();

  for (const event of toolEvents) {
    const resolved = resolveTool(event.content);
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
    toolIcons.set(iconKey, pluginIcon ?? resolved.icon);
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
          <div className="relative">
            <div
              ref={scrollContainerRef}
              onScroll={updateScrollFades}
              className="noscrollbar max-h-80 overflow-y-auto overscroll-contain"
            >
              <div ref={scrollContentRef} className="space-y-0.5">
                {toolEvents.map((event) => (
                  <ToolCallItem key={event.id} event={event} isCompact={false} />
                ))}
              </div>
            </div>
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-0 top-0 h-12 bg-linear-to-b from-primary to-transparent transition-opacity duration-150 dark:from-primary-950 ${isExpanded && showTopFade ? "opacity-100" : "opacity-0"}`}
            />
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-primary to-transparent transition-opacity duration-150 dark:from-primary-950 ${isExpanded && showBottomFade ? "opacity-100" : "opacity-0"}`}
            />
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
