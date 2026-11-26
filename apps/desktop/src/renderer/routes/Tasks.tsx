import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  getSegmentedTabId,
  Heading3,
  Muted,
  SegmentedTabs,
} from "@/components/ui";
import { Plus } from "@/components/ui/icons";
import {
  useGetConnectionStatesQuery,
  type ConnectionState,
  type IssueWithEntity,
  type PullRequestSummary,
} from "@/lib/redux/api";
import { IssuesPanel } from "@/features/tasks/components/issues-panel";
import { PullRequestsPanel } from "@/features/tasks/components/pull-requests-panel";
import { DetailDrawer } from "@/features/tasks/components/detail-drawer";
import { PullRequestView } from "@/features/pull-requests/components/pull-request-view";
import { IssueDetail } from "@/features/tasks/components/issue-detail";
import { StatusMappingButton } from "@/features/tasks/components/status-mapping";
import { TasksLoadError, TasksState } from "@/features/tasks/components/tasks-state";
import { useTasksScope } from "@/features/tasks/hooks/use-tasks-scope";
import type { TasksTab } from "@/features/tasks/lib/scope";
import { ConnectionModalHost } from "@/features/settings/components/connections/connection-modals";
import { ProviderIcon } from "@/features/workspace/components/provider-icon";
import { TASKS_DETAIL_WIDTH_MIN } from "@/lib/layout";

type TasksDetail = (
  | { kind: "pr"; pr: PullRequestSummary }
  | { kind: "issue"; issue: IssueWithEntity }
) & { opened: boolean };

const MIN_LIST_WIDTH = 360;

const TABS: { value: TasksTab; label: string }[] = [
  { value: "issues", label: "Issues" },
  { value: "pull_requests", label: "Pull requests" },
];

