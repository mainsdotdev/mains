import { Fragment, type ReactNode, RefObject, useMemo, useRef, useState, useCallback, useEffect } from "react";
import {
  ToolCallGroup,
  InfoGroup,
  groupEvents,
  reconcileEventGroups,
  isPlanToolCallGroup,
  toolEventPlanName,
  type EventGroup,
} from "./tools/tool-call-group";
import { PlanDisplay } from "./tools/plan-display";
import { demoteStaleRunningTools } from "./tools/_shared";
import { EditorContent } from "./editor-content";
import { IssueTabContent } from "./issue-tab-content";
import { SignalTabContent } from "./signal-tab-content";
import { NoteTabContent } from "./note-tab-content";
import { WorkspaceEmptyState } from "./workspace-empty-state";
import { TurnRail } from "./turn-rail";
import { CONTENT_COLUMN_GUTTER } from "../lib/content-column";
import { buildTurnMarkers, type TurnMarker } from "../lib/turn-markers";
import { FILE_WRITING_TOOLS } from "../lib/tool-registry";
import { resolveTool } from "../lib/resolve-tool";
import { useModeConfig } from "@/hooks/use-mode-config";
import type { Run, RunEvent, Workspace } from "../types";
import type { IssueWithEntity, SignalWithEntity, RunTurn, ModelUsageEntry } from "@/lib/redux/api";
import {
  buildTurnRenderRows,
  matchTurnsToGroups,
  isUserPromptGroup,
  type SessionInfo,
} from "../lib/transcript-rows";

const EMPTY_TURNS: RunTurn[] = [];
import { isIssueTab, getIssueEntityId, isSignalTab, getSignalEntityId, isNoteTab, getNoteId, isNewRunTab } from "../lib/repo-utils";
import { AsciiLoader } from "./ascii-loader";
import { ProviderAuthNotice } from "./provider-auth-notice";
import { classifyRunErrorKind } from "../../../../shared/run-errors";
import { ArrowUp, Fork } from "@/components/ui/icons";
import { useGetAppSettingsQuery, useGetProviderAccountInfoQuery } from "@/lib/redux/api";
import { getProviderVariant } from "@/lib/provider-variants";
import { isDocumentRenderImage } from "@/lib/document-viewer";
import { Button, CopyButton, Text, Tooltip } from "@/components/ui";
import { formatCostFromMicros, formatDurationMs } from "@/lib/format";
import { PromptSuggestionChips } from "./prompt-suggestion-chips";

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Assistant-error codes an auth notice already speaks for. Anything else the
 * provider reports (billing, a missing model) has no notice of its own, so its
 * log line stays.
 */
const AUTH_ASSISTANT_ERRORS = new Set(["authentication_failed", "oauth_org_not_allowed"]);


