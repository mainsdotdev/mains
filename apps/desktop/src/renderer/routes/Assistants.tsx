import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useGetAccountQuery } from "@/lib/redux/api";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setWorkspaceGroupExpanded } from "@/lib/redux/slices/appSettingsSlice";
import { useAssistantOverviewQuery, useAssistantConversationsQuery, useArchiveAssistantMutation } from "@/lib/redux/api/assistantsApi";
import { Button } from "@/components/ui";
import { Bot, Plus } from "@/components/ui/icons";
import { AssistantProfileHeader } from "@/features/assistants/components/assistant-profile-header";
import { assistantConversationOwner, visitAssistantConversation, replaceAssistantConversationDraft } from "@/lib/redux/slices/assistantsSlice";
import { AssistantProfileForm } from "@/features/assistants/components/assistant-profile-form";
import { AssistantInfoPanel } from "@/features/assistants/components/assistant-info-panel";
import { AssistantChat } from "@/features/assistants/components/assistant-chat";
import { AssistantTeamWork } from "@/features/assistants/components/assistant-team-work";
import { AssistantRobotAvatar } from "@/features/assistants/components/assistant-robot-avatar";
import { useAssistantUpdates } from "@/features/assistants/hooks/use-assistant-updates";
import { usePreviewPanel } from "@/hooks/use-preview-panel";
import { assistantHref, assistantTeamGroupKey } from "@/features/assistants/lib/assistant-navigation";
import { errorText, isAssistantWorking } from "@/features/assistants/lib/assistant-ui";
import type { AssistantAvatarState } from "@/features/assistants/lib/assistant-avatar-activity";
import { composerOwnerKey } from "@/features/workspace/lib/ui-context";

export default function AssistantsPage() {
  const backendId = useAppSelector(state => state.backends.activeBackendId ?? "local");
  const { data: account } = useGetAccountQuery();
  const [params] = useSearchParams();
  const teamId = params.get("team");
  useAssistantUpdates(!!teamId);
  if (!account) return null;
  if (teamId) return <AssistantTeamWork key={JSON.stringify([backendId, account.id, teamId])} accountId={account.id} teamId={teamId} />;
  return <AssistantConversations key={`${backendId}:${account.id}`} accountId={account.id} backendId={backendId} />;
}

