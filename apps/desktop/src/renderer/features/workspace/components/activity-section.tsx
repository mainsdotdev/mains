import { useState } from "react";
import { useAppDispatch } from "@/lib/redux/hooks";
import { useListWorkspaceActivityQuery } from "@/lib/redux/api";
import type { WorkspaceActivity } from "@/lib/redux/api";
import { openNoteTab } from "@/lib/redux/slices/workspaceSlice";
import { Note, PullRequest, Diff, Commit, CircleDot, ArrowUp } from "@/components/ui/icons";
import { Button, Caption, Text } from "@/components/ui";
import { formatDate } from "@/lib/format-date";

interface ActivitySectionProps {
  workspaceId: string;
}

function ActivityIcon({ type }: { type: WorkspaceActivity["type"] }) {
  switch (type) {
    case "diff":
      return <Diff className="size-4 text-primary-700 dark:text-primary-300  shrink-0" />;
    case "review":
      return <Note className="size-4 text-primary-700 dark:text-primary-300 shrink-0" />;
    case "finding":
      return <CircleDot className="size-4 text-primary-700 dark:text-primary-300  shrink-0" />;
    case "commit":
      return <Commit className="size-5 text-primary-700 dark:text-primary-300  shrink-0" />;
    case "pr":
      return <PullRequest className="size-4 text-primary-700 dark:text-primary-300  shrink-0" />;
    case "push":
      return <ArrowUp className="size-4 text-primary-700 dark:text-primary-300  shrink-0" />;
    // Same glyph as push, flipped — the pair reads as one axis.
    case "pull":
      return (
        <ArrowUp className="size-4 rotate-180 text-primary-700 dark:text-primary-300 shrink-0" />
      );
  }
}

function activityDetail(activity: WorkspaceActivity): string | null {
  const meta = activity.metadata as any;
  switch (activity.type) {
    case "diff":
      return activity.summary || null;
    case "finding": {
      if (meta?.count) {
        const parts: string[] = [];
        if (meta.critical) parts.push(`${meta.critical} critical`);
        if (meta.warning) parts.push(`${meta.warning} warning`);
        if (meta.info) parts.push(`${meta.info} info`);
        return parts.length > 0 ? parts.join(", ") : null;
      }
      return meta?.severity ?? null;
    }
    case "commit":
      return activity.title;
    // The PR body travels in `summary` — expanding the row shows it.
    case "pr":
      return activity.summary || null;
    case "push":
      return meta?.branch ? `Pushed ${meta.branch}` : null;
    case "pull":
      return meta?.branch ? `Fast-forwarded ${meta.branch}` : null;
    default:
      return null;
  }
}

export function ActivitySection({ workspaceId }: ActivitySectionProps) {
  const dispatch = useAppDispatch();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const { data: activities = [], isLoading } = useListWorkspaceActivityQuery(
    { workspaceId },
    { pollingInterval: 15000, refetchOnFocus: true },
  );

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Text as="span" size="xs" tone="muted">Loading...</Text>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 px-4 text-center">
          <Note className="w-4 h-4 dark:text-primary-300 text-primary-700" />
          <Caption>
            No activity yet.
          </Caption>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 px-3">
      {/* Activity timeline */}
      <div className="flex-1 overflow-y-auto noscrollbar">
        {activities.map((activity, index) => {
          const isLast = index === activities.length - 1;
          const detail = activityDetail(activity);
          const isClickable = activity.type === "review" && !!activity.refId;
          const isExpanded = expandedIds.has(activity.id);

          return (
            <div
              key={activity.id}
              className="flex items-stretch animate-slide-in "
              style={{ animationDelay: `${index * 0.02}s` }}
            >
              {/* Icon column with connecting line */}
              <div className="flex flex-col items-center shrink-0 w-6">
                <div className="flex items-center justify-center size-6">
                  <ActivityIcon type={activity.type} />
                </div>
                {!isLast && (
                  <div className="flex-1 w-px bg-primary-700/30 dark:bg-primary/10 min-h-2" />
                )}
              </div>

              {/* Content */}
              <Button
                onClick={() => {
                  if (isClickable) {
                    dispatch(
                      openNoteTab({
                        id: activity.refId!,
                        title: activity.title,
                        status: (activity.metadata as any)?.status ?? "open",
                      }),
                    );
                  } else if (detail) {
                    toggleExpand(activity.id);
                  }
                }}
                className={`flex-1 min-w-0 flex items-start pl-2 pb-3 ${
                  isClickable || detail
                    ? "cursor-pointer hover:opacity-80"
                    : "cursor-default"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <Text as="span" size="s" tone="default" align="left" className="truncate max-w-full block">
                    {activity.type === "commit" ? (
                      <>
                        You committed changes
                        {activity.refId && (
                          <Text as="span" size="xxs" tone="subtle" className="ml-1 font-mono">
                            {activity.refId.slice(0, 7)}
                          </Text>
                        )}
                      </>
                    ) : activity.type === "finding" && (activity.metadata as any)?.count ? (
                      <>Mains added {(activity.metadata as any).count} finding{(activity.metadata as any).count === 1 ? "" : "s"}</>
                    ) : (
                      activity.title
                    )}
                    <Text as="span" size="xxs" tone="muted" weight="normal">
                      {" "}&middot; {formatDate(activity.createdAt)}
                    </Text>
                  </Text>
                  {detail && (
                    <div
                      className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                        isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                      }`}
                    >
                      <div className="overflow-hidden">
                        <Text as="span" size="t" tone="muted" align="left" className="block mt-1 whitespace-pre-wrap">
                          {detail}
                        </Text>
                      </div>
                    </div>
                  )}
                </div>

                {detail && (
                  <ArrowUp
                    className={`shrink-0 size-3 mt-1 text-primary-700 dark:text-primary-300 transition-transform duration-200 ${
                      isExpanded ? "rotate-180" : "rotate-90"
                    }`}
                  />
                )}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
