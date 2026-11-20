import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { normalizeAssistantAvatar, type Assistant, type AssistantWelcome, type AssistantMessageContext, type AssistantExecution, type SendAssistantMessage } from "@mains/contracts/assistants";
import { CHANNELS } from "@mains/contracts/channels";
import type { RunStatus } from "@mains/contracts/runs";
import { useSendAssistantMessageMutation, useRespondAssistantWelcomeMutation, usePrepareAssistantWelcomeMutation } from "@/lib/redux/api/assistantsApi";
import { useGetRunByIdQuery, useAbortRunMutation, useGetWorkspaceQuery } from "@/lib/redux/api";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setComposerContextKey, setContextItemsForKey, setDraftText } from "@/lib/redux/slices/workspaceSlice";
import { useRunHistory } from "@/features/workspace/hooks/use-run-history";
import { useStreamingEvents } from "@/features/workspace/hooks/use-streaming-events";
import { useToolApproval } from "@/features/workspace/hooks/use-tool-approval";
import { useComposerContext } from "@/features/workspace/hooks/use-composer-context";
import { PluginLogoProvider } from "@/features/workspace/hooks/use-plugin-logos";
import { WorkspaceEvents } from "@/features/workspace/components/workspace-events";
import { AssistantProfileSetupCard } from "./assistant-profile-setup";
import { AssistantWelcomeCard } from "./assistant-welcome-card";
import { WorkspaceInput } from "@/features/workspace/components/workspace-input";
import { AsyncQuestionDialogProvider, ComposerSlot, useAsyncQuestionDialog } from "@/features/workspace/components/tools/async-question-dialog";
import { isAssistantReplyStreaming } from "@/features/workspace/lib/assistant-transcript-view";
import { buildRunContextPayload } from "@/features/workspace/lib/run-context-payload";
import { withoutSubmittedContext } from "@/features/workspace/lib/composer-context";
import { serializeAttachments } from "@/features/workspace/lib/run-helpers";
import { setRightPaneContextKey } from "@/lib/redux/slices/appSettingsSlice";
import { useTransientUploads } from "@/features/workspace/hooks/use-transient-uploads";
import { mergeTranscriptStreams } from "@/features/workspace/lib/merge-transcript-streams";
import { omitCompletedCodexPreviews } from "@/features/workspace/lib/run-event-mappers";
import { createRunCache } from "@/features/workspace/lib/run-cache";
import { CONTENT_COLUMN_GUTTER } from "@/features/workspace/lib/content-column";
import type { RunEvent, Run as WorkspaceRun } from "@/features/workspace/types";
import { Button } from "@/components/ui";
import { getTransport, onTransportChange } from "@/lib/transport";
import { runOwnerKey } from "../../../../shared/ui-state-keys";
import { AssistantMonogram } from "./assistant-monogram";
import { AVATAR_COLORS } from "./assistant-avatar";
import { errorText } from "../lib/assistant-ui";
import { conversationAvatarState, type AssistantAvatarState } from "../lib/assistant-avatar-activity";
import { useMcpAppPanel } from "@/hooks/use-mcp-app-panel";
import type { McpAppScope } from "@/features/workspace/lib/mcp-app-panel";
import type { McpAppMessageOptions } from "@/features/workspace/lib/mcp-app-context";

const keepProfile = () => {};
const EMPTY_EVENTS: RunEvent[] = [];

