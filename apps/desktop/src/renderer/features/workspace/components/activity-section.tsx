import { useCallback, useState, type ReactNode } from "react";
import { useAppDispatch } from "@/lib/redux/hooks";
import {
  useLazyGetRunByIdQuery,
  useListWorkspaceActivityQuery,
  type WorkspaceActivity,
} from "@/lib/redux/api";
import { openNoteTab } from "@/lib/redux/slices/workspaceSlice";
import {
  Note,
  PullRequest,
  Diff,
  Commit,
  CircleDot,
  ArrowUp,
  Activity,
  External,
} from "@/components/ui/icons";
import { Button, Caption, Text, toast } from "@/components/ui";
import { formatAbsoluteDate, formatCompactRelativeDate } from "@/lib/format-date";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useJumpToRun } from "../hooks/use-jump-to-run";
import { useOpenFileInEditor } from "../hooks/use-open-file-in-editor";
import {
  activityActionLabel,
  activityIconClass,
  activityRow,
  type ActivityIconTone,
  type ActivityRowAction,
  type ActivityRowModel,
} from "../lib/activity-row";

interface ActivitySectionProps {
  workspaceId: string;
}

function ActivityIcon({
  type,
  tone,
}: {
  type: WorkspaceActivity["type"];
  tone: ActivityIconTone;
}) {
  const className = `size-4 shrink-0 ${activityIconClass(tone)}`;
  switch (type) {
    case "diff":
      return <Diff className={className} />;
    case "review":
      return <Note className={className} />;
    case "finding":
      return <CircleDot className={className} />;
    case "commit":
      return <Commit className={className} />;
    case "pr":
      return <PullRequest className={className} />;
    case "push":
      return <ArrowUp className={className} />;
    case "pull":
      return <ArrowUp className={`${className} rotate-180`} />;
    default: {
      const unknown: never = type;
      return unknown;
    }
  }
}

function ActivityCopy({
  row,
  sha,
  onCopySha,
  onActivate,
  tooltip,
  adornment,
}: {
  row: ActivityRowModel;
  sha: string | null;
  onCopySha: (sha: string) => void;
  onActivate?: () => void;
  tooltip?: string;
  adornment?: ReactNode;
}) {
  const title = (
    <Text
      as="span"
      size="s"
      tone={row.undone ? "muted" : "default"}
      align="left"
      className="block truncate"
    >
      {row.title}
    </Text>
  );

  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-1">
        {onActivate ? (
          <Button
            variant="bare"
            onClick={onActivate}
            tooltip={tooltip}
            className="block min-w-0 max-w-full shrink overflow-hidden text-left"
          >
            {title}
          </Button>
        ) : (
          <Text
            as="span"
            size="s"
            tone={row.undone ? "muted" : "default"}
            align="left"
            className="min-w-0 shrink truncate"
          >
            {row.title}
          </Text>
        )}
        {adornment}
        {sha && (
          <Button
            variant="bare"
            tooltip="Copy commit"
            onClick={() => onCopySha(sha)}
            className="shrink-0 font-mono text-xxs text-primary-600 hover:text-primary-900 dark:text-primary-400 dark:hover:text-primary-100"
          >
            {sha.slice(0, 7)}
          </Button>
        )}
      </div>
      {row.subtitle && (
        onActivate ? (
          <Button
            variant="bare"
            onClick={onActivate}
            className="mt-0.5 block w-full min-w-0 truncate text-left"
          >
            <Text
              as="span"
              size="xs"
              tone="muted"
              align="left"
              title={row.subtitle}
              className="block truncate"
            >
              {row.subtitle}
            </Text>
          </Button>
        ) : (
          <Text
            as="span"
            size="xs"
            tone="muted"
            align="left"
            title={row.subtitle}
            className="mt-0.5 block truncate"
          >
            {row.subtitle}
          </Text>
        )
      )}
    </div>
  );
}

function ActivityTime({ createdAt }: { createdAt: number }) {
  const relative = formatCompactRelativeDate(createdAt);
  if (!relative) return null;
  return (
    <Text
      as="span"
      size="xxs"
      tone="subtle"
      weight="normal"
      title={formatAbsoluteDate(createdAt)}
      className="mt-1 mr-2 ml-4 shrink-0 tabular-nums"
    >
      {relative}
    </Text>
  );
}