/** Single model usage block */
function ModelUsageBlock({ modelName, usage }: { modelName: string; usage: ModelUsageEntry }) {
  return (
    <div className="space-y-0.5">
      <Text as="div" size="xxs" tone="inherit" className="opacity-70 flex justify-between gap-4">
        <span>{modelName}</span>
        <span>${usage.costUSD.toFixed(4)}</span>
      </Text>
      <div className="flex justify-between gap-4">
        <span className="opacity-60">Input</span>
        <span>{formatNumber(usage.inputTokens)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="opacity-60">Output</span>
        <span>{formatNumber(usage.outputTokens)}</span>
      </div>
      {usage.cacheReadInputTokens > 0 && (
        <div className="flex justify-between gap-4">
          <span className="opacity-60">Cache read</span>
          <span>{formatNumber(usage.cacheReadInputTokens)}</span>
        </div>
      )}
      {usage.cacheCreationInputTokens > 0 && (
        <div className="flex justify-between gap-4">
          <span className="opacity-60">Cache write</span>
          <span>{formatNumber(usage.cacheCreationInputTokens)}</span>
        </div>
      )}
    </div>
  );
}

/** Build rich usage content for the tooltip */
function UsageTooltipContent({ turn }: { turn: RunTurn }) {
  const modelEntries = turn.modelUsage ? Object.entries(turn.modelUsage) : [];
  const hasPerModel = modelEntries.length > 0;

  return (
    <Text as="div" size="xs" tone="inherit" className="space-y-1 min-w-44">

      {hasPerModel ? (
        <>
          {modelEntries.map(([name, usage], idx) => (
            <div key={name}>
              {idx > 0 && <div className="border-t border-current/15 my-1" />}
              <ModelUsageBlock modelName={name} usage={usage} />
            </div>
          ))}
        </>
      ) : (
        <>
          {turn.model && (
            <Text as="div" size="xxs" tone="inherit" className="opacity-70 mb-1">{turn.model}</Text>
          )}
          <div className="border-t border-current/15 pt-1 space-y-0.5">
            {turn.inputTokens != null && (
              <div className="flex justify-between gap-4">
                <span className="opacity-60">Input</span>
                <span>{formatNumber(turn.inputTokens)}</span>
              </div>
            )}
            {turn.outputTokens != null && (
              <div className="flex justify-between gap-4">
                <span className="opacity-60">Output</span>
                <span>{formatNumber(turn.outputTokens)}</span>
              </div>
            )}
            {turn.cacheReadTokens != null && (
              <div className="flex justify-between gap-4">
                <span className="opacity-60">Cache read</span>
                <span>{formatNumber(turn.cacheReadTokens)}</span>
              </div>
            )}
            {turn.cacheWriteTokens != null && (
              <div className="flex justify-between gap-4">
                <span className="opacity-60">Cache write</span>
                <span>{formatNumber(turn.cacheWriteTokens)}</span>
              </div>
            )}
          </div>
        </>
      )}
      {turn.costMicros != null && (
        <Text as="div" size="inherit" tone="inherit" weight="medium" className="border-t border-current/15 pt-1 flex justify-between gap-4">
          <span className="opacity-60">Total</span>
          <span>{formatCostFromMicros(turn.costMicros)}</span>
        </Text>
      )}
    </Text>
  );
}

/** Session time bar with dot separator, copy button, fork button, and usage tooltip */
function SessionTimeBar({
  info,
  onFork,
}: {
  info: SessionInfo;
  onFork?: (responseContent: string) => void;
}) {
  const handleFork = useCallback(() => {
    if (onFork) {
      onFork(info.responseContent);
    }
  }, [onFork, info.responseContent]);

  if (info.elapsed <= 0) return null;

  const turn = info.turn;
  const hasUsage = turn && (turn.inputTokens || turn.outputTokens || turn.cacheReadTokens || turn.cacheWriteTokens || turn.costMicros);

  return (
    <Text as="div" size="s" tone="muted" className="flex items-center gap-2 -mt-1">
      {hasUsage ? (
        <Tooltip
          content={<UsageTooltipContent turn={turn} />}
          position="top-right"
          className="whitespace-normal max-w-none"
        >
          <span className="cursor-default">{formatDurationMs(info.elapsed)}</span>
        </Tooltip>
      ) : (
        <span>{formatDurationMs(info.elapsed)}</span>
      )}
      {info.responseContent && (
        <>
          <span className="size-0.75 rounded-full bg-current opacity-50" />
          <CopyButton
            text={info.responseContent}
            tooltip="Copy response"
            variant="bare"
            className="flex items-center gap-1 hover:text-primary-900 dark:hover:text-primary-100 transition-colors cursor-pointer"
          />
        </>
      )}
      {onFork && (
        <>
          <Button
            tooltip="Fork run from here"
            onClick={handleFork}
            className="flex items-center gap-1 ml-0.5 hover:text-primary-900 dark:hover:text-primary-100 transition-colors cursor-pointer"
          >
            <Fork className="size-3.5" />
          </Button>
        </>
      )}
    </Text>
  );
}

/**
 * Group `displayEvents` and reconcile against the previous result, so unchanged
 * groups keep referential identity across streamed tokens (see
 * `reconcileEventGroups`). The output is fully determined by `displayEvents`, so
 * the render-phase ref here is an idempotent memoization cell — the React-blessed
 * use of refs during render for caching. The lint rule is conservative about ref
 * reads in render, hence the scoped disable.
 */
/* eslint-disable react-hooks/refs */
function useReconciledGroups(displayEvents: RunEvent[]): EventGroup[] {
  const prevGroupsRef = useRef<EventGroup[] | null>(null);
  return useMemo(() => {
    const reconciled = reconcileEventGroups(
      prevGroupsRef.current,
      groupEvents(displayEvents),
    );
    prevGroupsRef.current = reconciled;
    return reconciled;
  }, [displayEvents]);
}
/* eslint-enable react-hooks/refs */

/** `isRunInProgress`: true only when this row is the last render row while the run is active (see map). */
function AgentTurnMessagesAccordion({
  previousSegments,
  planBreakoutIndices,
  messageBreakoutIndices,
  lastSegment,
  previousMessageCount,
  previousToolSummary,
  renderGroup,
  isRunInProgress,
}: {
  previousSegments: number[][];
  planBreakoutIndices: number[];
  messageBreakoutIndices: number[];
  lastSegment: number[];
  previousMessageCount: number;
  previousToolSummary: string;
  renderGroup: (index: number) => ReactNode;
  isRunInProgress: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isRunInProgress) return;
    queueMicrotask(() => setOpen(false));
  }, [isRunInProgress]);

  const expanded = isRunInProgress || open;

  const messageLabel =
    previousMessageCount === 0
      ? ""
      : previousMessageCount === 1
        ? "1 message"
        : `${previousMessageCount} messages`;
  const parts = [messageLabel, previousToolSummary].filter(Boolean);
  const label = parts.length > 0 ? parts.join(" · ") : "tool calls";

  const previousInner = (
    <div className="space-y-4">
      {previousSegments.flatMap((range) =>
        range.map((i) => (
          <Fragment key={`acc-prev-${i}`}>{renderGroup(i)}</Fragment>
        )),
      )}
    </div>
  );

  return (
    <div className={`flex flex-col ${isRunInProgress ? "gap-0" : "gap-4"}`}>
      <div
        className={`grid transition-all duration-300 ease-out ${
          isRunInProgress ? "grid-rows-[0fr] opacity-0 pointer-events-none" : "grid-rows-[1fr] opacity-100"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-b border-primary-200/50 dark:border-primary-800/50 pb-1">
            <Button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="group w-full flex flex-wrap items-center gap-x-1 gap-y-0.5 text-left text-s text-primary-600 dark:text-primary-400 font-sans cursor-pointer hover:text-primary-800 dark:hover:text-primary-200 transition-colors"
            >
              <span className="min-w-0 wrap-break-word">{label}</span>
              <ArrowUp
                className={`size-3.5 shrink-0 opacity-70 transition-transform duration-300 ease-out ${open ? "rotate-180" : "rotate-90"}`}
              />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div
          className={`grid transition-all duration-300 ease-out ${
            expanded
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0 pointer-events-none"
          }`}
        >
          <div className="min-h-0 overflow-hidden">{previousInner}</div>
        </div>
        {messageBreakoutIndices.length > 0 && (
          <div className="space-y-4">
            {messageBreakoutIndices.map((i) => (
              <Fragment key={`acc-msg-${i}`}>{renderGroup(i)}</Fragment>
            ))}
          </div>
        )}
        {planBreakoutIndices.length > 0 && (
          <div className="space-y-4">
            {planBreakoutIndices.map((i) => (
              <Fragment key={`acc-plan-${i}`}>{renderGroup(i)}</Fragment>
            ))}
          </div>
        )}
        <div className="space-y-4">
          {lastSegment.map((i) => (
            <Fragment key={`acc-last-${i}`}>{renderGroup(i)}</Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

interface WorkspaceEventsProps {
  runs: Run[];
  activeTab: "editor" | string;
  currentEvents: RunEvent[];
  currentWorkspace: Workspace | null;
  eventsEndRef: RefObject<HTMLDivElement>;
  issueTabs: IssueWithEntity[];
  signalTabs?: SignalWithEntity[];
  turns?: RunTurn[];
  variant?: "copilot" | "claude" | "codex" | "cursor";
  onForkRun?: (sourceRunId: string, message: string) => Promise<string | null>;
  onSuggestionSelect?: (suggestion: string) => void;
  onApplyPlan?: () => void;
  onDismissPlan?: () => void;
  hasPendingPlanApproval?: boolean;
}

export function WorkspaceEvents({
  runs,
  activeTab,
  currentEvents,
  currentWorkspace,
  eventsEndRef,
  issueTabs,
  signalTabs = [],
  turns = EMPTY_TURNS,
  variant = "copilot",
  onForkRun,
  onSuggestionSelect,
  onApplyPlan,
  onDismissPlan,
  hasPendingPlanApproval = false,
}: WorkspaceEventsProps) {
  const isEditorActive = activeTab === "editor";
  const isIssueActive = isIssueTab(activeTab);
  const isSignalActive = isSignalTab(activeTab);
  const isNoteActive = isNoteTab(activeTab);
  const isNewRunActive = isNewRunTab(activeTab);
  const activeIssue = isIssueActive
    ? issueTabs.find((t) => t.issue.entityId === getIssueEntityId(activeTab))
    : null;
  const activeSignal = isSignalActive
    ? signalTabs.find((t) => t.signal.entityId === getSignalEntityId(activeTab))
    : null;
  const activeNoteId = isNoteActive ? getNoteId(activeTab) : null;
  const isRunTabActive =
    !isEditorActive && !isIssueActive && !isSignalActive && !isNoteActive && !isNewRunActive;
  const hasRunContent = isRunTabActive && currentEvents.length > 0;

  // Check if current run is still running
  const activeRun = runs.find((r) => r.id === activeTab);

  // Being signed out entirely is already reported above the composer, with a
  // recheck the run-anchored notice does not offer. The notice below is for the
  // case that probe cannot see: a run that died on a refresh-token failure while
  // the account still reads as signed in. Same query as the composer's, so RTK
  // Query serves it from cache rather than probing twice.
  const { data: providerAccountInfo } = useGetProviderAccountInfoQuery(
    getProviderVariant(variant).providerId,
    { refetchOnFocus: false },
  );
  const providerSignedOut =
    !!providerAccountInfo && providerAccountInfo.account === null;
  const activeRunFailedOnAuth =
    activeRun?.status === "failed" &&
    classifyRunErrorKind(activeRun.lastError) === "auth";
  const isRunning =
    activeRun?.status === "running" || activeRun?.status === "queued";
  const isRunCompleted =
    activeRun?.status === "succeeded" ||
    activeRun?.status === "failed" ||
    activeRun?.status === "canceled";

  // Read showToolCalls setting
  const { data: appSettings } = useGetAppSettingsQuery();
  const showToolCalls = appSettings?.showToolCalls !== false;

  // Drop document-render preview images (e.g. the per-page PNGs emitted while
  // generating a .docx/.pptx) so a document run doesn't spam image cards. Only
  // applies when the run actually produced a document — pure image runs are
  // untouched.
  const displayEvents = useMemo(() => {
    const docPaths = currentEvents
      .filter((e) => e.type === "artifact" && e.metadata?.kind === "document")
      .map((e) => (e.metadata?.path as string | undefined) ?? "")
      .filter(Boolean);
    const filtered =
      docPaths.length === 0
        ? currentEvents
        : currentEvents.filter((e) => {
            if (e.type === "artifact" && e.metadata?.kind === "image") {
              const imgPath = (e.metadata?.path as string | undefined) ?? "";
              if (isDocumentRenderImage(imgPath, docPaths)) return false;
            }
            return true;
          });
    // An auth failure that took the whole run down already gets a notice with a
    // Sign in button — either here or above the composer. The driver's log line
    // is the signal for the case that notice never covers: an auth failure the
    // run recovered from, which leaves the status untouched.
    const deduped = activeRunFailedOnAuth
      ? filtered.filter(
          (e) =>
            !(
              e.type === "log" &&
              e.metadata?.source === "assistant_error" &&
              AUTH_ASSISTANT_ERRORS.has(e.metadata?.error as string)
            ),
        )
      : filtered;
    // Stop finished tools from spinning until the run-end sweep resolves their
    // status (providers don't all emit per-tool completions). Runs on the
    // display-ordered list so "later event" matches what the user actually sees.
    return demoteStaleRunningTools(deduped);
  }, [currentEvents, activeRunFailedOnAuth]);

  // Group events for CLI-style display, reconciled so unchanged groups keep
  // their object identity across streamed tokens — that's what lets the memoized
  // InfoGroup / ToolCallGroup rows skip re-rendering while only the live
  // (changing) group updates.
  const allEventGroups = useReconciledGroups(displayEvents);

  // Filter out tool_calls groups when setting is off — except plan groups, which stay visible
  // so Apply / Dismiss remain accessible regardless of the toggle.
  const eventGroups = useMemo(
    () => showToolCalls
      ? allEventGroups
      : allEventGroups.filter((g) => g.type !== "tool_calls" || isPlanToolCallGroup(g)),
    [allEventGroups, showToolCalls],
  );

  // Session times: index-based map of "show session bar after this group index"
  const sessionTimes = useMemo(
    () => matchTurnsToGroups(eventGroups, turns, activeRun?.startedAt, isRunCompleted),
    [eventGroups, turns, activeRun?.startedAt, isRunCompleted],
  );

  // Last session time index — fork button only shown on the last one
  const lastSessionIndex = useMemo(() => {
    let last = -1;
    for (const idx of sessionTimes.keys()) {
      if (idx > last) last = idx;
    }
    return last;
  }, [sessionTimes]);

  // Last prompt_suggestion group index — only show if nothing comes after it
  // (i.e. no user-prompt or other content after the suggestion)
  const lastSuggestionIndex = useMemo(() => {
    let last = -1;
    for (let i = 0; i < eventGroups.length; i++) {
      if (eventGroups[i].type === "prompt_suggestion") last = i;
    }
    // If there's any non-suggestion group after the last suggestion,
    // it means the user already acted — hide the suggestion
    if (last !== -1) {
      for (let i = last + 1; i < eventGroups.length; i++) {
        if (eventGroups[i].type !== "prompt_suggestion") return -1;
      }
    }
    return last;
  }, [eventGroups]);

  const handleFork = useCallback(
    (_responseContent: string) => {
      if (!activeRun || !onForkRun) return;
      onForkRun(activeRun.id, "Continue from where this session left off.");
    },
    [activeRun, onForkRun],
  );

  // Work calls a written file the deliverable, so its Write row has to stay
  // reachable: the agent names the file in prose but only that row opens it.
  const { keepFileWritesVisible } = useModeConfig();
  const isDeliverableGroup = useMemo(
    () =>
      keepFileWritesVisible
        ? (group: EventGroup) =>
            group.events.some(
              (e) =>
                e.type === "tool_call" &&
                typeof e.metadata?.toolName === "string" &&
                FILE_WRITING_TOOLS.has(
                  resolveTool(e.metadata.toolName).displayName,
                ),
            )
        : undefined,
    [keepFileWritesVisible],
  );
  const turnRenderRows = useMemo(
    () => buildTurnRenderRows(eventGroups, { isDeliverableGroup }),
    [eventGroups, isDeliverableGroup],
  );

  // Left-edge navigator: one tick per user message. Built from the same groups
  // the transcript renders, so it can address a turn by group index.
  const turnMarkers = useMemo(() => buildTurnMarkers(eventGroups), [eventGroups]);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const scrollToTurn = useCallback((marker: TurnMarker) => {
    transcriptRef.current
      ?.querySelector(`[data-group-index="${marker.index}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  /** User messages grouped as `info` + user-prompt — must stay in sync with `turns` length when events are up to date. */
  const userPromptGroupCount = useMemo(
    () => eventGroups.reduce((n, g) => n + (isUserPromptGroup(g) ? 1 : 0), 0),
    [eventGroups],
  );

  /**
   * After `continueRun`, main creates a new active turn before user-prompt artifacts appear in the
   * event list. In that gap, the last render row can still be the *previous* turn's accordion; without
   * this guard, `isRunInProgress` would force it open.
   */
  const suppressLiveAccordionForStaleEvents = useMemo(() => {
    if (!isRunning || turns.length === 0) return false;
    return turns.length > userPromptGroupCount;
  }, [isRunning, turns.length, userPromptGroupCount]);

  const renderGroupAt = useCallback(
    (index: number) => {
      const group = eventGroups[index];
      if (!group) return null;
      const isLastSuggestion =
        group.type === "prompt_suggestion" &&
        onSuggestionSelect &&
        isRunCompleted &&
        index === lastSuggestionIndex;
      const sessionBarForThis = sessionTimes.has(index)
        ? sessionTimes.get(index)!
        : null;
      const planToolName =
        group.type === "tool_calls" && group.events.length === 1
          ? toolEventPlanName(group.events[0])
          : null;

      return (
        <Fragment key={group.id}>
          {group.type === "prompt_suggestion" ? (
            <>
              {sessionBarForThis && (
                <SessionTimeBar
                  info={sessionBarForThis}
                  onFork={index === lastSessionIndex && isRunCompleted && onForkRun ? handleFork : undefined}
                />
              )}
              {isLastSuggestion ? (
                <PromptSuggestionChips
                  suggestions={group.events.map((e) => e.content).filter(Boolean)}
                  onSelect={onSuggestionSelect}
                />
              ) : null}
            </>
          ) : group.type === "tool_calls" ? (
            planToolName === "plan" ||
            planToolName === "create plan" ||
            planToolName === "exitplanmode" ? (
              <PlanDisplay
                event={group.events[0]}
                interactionMode={
                  variant === "claude" && planToolName === "exitplanmode"
                    ? "live-approval"
                    : "follow-up"
                }
                hasPendingApproval={hasPendingPlanApproval}
                isRunActive={isRunning}
                onApplyPlan={onApplyPlan}
                onDismissPlan={onDismissPlan}
              />
            ) : (
              <ToolCallGroup
                group={group}
                defaultExpanded={index === eventGroups.length - 1}
                variant={variant}
              />
            )
          ) : (
            <InfoGroup group={group} workspaceRootPath={currentWorkspace?.rootPath} />
          )}
          {group.type !== "prompt_suggestion" && sessionBarForThis && (
            <SessionTimeBar
              info={sessionBarForThis}
              onFork={index === lastSessionIndex && isRunCompleted && onForkRun ? handleFork : undefined}
            />
          )}
        </Fragment>
      );
    },
    [
      eventGroups,
      onSuggestionSelect,
      isRunCompleted,
      lastSuggestionIndex,
      sessionTimes,
      lastSessionIndex,
      onForkRun,
      handleFork,
      variant,
      onApplyPlan,
      onDismissPlan,
      hasPendingPlanApproval,
      isRunning,
      currentWorkspace?.rootPath,
    ],
  );

  // Latest thinking: ephemeral Cursor stream (cursor-think-*) or legacy persisted [thinking] logs
  const latestThinking = useMemo(() => {
    const reversed = [...currentEvents].reverse();
    const streamed = reversed.find(
      (e) => e.type === "artifact" && e.metadata?.kind === "thinking" && e.content.trim(),
    );
    if (streamed) return streamed.content;
    const last = reversed.find(
      (e) => e.type === "log" && e.content.startsWith("[thinking] "),
    );
    return last ? last.content.slice("[thinking] ".length) : undefined;
  }, [currentEvents]);

  const hasActiveImageGeneration = useMemo(
    () =>
      currentEvents.some(
        (event) =>
          event.type === "artifact" &&
          event.metadata?.kind === "image_generation",
      ),
    [currentEvents],
  );

  // Run content stays mounted whenever there are events for the active run,
  // just hidden when a non-run tab is active. Preserves accordion open state,
  // scroll position, and other local UI state across tab switches.
  const showEmpty = isRunTabActive && currentEvents.length === 0;

  return (
    <Text as="div" size="sm" tone="inherit" className="h-full flex flex-col">
      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {isNewRunActive && (
          <div className="h-full min-h-0 shrink-0" aria-hidden />
        )}
        {isEditorActive && <EditorContent className="h-full" />}
        {isIssueActive && activeIssue && <IssueTabContent issue={activeIssue} />}
        {isSignalActive && activeSignal && <SignalTabContent signal={activeSignal} />}
        {isNoteActive && activeNoteId && <NoteTabContent reviewId={activeNoteId} />}
        {currentEvents.length > 0 && (
          <div
            ref={transcriptRef}
            className={`h-full overflow-y-auto noscrollbar ${isRunTabActive ? "" : "hidden"}`}
          >
            {/* The gutter sits *outside* the width cap, so the column measures
                the same 840px here as the composer does below it — padding
                inside the cap would eat into the transcript alone and leave it
                visibly narrower than the box it feeds. */}
            <div className={CONTENT_COLUMN_GUTTER}>
            <div className="min-h-75 max-w-210 mx-auto space-y-4 pt-12 pb-24">
              {turnRenderRows.map((row, rowIndex) => {
                const isLastRow = rowIndex === turnRenderRows.length - 1;
                let rowKey: string;
                let content: ReactNode;
                if (row.kind === "flat") {
                  const first = row.indices[0];
                  const lastIdx = row.indices[row.indices.length - 1];
                  rowKey = `row-flat-${first}-${lastIdx}`;
                  content = row.indices.map((index) => renderGroupAt(index));
                } else {
                  const isLiveTurnAccordion =
                    isRunning && !suppressLiveAccordionForStaleEvents && isLastRow;
                  rowKey = `row-acc-${row.previousSegments[0]?.[0] ?? 0}-${row.planBreakoutIndices.join("-") || "x"}-${row.lastSegment[0] ?? 0}`;
                  content = (
                    <AgentTurnMessagesAccordion
                      previousSegments={row.previousSegments}
                      planBreakoutIndices={row.planBreakoutIndices}
                      messageBreakoutIndices={row.messageBreakoutIndices}
                      lastSegment={row.lastSegment}
                      previousMessageCount={row.previousMessageCount}
                      previousToolSummary={row.previousToolSummary}
                      renderGroup={renderGroupAt}
                      isRunInProgress={isLiveTurnAccordion}
                    />
                  );
                }
                // Historical rows carried `content-visibility: auto` to skip their
                // layout and paint while off-screen. Measured against a real
                // 17-turn transcript (~12k nodes, 33 rows) it did the opposite of
                // its job: a fast fling produced two blank frames every time —
                // the black gaps users reported — and cost ~25% more per frame
                // (10.3ms avg / 20ms worst, against 7.8ms / 12ms without it).
                // Raising `contain-intrinsic-size` changed nothing, because the
                // cost is laying each row out as it enters, not the size guess.
                // At this scale the containment bookkeeping outweighs the work it
                // skips. See docs/design/transcript-performance.md — the answer
                // for genuinely long transcripts is windowing, not containment,
                // which cannot produce a blank frame in the first place.
                return (
                  <div
                    key={rowKey}
                    // Scroll target for the turn rail. Every user prompt is its
                    // own flat row, so the first index identifies the row.
                    data-group-index={row.kind === "flat" ? row.indices[0] : undefined}
                    className="space-y-4"
                  >
                    {content}
                  </div>
                );
              })}
              {activeRunFailedOnAuth && !providerSignedOut && (
                <ProviderAuthNotice
                  variant={variant}
                  title="Authentication expired"
                  message={activeRun?.lastError}
                />
              )}
              {isRunning && !hasActiveImageGeneration && (
                <AsciiLoader thinkingText={latestThinking} />
              )}
              <div ref={eventsEndRef} />
            </div>
            </div>
          </div>
        )}
        {hasRunContent && (
          <TurnRail markers={turnMarkers} onSelect={scrollToTurn} />
        )}
        {showEmpty && <WorkspaceEmptyState workspace={currentWorkspace} />}
        {/* Top/bottom fade overlays — only shown on run content (chat), not on editor/issue/note tabs.
            `hasRunContent` already excludes editor/issue/signal/note/new-run tabs, so no extra guards needed. */}
        {hasRunContent && (
          <>
            <div className="absolute top-0 left-0 right-0 h-6 bg-linear-to-b from-primary to-transparent dark:from-primary-950 dark:to-transparent pointer-events-none z-(--z-base)" />
            <div className="absolute bottom-0 left-0 right-0 h-6 bg-linear-to-t from-primary to-transparent dark:from-primary-950 dark:to-transparent pointer-events-none" />
          </>
        )}
      </div>
    </Text>
  );
}