export default function TasksPage() {
  // Tab and sidebar scope live in the URL; the sidebar writes the same params.
  const { tab, scope, setTab } = useTasksScope();
  const connections = useGetConnectionStatesQuery(undefined, { skip: tab !== "issues" });
  const issueConnections = connections.currentData?.filter(({ category }) => category === "issues");
  const hasIssueConnections = issueConnections?.some(({ isConnected }) => isConnected) ?? false;
  const [issueConnectionModal, setIssueConnectionModal] = useState<string | null>(null);
  const [selection, setSelection] = useState<TasksDetail | null>(null);
  const detail = selection?.kind === (tab === "issues" ? "issue" : "pr") ? selection : null;
  if (detail?.kind === "issue" && !hasIssueConnections) setSelection(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLElement | null>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const maxDetailWidth = pageWidth - MIN_LIST_WIDTH;
  const compact = maxDetailWidth < TASKS_DETAIL_WIDTH_MIN;
  const showCompactDetail = compact && detail?.opened === true;

  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const measure = () => setPageWidth(page.clientWidth);
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(page);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (showCompactDetail) {
      backRef.current?.focus();
    } else if (rowRef.current) {
      const row = rowRef.current;
      rowRef.current = null;
      if (document.activeElement === document.body || document.activeElement === backRef.current) {
        (row.isConnected ? row : headingRef.current)?.focus();
      }
    }
  }, [showCompactDetail]);

  const switchTab = (next: TasksTab) => {
    // The drawer belongs to the tab that opened it.
    if (next !== tab) setSelection(null);
    setTab(next);
  };

  const selectPr = useCallback(
    (pr: PullRequestSummary | null, opener?: HTMLElement) => {
      if (opener) rowRef.current = opener;
      setSelection(pr ? { kind: "pr", pr, opened: !!opener } : null);
    },
    [],
  );

  const selectIssue = useCallback(
    (issue: IssueWithEntity | null, opener?: HTMLElement) => {
      if (opener) rowRef.current = opener;
      setSelection(issue ? { kind: "issue", issue, opened: !!opener } : null);
    },
    [],
  );

  return (
    <div ref={pageRef} className="h-full flex min-w-0">
      {/* The page itself doesn't scroll — the header, tabs, and each panel's
          search/filter block stay put; only the list area scrolls. */}
      <div className={showCompactDetail ? "hidden" : "flex-1 min-w-0 bg-primary dark:bg-primary-950"}>
        <div className="h-full max-w-240 mx-auto px-2 pt-16 flex flex-col min-h-0">
          <div className="px-6 shrink-0">
            <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                {/* Just the page name — the sidebar shows what is selected. */}
                <Heading3 className="font-sf-expanded" ref={headingRef} tabIndex={-1}>Tasks</Heading3>
                <Muted className="mt-1">
                  Issues and pull requests across your connections.
                </Muted>
              </div>
              {tab === "issues" && hasIssueConnections && <StatusMappingButton scope={scope} />}
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
            className="flex-1 min-h-0 overflow-y-auto noscrollbar"
          >
            {tab === "issues" ? (
              hasIssueConnections ? (
                <IssuesPanel
                  scope={scope}
                  activeEntityId={detail?.kind === "issue" ? detail.issue.issue.entityId : null}
                  onSelectIssue={selectIssue}
                />
              ) : connections.isError ? (
                <TasksLoadError title="Unable to load issue tracker connections." onRetry={() => void connections.refetch()} />
              ) : !issueConnections || connections.isFetching ? (
                <TasksState title="Checking issue tracker connections…" role="status" />
              ) : (
                <IssueConnectionPrompt connections={issueConnections} onConnect={setIssueConnectionModal} />
              )
            ) : (
              <PullRequestsPanel
                scope={scope}
                selectedNodeId={detail?.kind === "pr" ? detail.pr.nodeId : null}
                onSelectPr={selectPr}
              />
            )}
          </div>
        </div>
      </div>

      {/* Keep the split layout stable as tabs load or have no selected item. */}
      <DetailDrawer
        compact={compact}
        visible={!compact || showCompactDetail}
        maxWidth={maxDetailWidth}
        backRef={backRef}
        onBack={() => setSelection((current) => current && { ...current, opened: false })}
      >
        {detail?.kind === "pr" ? (
          <PullRequestView
            prRef={{
              provider: detail.pr.provider,
              owner: detail.pr.repo.owner,
              repo: detail.pr.repo.repo,
              number: detail.pr.number,
            }}
            initialPr={detail.pr}
          />
        ) : detail?.kind === "issue" ? (
          <IssueDetail
            key={detail.issue.issue.entityId}
            issue={detail.issue}
          />
        ) : null}
      </DetailDrawer>
      {issueConnectionModal && (
        <ConnectionModalHost
          activeModal={issueConnectionModal}
          isConnected={(provider) => issueConnections?.some((connection) => connection.id === provider && connection.isConnected) ?? false}
          onClose={() => setIssueConnectionModal(null)}
          onSuccess={() => void connections.refetch()}
        />
      )}
    </div>
  );
}

function IssueConnectionPrompt({ connections, onConnect }: {
  connections: ConnectionState[];
  onConnect: (provider: string) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number; anchorTop: number } | null>(null);
  const providers = [...connections].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <TasksState
      title="No issue tracker connected"
      description="Connect an issue tracker to sync and view its open issues here."
    >
      {providers.length > 0 && (
        <>
          <Button
            ref={triggerRef}
            variant="primary"
            aria-haspopup="menu"
            aria-expanded={position !== null}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              const { left, bottom, top } = event.currentTarget.getBoundingClientRect();
              setPosition(position ? null : { x: left, y: bottom + 6, anchorTop: top - 6 });
            }}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Connect an issue tracker
          </Button>
          <DropdownMenu
            isOpen={position !== null}
            position={position ?? { x: 0, y: 0 }}
            onClose={() => setPosition(null)}
            aria-label="Issue trackers"
          >
            {providers.map(({ id, displayName }) => (
              <DropdownMenuItem key={id} onClick={() => {
                triggerRef.current?.focus();
                setPosition(null);
                onConnect(id);
              }}>
                <ProviderIcon provider={id} className="size-4 shrink-0" />
                {displayName}
              </DropdownMenuItem>
            ))}
          </DropdownMenu>
        </>
      )}
    </TasksState>
  );
}