function AssistantConversations({ accountId, backendId }: { accountId: string; backendId: string }) {
  const dispatch = useAppDispatch();
  const chatColumnRef = useRef<HTMLDivElement>(null);
  const { currentData: overview, error, isLoading, isFetching, refetch } = useAssistantOverviewQuery(accountId);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isOpen: previewOpen, ownerKey: previewOwner, hide: hidePreview } = usePreviewPanel();
  const selectedId = params.get("assistant");
  const selected = overview?.assistants.find(a => a.id === selectedId);
  const firstActiveMate = overview?.assistants.find(a => !a.isArchived);
  const setupWelcome = selected?.isArchived ? undefined : overview?.welcomes?.find(welcome => welcome.assistantId === selectedId &&
    welcome.question?.profileSetup && !welcome.question.profileSetup.saved);
  const requestedRun = params.get("run");
  const runParam = setupWelcome?.runId ?? requestedRun;
  const runId = runParam && runParam !== "new" ? runParam : null;
  const tab = params.get("tab");
  const creating = params.get("new") === "1";
  const emptyRequested = params.get("empty") === "1";
  const createdMateId = (location.state as { createdMateId?: string } | null)?.createdMateId;
  const animateWelcome = selectedId === createdMateId;
  const { currentData: chats, error: chatsError, isFetching: loadingChats, refetch: refetchChats } = useAssistantConversationsQuery({ accountId, id: selectedId ?? "" }, { skip: !selected });
  const ownerKey = assistantConversationOwner(backendId, accountId, selectedId ?? "");
  const savedView = useAppSelector(state => state.assistants.views[ownerKey]);
  const navigateChat = useCallback((id: string, replace = false) => {
    if (!selectedId) return;
    setParams(previous => { const next = new URLSearchParams(previous); next.set("assistant", selectedId); next.set("run", id); next.delete("new"); return next; }, { replace });
  }, [selectedId, setParams]);
  const openChat = useCallback((id: string) => {
    if (!selectedId) return;
    if (chats) dispatch(visitAssistantConversation({ ownerKey, runId: id, initialIds: chats.map(chat => chat.id) }));
    navigateChat(id);
  }, [dispatch, ownerKey, selectedId, chats, navigateChat]);
  const visitedRoute = useRef("");
  useEffect(() => {
    if (!selected || !chats || !runParam) return;
    const route = JSON.stringify([ownerKey, runParam]);
    if (visitedRoute.current === route) return;
    visitedRoute.current = route;
    dispatch(visitAssistantConversation({ ownerKey, runId: runParam, initialIds: chats.map(chat => chat.id) }));
  }, [selected, chats, runParam, dispatch, ownerKey]);
  const [archive, archiving] = useArchiveAssistantMutation();
  const { originalArgs: archiveRequest, isLoading: archiveLoading, isSuccess: archiveSucceeded, reset: resetArchive } = archiving;
  const archivingSelected = archiveRequest?.archived === true && archiveRequest.id === selectedId && (archiveLoading || archiveSucceeded);
  const [failure, setFailure] = useState("");
  const activeSelection = useRef<{ id: string | null; creating: boolean } | null>(null);
  useLayoutEffect(() => {
    activeSelection.current = { id: selectedId, creating };
    return () => { activeSelection.current = null; };
  }, [creating, selectedId]);
  useEffect(() => {
    // Keep the outgoing chat hidden until the route has committed.
    if (archiveSucceeded && archiveRequest?.archived && archiveRequest.id !== selectedId) resetArchive();
  }, [archiveRequest, archiveSucceeded, resetArchive, selectedId]);
  useEffect(() => {
    if (!overview || creating) return;
    if (!selectedId) {
      if (!emptyRequested && firstActiveMate) setParams({ assistant: firstActiveMate.id }, { replace: true });
    } else if (setupWelcome && requestedRun !== setupWelcome.runId) {
      setParams(previous => { const next = new URLSearchParams(previous); next.set("run", setupWelcome.runId); return next; }, { replace: true });
    } else if (selected && !selected.isArchived && chats && !runParam) {
      setParams(previous => { const next = new URLSearchParams(previous); next.set("run", savedView?.activeRunId ?? chats[0]?.id ?? "new"); return next; }, { replace: true });
    }
  }, [overview, creating, emptyRequested, firstActiveMate, selectedId, selected, chats, runParam, requestedRun, setupWelcome, savedView?.activeRunId, setParams]);
  const changeTab = useCallback((value?: string, replace = false) => setParams(previous => { const next = new URLSearchParams(previous); if (value) next.set("tab", value); else next.delete("tab"); next.delete("new"); return next; }, { replace }), [setParams]);
  const panelRequested = !!selected && !!tab && !creating;
  const panelOpen = panelRequested && !previewOpen;
  const chatOwner = selected && (!selected.isArchived || runId) ? composerOwnerKey({
    backendId, assistantId: selected.id, spaceId: selected.spaceId, providerId: selected.providerId, mode: selected.spaceSnapshot.mode,
  }, runId) : previewOwner;
  const panelRequest = panelRequested ? `${selectedId}:${tab}:${chatOwner}` : null;
  const appliedPanelRequest = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!panelRequest) {
      appliedPanelRequest.current = null;
      return;
    }
    // Wait for the selected chat to publish its preview owner. The prior
    // conversation can still own the shell's preview during navigation.
    if (chatOwner !== previewOwner || (!runParam && !selected?.isArchived)) return;
    if (appliedPanelRequest.current !== panelRequest) {
      appliedPanelRequest.current = panelRequest;
      if (previewOpen) hidePreview();
    } else if (previewOpen) {
      changeTab(undefined, true);
    }
  }, [panelRequest, chatOwner, previewOwner, runParam, selected?.isArchived, previewOpen, hidePreview, changeTab]);
  const closeInfoPanel = useCallback(() => {
    changeTab();
    document.getElementById("assistant-profile-trigger")?.focus({ preventScroll: true });
  }, [changeTab]);
  const working = selected ? isAssistantWorking(overview, selected.id) : false;
  const avatarScope = `${selected?.id ?? ""}:${runId ?? "new"}`;
  const [reportedAvatarState, setReportedAvatarState] = useState<{ scope: string; state: AssistantAvatarState }>();
  const reportAvatarState = useCallback((state: AssistantAvatarState | undefined) => {
    setReportedAvatarState(current => {
      if (!state) return current?.scope === avatarScope ? undefined : current;
      return current?.scope === avatarScope && current.state === state ? current : { scope: avatarScope, state };
    });
  }, [avatarScope]);
  const liveAvatarState = reportedAvatarState?.scope === avatarScope ? reportedAvatarState.state : undefined;
  const avatarState = liveAvatarState && liveAvatarState !== "idle" ? liveAvatarState : working ? "thinking" : "idle";
  const toggleInfoPanel = useCallback(() => changeTab(panelOpen ? undefined : "profile"), [changeTab, panelOpen]);
  const closeCreation = useCallback(() => setParams(previous => {
    const next = new URLSearchParams(previous);
    next.delete("new");
    return next;
  }), [setParams]);
  const openCreatedMate = (id: string, teamId: string | null) => {
    dispatch(setWorkspaceGroupExpanded({ groupKey: assistantTeamGroupKey(backendId, accountId, teamId), expanded: true }));
    navigate(assistantHref(id), { state: { createdMateId: id } });
  };
  const toggleArchive = async () => {
    if (!selected) return;
    const { id, isArchived } = selected;
    setFailure("");
    try {
      await archive({ accountId, id, archived: !isArchived }).unwrap();
      const active = activeSelection.current;
      if (!isArchived && active?.id === id) {
        setParams(active.creating ? { empty: "1", new: "1" } : { empty: "1" }, { replace: true });
      }
    } catch (e) {
      if (activeSelection.current?.id === id) setFailure(errorText(e));
    }
  };
  return <div className="@container/assistant-layout relative flex h-full min-h-0 overflow-hidden text-primary-900 dark:text-primary-100">
    {!creating && <AssistantProfileHeader assistant={selected} chatColumnRef={chatColumnRef} working={working} avatarState={avatarState} isPanelOpen={panelOpen} onOpenDetails={toggleInfoPanel} pending={isLoading} />}
    <div ref={chatColumnRef} data-assistant-chat-column="" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-primary dark:bg-primary-950">
    {creating ? <div className="scroll-bounce min-h-0 flex-1 overflow-y-auto noscrollbar">
      <AssistantProfileForm accountId={accountId} onClose={closeCreation} onCreated={openCreatedMate} />
    </div> : archivingSelected ? <div role="status" className="flex flex-1 items-center justify-center text-sm text-primary-500">
      Archiving mate…
    </div> : selected ? <>
      {selected.isArchived && !runId ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-sm text-primary-500">
          <p>{selected.name} is archived.</p>
          <div className="flex items-center gap-2">
            {!!chats?.length && <Button variant="ghost" onClick={() => changeTab("chats")}>View chats</Button>}
            <Button variant="subtle" disabled={archiving.isLoading} onClick={() => void toggleArchive()}>Restore mate</Button>
          </div>
          {failure && <p role="alert" className="text-danger">{failure}</p>}
        </div>
      ) : runParam ? <>
        <AssistantChat key={avatarScope} assistant={selected} welcome={overview?.welcomes?.find(w => w.assistantId === selected.id && w.runId === runId)}
          animateWelcome={animateWelcome} selectedRunId={runId} onAvatarState={reportAvatarState} onOpenDetails={() => changeTab("profile")}
          onOpenChats={() => changeTab("chats")} onSelectRun={id => {
            if (selected.isArchived) return;
            if (!id) { openChat("new"); return; }
            if (!runId) dispatch(replaceAssistantConversationDraft({ ownerKey, runId: id }));
            else dispatch(visitAssistantConversation({ ownerKey, runId: id, initialIds: chats?.map(chat => chat.id) ?? [] }));
            navigateChat(id, !runId);
          }} />
        {selected.isArchived && <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-3 text-sm text-primary-500">
          <p>Restore this Mate to send messages.</p>
          <Button variant="subtle" disabled={archiving.isLoading} onClick={() => void toggleArchive()}>Restore mate</Button>
          {failure && <p role="alert" className="text-danger">{failure}</p>}
        </div>}
      </> : <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-primary-500">
        {chatsError ? <>
          <p role="alert" className="text-danger">{errorText(chatsError)}</p>
          <Button variant="ghost" disabled={loadingChats} onClick={() => void refetchChats()}>Retry</Button>
        </> : <p role="status">Loading conversation…</p>}
      </div>}
    </> : <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      {error ? <><p role="alert" className="text-sm text-danger">{errorText(error)}</p><Button variant="ghost" onClick={() => void refetch()}>Retry</Button></> : isLoading || (isFetching && animateWelcome) ? <p className="text-sm text-primary-500">Loading mates…</p> : <>
        {selectedId ? <Bot className="size-8 text-primary-400" aria-hidden /> : (
          <div aria-hidden="true" className="flex items-end gap-3 px-2 py-2 sm:gap-4">
            <AssistantRobotAvatar shape="terminal-amber"
              className="assistant-avatar--floating size-14 -rotate-10 [--avatar-float-delay:-3.2s] sm:size-16" />
            <AssistantRobotAvatar shape="specialist-travel"
              className="assistant-avatar--floating size-18 sm:size-20" />
            <AssistantRobotAvatar shape="metal-silver"
              className="assistant-avatar--floating size-14 rotate-10 [--avatar-float-delay:-1.6s] sm:size-16" />
          </div>
        )}
        <h1 className="text-xl font-medium">{selectedId ? "Mate unavailable" : "Your mates"}</h1>
        <p className="max-w-sm text-sm text-primary-500">{selectedId || firstActiveMate ? "Choose a mate from the sidebar." : "Create a mate, then start a conversation. Your team can share memory and work together."}</p>
        <Button variant="subtle" onClick={() => setParams(emptyRequested ? { empty: "1", new: "1" } : { new: "1" })}><Plus className="size-4" />New mate</Button>
      </>}
    </div>}
    </div>
    {selected && overview && !previewOpen && <AssistantInfoPanel key={selected.id} assistant={selected} overview={overview} avatarState={avatarState} isOpen={panelOpen}
      chats={chats} selectedRunId={runId} chatsError={chatsError} onSelectChat={openChat} onRetryChats={() => void refetchChats()}
      tab={tab === "routines" || tab === "chats" || tab === "memory" || tab === "tasks" ? tab : "profile"} onTabChange={changeTab} onClose={closeInfoPanel}
      onToggleArchive={() => void toggleArchive()} archiving={archiveLoading || archivingSelected} error={failure}
      openAssistant={(id, chatId) => navigate(assistantHref(id, chatId))} />}
  </div>;
}
