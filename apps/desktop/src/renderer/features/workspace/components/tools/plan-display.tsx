import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "@/components/markdown-components";
import type { RunEvent } from "../../types";
import { Plan, ArrowUp } from "@/components/ui/icons";
import { useUpdateToolCallMutation } from "@/lib/redux/api/toolsApi";
import { Button, Text } from "@/components/ui";
import { coerceToolOutput } from "../../lib/parse-tool-content";
import {
  getPersistedPlanStatus,
  shouldShowPlanActions,
  type PlanInteractionMode,
  type PlanStatus,
} from "../../lib/plan-approval";

interface PlanDisplayProps {
  event: RunEvent;
  interactionMode?: PlanInteractionMode;
  hasPendingApproval?: boolean;
  isRunActive?: boolean;
  onApplyPlan?: () => void | Promise<void>;
  onDismissPlan?: () => void | Promise<void>;
}

export function PlanDisplay({
  event,
  interactionMode = "follow-up",
  hasPendingApproval = false,
  isRunActive = false,
  onApplyPlan,
  onDismissPlan,
}: PlanDisplayProps) {
  const [updateToolCall] = useUpdateToolCallMutation();

  const input = event.metadata?.input as Record<string, unknown> | undefined;
  const parsedOutput = coerceToolOutput(event.metadata?.output) as
    | Record<string, unknown>
    | null;

  const savedStatus = getPersistedPlanStatus(event.metadata, parsedOutput);
  const [status, setStatus] = useState<PlanStatus>(savedStatus);
  // A plan stays open only while it still needs a decision. Applied, dismissed,
  // and failed ones are settled history, and a transcript of long plans all
  // sitting open buries everything that came after them.
  const [isExpanded, setIsExpanded] = useState(savedStatus === "pending");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const content = (input?.plan as string) || event.content || "";

  // Skip rendering if there's no actual plan content (e.g. empty start events like "Create Plan: {}")
  if (!content.trim()) return null;
  if (!(input?.plan)) {
    const afterColon = content.indexOf(":") !== -1 ? content.substring(content.indexOf(":") + 1).trim() : content.trim();
    if (!afterColon || afterColon === "{}") return null;
  }

  // Extract tool call DB id from event id (format: "tool-{id}")
  const toolCallId = parseInt(event.id.replace("tool-", ""), 10);

  const persistStatus = async (newStatus: PlanStatus) => {
    setStatus(newStatus);
    if (!isNaN(toolCallId)) {
      await updateToolCall({
        id: toolCallId,
        payload: { metadata: { planStatus: newStatus } },
      });
    }
  };

  const handleApply = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await persistStatus("applied");
      // Collapses on the spot, the way Dismiss does — otherwise a decided plan
      // reads as open now and closed after the next reload.
      setIsExpanded(false);
      await onApplyPlan?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDismiss = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await persistStatus("dismissed");
      setIsExpanded(false);
      await onDismissPlan?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  const showActions = shouldShowPlanActions({
    status,
    interactionMode,
    hasPendingApproval,
    isRunActive,
  });

  return (
    <div className="overflow-hidden rounded-2xl glass-surface flex flex-col my-4">
      <Button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-6 py-3 cursor-pointer hover:bg-primary-100/50 dark:hover:bg-primary-500/10 transition-colors"
      >
        <Plan className="size-3.5 text-primary-500 shrink-0" />
        <Text as="span" size="xs" tone="faint" weight="medium">
          Plan
        </Text>
        {status === "applied" && (
          <Text as="span" size="xxs" tone="faint" className="flex items-center gap-1">
            Applied
          </Text>
        )}
        {status === "dismissed" && (
          <Text as="span" size="xxs" tone="faint">
            Dismissed
          </Text>
        )}
        {status === "failed" && (
          <Text as="span" size="xxs" tone="danger">
            Failed
          </Text>
        )}
        <ArrowUp
          className={`size-3 text-primary-500 ml-auto transition-transform ${isExpanded ? "rotate-180" : "rotate-90"}`}
        />
      </Button>

      {/* Content — collapsible */}
      {isExpanded && (
        <>
          <div className="relative px-6 pb-3 max-h-100 overflow-y-auto">
            {/* Left accent bar */}
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                components={markdownComponents}
                remarkPlugins={[remarkGfm]}
              >
                {content}
              </ReactMarkdown>
            </div>
          </div>

          {/* Live approvals require a pending broker request; follow-ups require a finished run. */}
          {showActions && (
            <div className="flex items-center justify-end gap-2 px-6 py-2.5 border-t border-primary-500/10 dark:border-primary-400/10 shrink-0">
              <Button
                variant="submit"
                onClick={handleApply}
                disabled={isSubmitting}
              >
                Apply Plan
              </Button>
              <Button
                variant="secondary"
                onClick={handleDismiss}
                disabled={isSubmitting}
              >
                Dismiss
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
