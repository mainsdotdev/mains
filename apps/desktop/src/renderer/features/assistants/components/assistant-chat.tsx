import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Assistant, AssistantWelcome, AssistantMessageContext, AssistantExecution, SendAssistantMessage } from "@mains/contracts/assistants";
import { CHANNELS } from "@mains/contracts/channels";
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
import { AssistantWelcomeCard } from "./assistant-welcome-card";
import { WorkspaceInput } from "@/features/workspace/components/workspace-input";
import { AsyncQuestionDialogProvider, ComposerSlot } from "@/features/workspace/components/tools/async-question-dialog";
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
import { errorText } from "../lib/assistant-ui";

const keepProfile = () => {};
const EMPTY_EVENTS: RunEvent[] = [];

export function AssistantChat({ assistant, welcome, selectedRunId, onSelectRun, onOpenDetails }: {
  assistant: Assistant;
  welcome?: AssistantWelcome;
  selectedRunId: string | null;
  onSelectRun(id: string | null): void;
  onOpenDetails(): void;
}) {
  const waitingWelcome = welcome && welcome.state !== "started" ? welcome : undefined;
  const chatRunId = waitingWelcome ? null : selectedRunId;
  const backendId = useAppSelector(state => state.backends.activeBackendId);
  const ownerKey = selectedRunId ? runOwnerKey(backendId, selectedRunId) : `${backendId ?? "local"}:assistant:${assistant.id}:draft`;
  const dispatch = useAppDispatch();
  useLayoutEffect(() => { dispatch(setComposerContextKey(ownerKey)); dispatch(setRightPaneContextKey({ ownerKey, browserExpansionKey: ownerKey })); }, [dispatch, ownerKey]);
  const message = useAppSelector(state => state.workspace.draftTextByKey[ownerKey] ?? "");
  const setMessage = (text: string) => dispatch(setDraftText({ key: ownerKey, text }));
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
  const execution: AssistantExecution = waitingWelcome?.answer != null ? waitingWelcome.execution ?? { mode: "work" } : { mode: "work" };
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
  const { pendingApprovals, respond } = useToolApproval(run && belongs ? [run] : []);
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
  async function submit() {
    if (sendingRef.current || working && !pending || !belongs || !message.trim() && !files.length && !context.items.length && !pending) return;
    sendingRef.current = true;
    setPreparing(true);
    setFailure("");
    const submitted = [...context.items];
    try {
      const request = pending ?? { accountId: assistant.accountId, assistantId: assistant.id, message: message.trim() || "Use the attached context.", requestId: waitingWelcome ? `welcome-${assistant.id}` : crypto.randomUUID(), ...(selectedRunId ? { runId: selectedRunId } : {}), ...(!chatRunId ? { execution } : {}), context: buildRunContextPayload(submitted, files.length ? await serializeAttachments(files) : undefined) as AssistantMessageContext };
      if (!bound.current || getTransport() !== transport) return;
      setPending(request);
      const result = await send(request).unwrap();
      if (!bound.current || getTransport() !== transport) return;
      setPending(null);
      setMessage("");
      setFiles([]);
      dispatch(setContextItemsForKey({ key: ownerKey, items: withoutSubmittedContext(context.items, submitted) }));
      if (chatRunId) { void refreshRun(); void load(chatRunId, "latest"); }
      onSelectRun(result.runId);
    } catch (error) { if (bound.current) setFailure(errorText(error)); }
    finally { sendingRef.current = false; if (bound.current) setPreparing(false); }
  }
  const stop = useCallback(() => { if (chatRunId) void abort(chatRunId).unwrap().catch(error => { if (bound.current) setFailure(errorText(error)); }); }, [chatRunId, abort]);
  const variant = assistant.providerId === "codex" ? "codex" : "claude";
  const composer = <>
    {chatRunId && run && belongs && <div className="mx-auto mb-2 flex w-full max-w-210 items-center justify-between gap-3">
        <span className="min-w-0 truncate text-xs text-primary-600 dark:text-primary-300" title={workspace?.rootPath}>{run.mode === "developer" ? workspace?.name ?? "Workspace unavailable" : "Work"}</span>
        <Button variant="ghost" onClick={() => onSelectRun(null)}>New task</Button>
    </div>}
    <WorkspaceInput appearance="assistant" goal={pending?.message ?? message} onGoalChange={setMessage} onSubmit={() => void submit()} onStop={stop}
    isLoading={preparing || sending.isLoading} disabled={!!pending || !belongs} sendDisabled={!!pending} activeRun={visibleRun}
    canResume={!!chatRunId} providerId={assistant.providerId} mode={run?.mode ?? "work"} selectedModel={assistant.model}
    onModelChange={keepProfile} settingsConfig={assistant.conversationSettings.config} onSettingsConfigChange={keepProfile}
    fixedProfileLabel={`${assistant.model} · ${assistant.effort || "Default"} effort`} allowVoice={false} showGoalButton={false}
    workspacePath={chatRunId ? workspace?.rootPath : undefined} uploadedFiles={files} onUploadedFilesChange={setFiles}
    placeholder={`Message ${assistant.name}…`} inputLabel={`Message ${assistant.name}`} isNewRunTabActive={!chatRunId}
    layout={chatRunId || waitingWelcome ? "default" : "centered"} />
  </>;
  return <PluginLogoProvider providerId={assistant.providerId}>
    <AsyncQuestionDialogProvider ownerKey={ownerKey} runId={chatRunId} runStatus={run?.status} turns={turns} events={events} historical={history.historical}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {waitingWelcome ? <div className={`flex min-h-0 flex-1 flex-col justify-end gap-6 overflow-y-auto py-8 ${CONTENT_COLUMN_GUTTER}`}>
          <div className="mx-auto w-full max-w-210">
            <AssistantMonogram name={assistant.name} providerId={assistant.providerId} avatar={assistant.avatar} onClick={onOpenDetails} />
            <AssistantWelcomeCard welcome={waitingWelcome} busy={welcomeResponse.isLoading || welcomePreparation.isLoading}
              onAnswer={answerWelcome} onRetry={retryWelcome} />
          </div>
          {waitingWelcome.state === "skipped" && <div className="w-full">{composer}</div>}
        </div> : !chatRunId ? <div className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto py-10 ${CONTENT_COLUMN_GUTTER}`}>
          <div className="text-center"><AssistantMonogram name={assistant.name} providerId={assistant.providerId} avatar={assistant.avatar} size="lg" onClick={onOpenDetails} /><h1 className="text-2xl font-medium">{assistant.name}</h1><p className="mx-auto mt-2 max-w-md text-sm text-primary-500">{assistant.description || "How can I help?"}</p></div>
          <div className="w-full">{composer}</div>
        </div> : <>
          <div className="min-h-0 flex-1 overflow-hidden">
            {belongs ? <WorkspaceEvents appearance="assistant" mode={run?.mode ?? "work"} runs={visibleRun ? [visibleRun] : []} activeTab={chatRunId} currentEvents={events} currentWorkspace={workspace ?? null} eventsEndRef={eventsEndRef} history={history} issueTabs={[]} turns={turns} variant={variant} onSuggestionSelect={setMessage} /> : <p role={runError ? "alert" : "status"} className="p-6 text-sm text-primary-500">{runError ? errorText(runError) : run ? "This conversation belongs to another assistant." : "Loading conversation…"}</p>}
          </div>
          <div className={CONTENT_COLUMN_GUTTER}>
            <ComposerSlot request={approval} onRespond={respond} variant={variant}>{composer}</ComposerSlot>
          </div>
        </>}
        {failure && <div role="alert" className="mx-auto flex max-w-210 items-center gap-3 px-6 pb-3 text-xs text-danger"><span>{failure}</span>{pending && <Button variant="ghost" className="shrink-0" disabled={preparing} onClick={() => void submit()}>Check delivery</Button>}</div>}
      </div>
    </AsyncQuestionDialogProvider>
  </PluginLogoProvider>;
}