export function AssistantChat({ assistant, welcome, animateWelcome, selectedRunId, onSelectRun, onOpenDetails, onAvatarState }: {
  assistant: Assistant;
  welcome?: AssistantWelcome;
  animateWelcome?: boolean;
  selectedRunId: string | null;
  onSelectRun(id: string | null): void;
  onOpenDetails(): void;
  onAvatarState?(state: AssistantAvatarState | undefined): void;
}) {
  // The route adds the welcome run ID after this chat mounts.
  const [animateIntro] = useState(animateWelcome);
  const welcomeColumnRef = useRef<HTMLDivElement>(null);
  const archived = assistant.isArchived;
  const waitingWelcome = !archived && welcome && welcome.state !== "started" ? welcome : undefined;
  const chatRunId = waitingWelcome ? null : selectedRunId;
  const backendId = useAppSelector(state => state.backends.activeBackendId);
  const ownerKey = selectedRunId ? runOwnerKey(backendId, selectedRunId) : `${backendId ?? "local"}:assistant:${assistant.id}:draft`;
  const dispatch = useAppDispatch();
  useLayoutEffect(() => { dispatch(setComposerContextKey(ownerKey)); dispatch(setRightPaneContextKey({ ownerKey, browserExpansionKey: ownerKey })); }, [dispatch, ownerKey]);
  const message = useAppSelector(state => state.workspace.draftTextByKey[ownerKey] ?? "");
  const setMessage = useCallback((text: string) => dispatch(setDraftText({ key: ownerKey, text })), [dispatch, ownerKey]);
  const context = useComposerContext();
  const transport = useSyncExternalStore(onTransportChange, getTransport);
  const { currentData: run, refetch: refreshRun, error: runError } = useGetRunByIdQuery(chatRunId ?? "", { skip: !chatRunId });
  const { currentData: workspace } = useGetWorkspaceQuery(run?.workspaceId ?? "", { skip: !run?.workspaceId });
  const belongs = !chatRunId || run?.assistantId === assistant.id;
  const [cache] = useState(createRunCache);
  const { runEvents, runTurns, load, history } = useRunHistory(cache, belongs ? chatRunId : null);
  const persistedEvents = chatRunId ? runEvents[chatRunId] ?? EMPTY_EVENTS : EMPTY_EVENTS;
  const turns = chatRunId ? runTurns[chatRunId] ?? [] : [];
  const persistedIds = useMemo(() => new Set(persistedEvents.flatMap(event => typeof event.metadata?.streamId === "string" ? [event.metadata.streamId] : [])), [persistedEvents]);
  const { streamingEvents, clearTurnStreams } = useStreamingEvents(belongs ? chatRunId : null, persistedIds);
  const events = useMemo(() => mergeTranscriptStreams(
    chatRunId ? omitCompletedCodexPreviews(persistedEvents, chatRunId) : persistedEvents,
    streamingEvents, history.historical,
  ), [chatRunId, persistedEvents, streamingEvents, history.historical]);
  const [files, setFiles] = useTransientUploads(ownerKey);
  const [failure, setFailure] = useState("");
  const [pending, setPending] = useState<SendAssistantMessage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const sendingRef = useRef(false);
  const [send, sending] = useSendAssistantMessageMutation();
  const [abort] = useAbortRunMutation();
  const [respondWelcome, welcomeResponse] = useRespondAssistantWelcomeMutation();
  const [prepareWelcome, welcomePreparation] = usePrepareAssistantWelcomeMutation();
  // New standalone work always starts in Work. Already accepted welcomes keep their delivery target.
  const execution = useMemo<AssistantExecution>(() => waitingWelcome?.answer != null
    ? waitingWelcome.execution ?? { mode: "work" } : { mode: "work" }, [waitingWelcome]);
  const answerWelcome = async (answer: string | null) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setFailure("");
    try {
      const result = await respondWelcome({ accountId: assistant.accountId, id: assistant.id, answer, execution }).unwrap();
      if (bound.current && getTransport() === transport && answer !== null) onSelectRun(result.runId);
    } catch (error) { if (bound.current) setFailure(errorText(error)); }
    finally { sendingRef.current = false; }
  };
  const retryWelcome = async () => {
    setFailure("");
    try { await prepareWelcome({ accountId: assistant.accountId, id: assistant.id }).unwrap(); }
    catch (error) { if (bound.current) setFailure(errorText(error)); }
  };
  const { pendingApprovals, respond } = useToolApproval(run && belongs && !archived ? [run] : []);
  const approval = pendingApprovals.find(item => item.runId === chatRunId);
  const bound = useRef(true);
  const eventsEndRef = useRef<HTMLDivElement>(null!);
  useEffect(() => { bound.current = true; return () => { bound.current = false; }; }, []);
  useEffect(() => { if (belongs && chatRunId) void load(chatRunId, "latest"); }, [belongs, chatRunId, load]);
  useEffect(() => { if (run && run.status !== "running" && run.status !== "queued") clearTurnStreams(run.status !== "succeeded"); }, [run, clearTurnStreams]);
  useEffect(() => {
    if (!chatRunId || !belongs) return;
    let attached = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = undefined; if (attached) { void refreshRun(); void load(chatRunId); } }, 150);
    };
    const update = (payload: unknown) => { if ((payload as { runId?: string })?.runId === chatRunId) refresh(); };
    const off = [CHANNELS.runs.statusChanged, CHANNELS.runs.eventPersisted, CHANNELS.runs.updated].map(channel => transport.subscribe(channel, update));
    const reconnect = transport.onStatusChange(status => { if (status === "connected") refresh(); });
    window.addEventListener("focus", refresh);
    return () => { attached = false; clearTimeout(timer); off.forEach(stop => stop()); reconnect(); window.removeEventListener("focus", refresh); };
  }, [chatRunId, belongs, transport, refreshRun, load]);
  const visibleRun = useMemo<WorkspaceRun | undefined>(() => run && belongs ? {
    ...run, goal: run.goal ?? "", title: run.title ?? undefined, lastError: run.lastError ?? undefined,
    startedAt: run.startedAt == null ? undefined : new Date(run.startedAt), endedAt: run.endedAt == null ? undefined : new Date(run.endedAt), createdAt: new Date(run.createdAt),
  } : undefined, [run, belongs]);
  const working = run?.status === "running" || run?.status === "queued";
  const streamingReply = useMemo(() => working && !history.historical && isAssistantReplyStreaming(events), [events, history.historical, working]);
  const appPanel = useMcpAppPanel();
  const registerAppConversation = appPanel?.registerConversation;
  const attachAppRun = appPanel?.attachRun;
  const appContext = appPanel?.appContext;
  const appScope = useMemo<McpAppScope>(() => ({
    backendId, assistantId: assistant.id, spaceId: run?.spaceId ?? assistant.spaceId,
    providerId: run?.providerId ?? assistant.providerId, mode: run?.mode ?? execution.mode,
    workspaceId: run?.workspaceId ?? (execution.mode === "developer" ? execution.workspaceId : undefined),
    collectionId: run?.collectionId ?? null,
  }), [backendId, assistant.id, assistant.spaceId, assistant.providerId, run?.spaceId, run?.providerId, run?.mode, run?.workspaceId, run?.collectionId, execution]);
  const submit = useCallback(async (appMessage?: string, options?: McpAppMessageOptions): Promise<string | null> => {
    const content = appMessage ?? message;
    if (archived || appMessage !== undefined && pending) return null;
    if (sendingRef.current || working && !pending || !belongs || !content.trim() && !files.length && !context.items.length && !pending) return null;
    sendingRef.current = true;
    setPreparing(true);
    setFailure("");
    const submitted = [...context.items];
    try {
      const newChat = options?.target === "new";
      const request = pending ?? { accountId: assistant.accountId, assistantId: assistant.id, message: content.trim() || "Use the attached context.", requestId: waitingWelcome && !newChat ? `welcome-${assistant.id}` : crypto.randomUUID(), ...(selectedRunId && !newChat ? { runId: selectedRunId } : {}), ...(!chatRunId || newChat ? { execution } : {}), context: buildRunContextPayload([...submitted, ...(appContext?.(ownerKey) ?? [])], files.length ? await serializeAttachments(files) : undefined) as AssistantMessageContext };
      if (!bound.current || getTransport() !== transport) return null;
      setPending(request);
      const result = await send(request).unwrap();
      if (!bound.current || getTransport() !== transport) return null;
      setPending(null);
      setMessage("");
      setFiles([]);
      dispatch(setContextItemsForKey({ key: ownerKey, items: withoutSubmittedContext(context.items, submitted) }));
      if (chatRunId) { void refreshRun(); void load(chatRunId, "latest"); }
      const scope = request.execution ? { ...appScope, mode: request.execution.mode,
        workspaceId: request.execution.mode === "developer" ? request.execution.workspaceId : undefined, collectionId: null } : appScope;
      attachAppRun?.(ownerKey, result.runId, scope);
      onSelectRun(result.runId);
      return result.runId;
    } catch (error) { if (bound.current) setFailure(errorText(error)); return null; }
    finally { sendingRef.current = false; if (bound.current) setPreparing(false); }
  }, [message, pending, working, belongs, archived, files, context.items, assistant.accountId, assistant.id, waitingWelcome, selectedRunId, chatRunId, execution, appContext, ownerKey, transport, send, dispatch, setMessage, setFiles, refreshRun, load, appScope, attachAppRun, onSelectRun]);
  useLayoutEffect(() => {
    if (archived || !belongs || waitingWelcome || chatRunId && !run) return;
    return registerAppConversation?.({ scope: appScope, ownerKey, runId: chatRunId ?? undefined, send: submit });
  }, [registerAppConversation, archived, belongs, waitingWelcome, chatRunId, run, appScope, ownerKey, submit]);
  const stop = useCallback(() => { if (chatRunId) void abort(chatRunId).unwrap().catch(error => { if (bound.current) setFailure(errorText(error)); }); }, [chatRunId, abort]);
  const variant = assistant.providerId === "codex" ? "codex" : "claude";
  const mateColor = AVATAR_COLORS[normalizeAssistantAvatar(assistant.avatar).color].fill;
  const composer = <WorkspaceInput assistantComposer goal={pending?.message ?? message} onGoalChange={setMessage} onSubmit={() => void submit()} onStop={stop}
    isLoading={preparing || sending.isLoading} disabled={!!pending || !belongs} sendDisabled={!!pending} activeRun={visibleRun}
    canResume={!!chatRunId} providerId={assistant.providerId} mode={run?.mode ?? "work"} selectedModel={assistant.model}
    onModelChange={keepProfile} settingsConfig={assistant.conversationSettings.config} onSettingsConfigChange={keepProfile}
    allowVoice={false} showGoalButton={false}
    workspacePath={chatRunId ? workspace?.rootPath : undefined} uploadedFiles={files} onUploadedFilesChange={setFiles}
    placeholder={`Message ${assistant.name}…`} inputLabel={`Message ${assistant.name}`} isNewRunTabActive={!chatRunId}
    layout={chatRunId || waitingWelcome ? "default" : "centered"} />;
  return <PluginLogoProvider providerId={assistant.providerId}>
    <AsyncQuestionDialogProvider ownerKey={ownerKey} runId={chatRunId} runStatus={run?.status} turns={turns} events={events} historical={history.historical || archived}>
      {onAvatarState && <ReportAvatarState onChange={onAvatarState} status={belongs ? run?.status : undefined}
        hasApproval={!!approval} historical={history.historical} streamingReply={streamingReply}
        fallback={waitingWelcome ? welcomeAvatarState(waitingWelcome) : chatRunId ? undefined : "idle"} />}
      <div className="relative flex min-h-0 flex-1 flex-col" style={{ "--mate-color": mateColor } as CSSProperties}>
        {waitingWelcome ? <div className={`flex min-h-0 flex-1 flex-col justify-end gap-6 overflow-y-auto py-8 ${CONTENT_COLUMN_GUTTER}`}>
          <div ref={welcomeColumnRef} className="mx-auto w-full max-w-210">
            <AssistantMonogram name={assistant.name} providerId={assistant.providerId} avatar={assistant.avatar} working={working} size="xl" welcome onClick={onOpenDetails} />
            {waitingWelcome.question?.profileSetup && waitingWelcome.state !== "starting"
              ? <AssistantProfileSetupCard accountId={assistant.accountId} welcome={waitingWelcome}
                  animateIntro={animateIntro} columnRef={welcomeColumnRef} busy={welcomePreparation.isLoading} onRetry={retryWelcome} />
              : <AssistantWelcomeCard welcome={waitingWelcome} busy={welcomeResponse.isLoading || welcomePreparation.isLoading}
                  onAnswer={answerWelcome} onRetry={retryWelcome} />}
          </div>
          {waitingWelcome.state === "skipped" && <div className="w-full">{composer}</div>}
        </div> : !chatRunId ? <div className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto py-10 ${CONTENT_COLUMN_GUTTER}`}>
          <div className="text-center"><AssistantMonogram name={assistant.name} providerId={assistant.providerId} avatar={assistant.avatar} working={working} size="lg" onClick={onOpenDetails} /><h1 className="text-2xl font-medium">{assistant.name}</h1><p className="mx-auto mt-2 max-w-md text-sm text-primary-500">{assistant.description || "How can I help?"}</p></div>
          <div className="w-full">{composer}</div>
        </div> : <>
          <div className="min-h-0 flex-1 overflow-hidden">
            {belongs ? <WorkspaceEvents appearance="assistant" assistant={assistant} hideTurnChanges hasPendingUserInput={!!approval} mode={run?.mode ?? "work"} runs={visibleRun ? [visibleRun] : []} activeTab={chatRunId} currentEvents={events} currentWorkspace={workspace ?? null} eventsEndRef={eventsEndRef} history={history} issueTabs={[]} turns={turns} variant={variant} onSuggestionSelect={archived ? undefined : setMessage} /> : <p role={runError ? "alert" : "status"} className="p-6 text-sm text-primary-500">{runError ? errorText(runError) : run ? "This conversation belongs to another mate." : "Loading conversation…"}</p>}
          </div>
          {!archived && <div className={CONTENT_COLUMN_GUTTER}>
            <ComposerSlot request={approval} onRespond={respond} variant={variant}>{composer}</ComposerSlot>
          </div>}
        </>}
        {failure && <div role="alert" className="mx-auto flex max-w-210 items-center gap-3 px-6 pb-3 text-xs text-danger"><span>{failure}</span>{pending && <Button variant="ghost" className="shrink-0" disabled={preparing} onClick={() => void submit()}>Check delivery</Button>}</div>}
      </div>
    </AsyncQuestionDialogProvider>
  </PluginLogoProvider>;
}

function welcomeAvatarState(welcome: AssistantWelcome): AssistantAvatarState {
  if (welcome.state === "starting") return "queued";
  if (welcome.state === "generating") return "thinking";
  if (welcome.state === "ready" && welcome.question && !welcome.question.profileSetup?.saved) return "waiting";
  return "idle";
}

function ReportAvatarState({ status, fallback, hasApproval, historical, streamingReply, onChange }: {
  status?: RunStatus;
  fallback?: AssistantAvatarState;
  hasApproval: boolean;
  historical: boolean;
  streamingReply: boolean;
  onChange(state: AssistantAvatarState | undefined): void;
}) {
  const questions = useAsyncQuestionDialog();
  const active = status === "queued" || status === "running";
  const needsAnswer = !historical && (!!questions?.dialog || (!active && !!questions?.pending && !questions.pending.checking));
  const observedRun = useRef(false);
  useEffect(() => () => onChange(undefined), [onChange]);
  useEffect(() => {
    if (active) observedRun.current = true;
    onChange(status ? conversationAvatarState({
      status, awaitingInput: hasApproval || needsAnswer, streamingReply, observedRun: observedRun.current,
    }) : fallback);
  }, [status, fallback, active, hasApproval, needsAnswer, streamingReply, onChange]);
  return null;
}
