import { useCallback, useState } from "react";
import {
  getSegmentedTabId,
  Heading3,
  Muted,
  SegmentedTabs,
  Text,
} from "@/components/ui";
import type { IssueWithEntity, PullRequestSummary } from "@/lib/redux/api";
import { IssuesPanel } from "@/features/tasks/components/issues-panel";
import { PullRequestsPanel } from "@/features/tasks/components/pull-requests-panel";
import { DetailDrawer } from "@/features/tasks/components/detail-drawer";
import { PrDetail } from "@/features/tasks/components/pr-detail";
import { IssueDetail } from "@/features/tasks/components/issue-detail";

type TasksTab = "issues" | "pull_requests";

type TasksDetail =
  | { kind: "pr"; pr: PullRequestSummary }
  | { kind: "issue"; issue: IssueWithEntity };

const TABS: { value: TasksTab; label: string }[] = [
  { value: "issues", label: "Issues" },
  { value: "pull_requests", label: "Pull requests" },
];

export default function TasksPage() {
  const [tab, setTab] = useState<TasksTab>("issues");
  // The panels auto-select their top row whenever this is empty or stale, so
  // the always-open drawer only shows the empty state on a genuinely empty list.
  const [detail, setDetail] = useState<TasksDetail | null>(null);

  const switchTab = (next: TasksTab) => {
    setTab(next);
    // The drawer belongs to the tab that opened it.
    if (next !== tab) setDetail(null);
  };

  const selectPr = useCallback(
    (pr: PullRequestSummary | null) =>
      setDetail(pr ? { kind: "pr", pr } : null),
    [],
  );

  const selectIssue = useCallback(
    (issue: IssueWithEntity | null) =>
      setDetail(issue ? { kind: "issue", issue } : null),
    [],
  );

  return (
    <div className="h-full flex min-w-0">
      {/* The page itself doesn't scroll — the header, tabs, and each panel's
          search/filter block stay put; only the list area scrolls. */}
      <div className="flex-1 min-w-0 bg-primary dark:bg-primary-950">
        <div className="h-full max-w-240 mx-auto px-2 pt-16 flex flex-col min-h-0">
          <div className="px-6 shrink-0">
            <header className="mb-6">
              <Heading3>Tasks</Heading3>
              <Muted className="mt-1">
                Issues and pull requests across your connections.
              </Muted>
            </header>

            <SegmentedTabs
              id="tasks-view-tabs"
              value={tab}
              onChange={switchTab}
              options={TABS}
              panelId="tasks-view-panel"
              aria-label="Task type"
              className="w-fit mb-4"
            />
          </div>

          <div
            id="tasks-view-panel"
            role="tabpanel"
            aria-labelledby={getSegmentedTabId("tasks-view-tabs", tab)}
            className="flex-1 min-h-0"
          >
            {tab === "issues" ? (
              <IssuesPanel
                activeEntityId={
                  detail?.kind === "issue" ? detail.issue.issue.entityId : null
                }
                onSelectIssue={selectIssue}
              />
            ) : (
              <PullRequestsPanel
                selectedNodeId={detail?.kind === "pr" ? detail.pr.nodeId : null}
                onSelectPr={selectPr}
              />
            )}
          </div>
        </div>
      </div>

      <DetailDrawer>
        {detail?.kind === "pr" ? (
          <PrDetail key={detail.pr.nodeId} pr={detail.pr} />
        ) : detail?.kind === "issue" ? (
          <IssueDetail
            key={detail.issue.issue.entityId}
            issue={detail.issue}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <Text size="xs" tone="subtle">
              {tab === "issues" ? "No issues" : "No pull requests"}
            </Text>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