export function ActivitySection({ workspaceId }: ActivitySectionProps) {
  const dispatch = useAppDispatch();
  const jumpToRun = useJumpToRun();
  const openFile = useOpenFileInEditor();
  const [getRunById] = useLazyGetRunByIdQuery();
  const { copy } = useCopyToClipboard({
    onSuccess: () => toast.success("Copied"),
    onError: () => toast.error("Couldn't copy"),
  });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const { data, isLoading, isError, error, refetch } = useListWorkspaceActivityQuery(
    { workspaceId },
    { pollingInterval: 15000, refetchOnFocus: true },
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openRun = useCallback(async (runId: string) => {
    try {
      const run = await getRunById(runId).unwrap();
      if (!run) {
        toast.error("That chat is no longer available");
        return;
      }
      await jumpToRun(run);
    } catch (cause) {
      toast.error(extractErrorMessage(cause, "Couldn't open that chat"));
    }
  }, [getRunById, jumpToRun]);

  const activate = useCallback((action: ActivityRowAction) => {
    switch (action.kind) {
      case "note":
        dispatch(openNoteTab({
          id: action.reviewId,
          title: action.title,
          status: action.status,
        }));
        return;
      case "url":
        void window.api.shell.openExternal(action.url);
        return;
      case "run":
        void openRun(action.runId);
        return;
      case "file":
        void openFile(action.path);
        return;
      default: {
        const unknown: never = action;
        return unknown;
      }
    }
  }, [dispatch, openFile, openRun]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Text as="span" size="xs" tone="muted">
          Loading...
        </Text>
      </div>
    );
  }

  if (isError && !data) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <Caption>{extractErrorMessage(error, "Couldn't load activity.")}</Caption>
          <Button variant="ghost" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const activities = data ?? [];
  if (activities.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 px-4 text-center">
          <Activity className="size-4 text-primary-700 dark:text-primary-300" />
          <Caption>No activity yet.</Caption>
          <Text as="span" size="xxs" tone="subtle" align="center">
            Commits, pull requests, reviews, and file changes show up here.
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 px-3">
      <div className="flex-1 overflow-y-auto overscroll-none noscrollbar">
        {activities.map((activity, index) => (
          <ActivityEntry
            key={activity.id}
            activity={activity}
            isLast={index === activities.length - 1}
            expanded={expandedIds.has(activity.id)}
            onToggle={toggleExpand}
            onActivate={activate}
            onCopySha={(sha) => void copy(sha)}
            style={{ animationDelay: `${index * 0.02}s` }}
          />
        ))}
      </div>
    </div>
  );
}

function ActivityEntry({
  activity,
  isLast,
  expanded,
  onToggle,
  onActivate,
  onCopySha,
  style,
}: {
  activity: WorkspaceActivity;
  isLast: boolean;
  expanded: boolean;
  onToggle: (id: string) => void;
  onActivate: (action: ActivityRowAction) => void;
  onCopySha: (sha: string) => void;
  style: { animationDelay: string };
}) {
  const row = activityRow(activity);
  const sha = row.sha;
  // File lists keep a disclosure. A review opens its note and a pull request
  // opens its URL, so those rows don't carry a second arrow.
  const disclosure = !!row.detail && row.action?.kind !== "url" && row.action?.kind !== "note";
  const externalUrl = row.action?.kind === "url" ? row.action.url : null;
  const activateRow = () => {
    if (row.action) onActivate(row.action);
    else if (row.detail) onToggle(activity.id);
  };

  return (
    <div className="flex items-stretch animate-slide-in" style={style}>
      <div className="flex w-6 shrink-0 flex-col items-center">
        <div className="flex size-5 items-center justify-center">
          <ActivityIcon type={activity.type} tone={row.iconTone} />
        </div>
        {!isLast && (
          <div className="min-h-2 w-px flex-1 bg-primary-700/30 dark:bg-primary/10" />
        )}
      </div>

      <div className="min-w-0 flex-1 pb-3 pl-2">
        <div className="flex min-w-0 items-start">
          <ActivityCopy
            row={row}
            sha={sha}
            onCopySha={onCopySha}
            onActivate={row.action || disclosure ? activateRow : undefined}
            tooltip={row.action ? activityActionLabel(row.action) : undefined}
            adornment={
              disclosure ? (
                <Button
                  variant="bare"
                  aria-expanded={expanded}
                  aria-label={expanded ? "Hide details" : "Show details"}
                  onClick={() => onToggle(activity.id)}
                  className="shrink-0 text-primary-600 hover:text-primary-900 dark:text-primary-400 dark:hover:text-primary-100"
                >
                  <ArrowUp
                    className={`size-3.5 transition-transform duration-200 ${expanded ? "rotate-180" : "rotate-90"}`}
                  />
                </Button>
              ) : externalUrl ? (
                <Button
                  variant="bare"
                  tooltip="Open pull request"
                  aria-label="Open pull request"
                  onClick={() => onActivate({ kind: "url", url: externalUrl })}
                  className="shrink-0 text-primary-600 hover:text-primary-900 dark:text-primary-400 dark:hover:text-primary-100"
                >
                  <External className="size-3.5" />
                </Button>
              ) : null
            }
          />
          <ActivityTime createdAt={activity.createdAt} />
        </div>

        {disclosure && (
          <div
            className={`grid transition-[grid-template-rows] duration-200 ease-out ${
              expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div className="overflow-hidden">
              <Text
                as="span"
                size="xs"
                tone="muted"
                align="left"
                className="block whitespace-pre-wrap px-1 pt-1"
              >
                {row.detail}
              </Text>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
