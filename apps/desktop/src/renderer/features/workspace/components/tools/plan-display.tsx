import type { PlanDecisionResult } from "@mains/contracts/plan-decision";
import { onTransportChange } from "@/lib/transport";
import { useToolExpansion } from "../../lib/transcript-view-state";
import { useLayoutEffect, useReducer, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "@/components/markdown-components";
import type { RunEvent } from "../../types";
import { Plan, ArrowUp } from "@/components/ui/icons";
import { Button, Text, ErrorText } from "@/components/ui";
import { coerceToolOutput } from "../../lib/parse-tool-content";
import { useReplicaView } from "@/hooks/use-replica-view";
import {
  createPlanViewLifecycle,
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
  onApplyPlan?: (toolCallId: number) => Promise<PlanDecisionResult>;
  onDismissPlan?: (toolCallId: number) => Promise<PlanDecisionResult>;
}

export function PlanDisplay(props: PlanDisplayProps) {
  const [revision, advance] = useReducer((value: number) => value + 1, 0);
  useLayoutEffect(() => onTransportChange(advance), []);
  return <PlanDisplayContent key={`${props.event.id}:${revision}`} {...props} />;
}

function PlanDisplayContent({
  event,
  interactionMode = "follow-up",
  hasPendingApproval = false,
  isRunActive = false,
  onApplyPlan,
  onDismissPlan,
}: PlanDisplayProps) {
  const replica = useReplicaView();
  const [owner] = useState(createPlanViewLifecycle);
  useLayoutEffect(() => {
    owner.attach();
    const off = onTransportChange(() => owner.retire());
    return () => { off(); owner.detach(); };
  }, [owner]);

  const input = event.metadata?.input as Record<string, unknown> | undefined;
  const parsedOutput = coerceToolOutput(event.metadata?.output) as
    | Record<string, unknown>
    | null;

  const savedStatus = getPersistedPlanStatus(event.metadata, parsedOutput);
  const [localStatus, setStatus] = useState<PlanStatus>(savedStatus);
  const status = savedStatus !== "pending" ? savedStatus : localStatus;
  const [error, setError] = useState<string>();
  // A plan stays open only while it still needs a decision. Applied, dismissed,
  // and failed ones are settled history, and a transcript of long plans all
  // sitting open buries everything that came after them.
  const [isExpanded, setIsExpanded] = useToolExpansion(savedStatus === "pending");
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

  const decide = async (action: "apply" | "dismiss") => {
    if (replica || !Number.isSafeInteger(toolCallId) || toolCallId <= 0 || status !== "pending") return;
    const send = action === "apply" ? onApplyPlan : onDismissPlan;
    if (!send) return;
    const lease = owner.begin();
    if (!lease) return;
    setIsSubmitting(true); setError(undefined);
    try {
      const result = await send(toolCallId);
      if (lease.current()) { setStatus(result.status); setIsExpanded(false); }
    } catch (caught) {
      if (lease.current()) setError(caught instanceof Error ? caught.message : "Could not save the plan decision. Retry.");
    } finally { if (lease.current()) setIsSubmitting(false); lease.finish(); }
  };
  const handleApply = () => { void decide("apply"); };
  const handleDismiss = () => { void decide("dismiss"); };

  const showActions = !replica && (!!onApplyPlan || !!onDismissPlan) && shouldShowPlanActions({
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

          {error && <ErrorText className="px-6" role="alert">{error}</ErrorText>}
          {/* Live approvals require a pending broker request; follow-ups require a finished run. */}
          {showActions && (
            <div className="flex items-center justify-end gap-2 px-6 py-2.5 border-t border-primary-500/10 dark:border-primary-400/10 shrink-0">
              <Button
                variant="submit"
                onClick={handleApply}
                disabled={isSubmitting || !onApplyPlan}
              >
                Apply Plan
              </Button>
              <Button
                variant="secondary"
                onClick={handleDismiss}
                disabled={isSubmitting || !onDismissPlan}
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
