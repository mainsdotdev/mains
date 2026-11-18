import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useGetAccountQuery } from "@/lib/redux/api";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { useAssistantOverviewQuery, useAssistantConversationsQuery, useArchiveAssistantMutation } from "@/lib/redux/api/assistantsApi";
import { Button } from "@/components/ui";
import { Bot, Plus } from "@/components/ui/icons";
import { AssistantProfileHeader } from "@/features/assistants/components/assistant-profile-header";
import { assistantConversationOwner, visitAssistantConversation, replaceAssistantConversationDraft } from "@/lib/redux/slices/assistantsSlice";
import { AssistantProfileForm } from "@/features/assistants/components/assistant-profile-form";
import { AssistantInfoPanel } from "@/features/assistants/components/assistant-info-panel";
import { AssistantChat } from "@/features/assistants/components/assistant-chat";
import { useAssistantUpdates } from "@/features/assistants/hooks/use-assistant-updates";
import { usePreviewPanel } from "@/hooks/use-preview-panel";
import { assistantHref } from "@/features/assistants/lib/assistant-navigation";
import { errorText, isAssistantWorking } from "@/features/assistants/lib/assistant-ui";
import { composerOwnerKey } from "@/features/workspace/lib/ui-context";

export default function AssistantsPage() {
  const backendId = useAppSelector(state => state.backends.activeBackendId ?? "local");
  const { data: account } = useGetAccountQuery();
  return account ? <AssistantConversations key={`${backendId}:${account.id}`} accountId={account.id} backendId={backendId} /> : null;
}

function AssistantConversations({ accountId, backendId }: { accountId: string; backendId: string }) {
  const dispatch = useAppDispatch();
  const chatColumnRef = useRef<HTMLDivElement>(null);
  useAssistantUpdates();
  const { currentData: overview, error, isLoading, isFetching, refetch } = useAssistantOverviewQuery(accountId);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isOpen: previewOpen, ownerKey: previewOwner, hide: hidePreview } = usePreviewPanel();
  const selectedId = params.get("assistant");
  const selected = overview?.assistants.find(a => a.id === selectedId);
  const setupWelcome = overview?.welcomes?.find(welcome => welcome.assistantId === selectedId &&
    welcome.question?.profileSetup && !welcome.question.profileSetup.saved);
  const requestedRun = params.get("run");
  const runParam = setupWelcome?.runId ?? requestedRun;
  const runId = runParam && runParam !== "new" ? runParam : null;
  const tab = params.get("tab");
  const creating = params.get("new") === "1";
  const createdMateId = (location.state as { createdMateId?: string } | null)?.createdMateId;
  const animateWelcome = selectedId === createdMateId;
  const { currentData: chats, error: chatsError, refetch: refetchChats } = useAssistantConversationsQuery({ accountId, id: selectedId ?? "" }, { skip: !selected });
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
  const [failure, setFailure] = useState("");
  useEffect(() => {
    if (!overview || creating) return;
    if (!selectedId) {
      const first = overview.assistants.find(a => !a.isArchived);
      if (first) setParams({ assistant: first.id }, { replace: true });
    } else if (setupWelcome && requestedRun !== setupWelcome.runId) {
      setParams(previous => { const next = new URLSearchParams(previous); next.set("run", setupWelcome.runId); return next; }, { replace: true });
    } else if (selected && chats && !runParam) {
      setParams(previous => { const next = new URLSearchParams(previous); next.set("run", savedView?.activeRunId ?? chats[0]?.id ?? "new"); return next; }, { replace: true });
    }
  }, [overview, creating, selectedId, selected, chats, runParam, requestedRun, setupWelcome, savedView?.activeRunId, setParams]);
  const changeTab = useCallback((value?: string, replace = false) => setParams(previous => { const next = new URLSearchParams(previous); if (value) next.set("tab", value); else next.delete("tab"); next.delete("new"); return next; }, { replace }), [setParams]);
  const panelRequested = !!selected && !!tab && !creating;
  const panelOpen = panelRequested && !previewOpen;
  const chatOwner = selected && !selected.isArchived ? composerOwnerKey({
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
  const toggleInfoPanel = useCallback(() => changeTab(panelOpen ? undefined : "profile"), [changeTab, panelOpen]);
  const closeCreation = useCallback(() => setParams(previous => {
    const next = new URLSearchParams(previous);
    next.delete("new");
    return next;
  }), [setParams]);
  const openCreatedMate = (id: string) => navigate(assistantHref(id), { state: { createdMateId: id } });
  const toggleArchive = async () => {
    if (!selected) return;
    setFailure("");
    try { await archive({ accountId, id: selected.id, archived: !selected.isArchived }).unwrap(); }
    catch (e) { setFailure(errorText(e)); }
  };
  return <div className="@container/assistant-layout relative flex h-full min-h-0 overflow-hidden text-primary-900 dark:text-primary-100">
    {!creating && <AssistantProfileHeader assistant={selected} chatColumnRef={chatColumnRef} working={working} isPanelOpen={panelOpen} onOpenDetails={toggleInfoPanel} pending={isLoading} />}
    <div ref={chatColumnRef} data-assistant-chat-column="" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-primary dark:bg-primary-950">
    {creating ? <div className="scroll-bounce min-h-0 flex-1 overflow-y-auto noscrollbar">
      <AssistantProfileForm accountId={accountId} onClose={closeCreation} onCreated={openCreatedMate} />
    </div> : selected ? <>
      {selected.isArchived ? <div className="flex flex-1 flex-col items-center justify-center gap-4 text-sm text-primary-500"><p>{selected.name} is archived.</p><Button variant="subtle" disabled={archiving.isLoading} onClick={() => void toggleArchive()}>Restore mate</Button>{failure && <p role="alert" className="text-danger">{failure}</p>}</div> : runParam ? <AssistantChat key={`${selected.id}:${runId ?? "new"}`} assistant={selected} welcome={overview?.welcomes?.find(w => w.assistantId === selected.id && w.runId === runId)} animateWelcome={animateWelcome} selectedRunId={runId} onOpenDetails={() => changeTab("profile")} onSelectRun={id => {
        if (!id) { openChat("new"); return; }
        if (!runId) dispatch(replaceAssistantConversationDraft({ ownerKey, runId: id }));
        else dispatch(visitAssistantConversation({ ownerKey, runId: id, initialIds: chats?.map(chat => chat.id) ?? [] }));
        navigateChat(id, !runId);
      }} /> : <div className="flex flex-1 items-center justify-center text-sm text-primary-500">Loading conversation…</div>}
    </> : <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      {error ? <><p role="alert" className="text-sm text-danger">{errorText(error)}</p><Button variant="ghost" onClick={() => void refetch()}>Retry</Button></> : isLoading || (isFetching && animateWelcome) ? <p className="text-sm text-primary-500">Loading mates…</p> : <><Bot className="size-8 text-primary-400" /><h1 className="text-xl font-medium">{selectedId ? "Mate unavailable" : "Your mates"}</h1><p className="max-w-sm text-sm text-primary-500">{selectedId ? "Choose a mate from the sidebar." : "Create a mate, then start a conversation. Your team can share memory and work together."}</p><Button variant="subtle" onClick={() => setParams({ new: "1" })}><Plus className="size-4" />New mate</Button></>}
    </div>}
    </div>
    {selected && overview && !previewOpen && <AssistantInfoPanel key={selected.id} assistant={selected} overview={overview} isOpen={panelOpen}
      chats={chats} selectedRunId={runId} chatsError={chatsError} onSelectChat={openChat} onRetryChats={() => void refetchChats()}
      tab={tab === "routines" || tab === "chats" || tab === "memory" || tab === "tasks" ? tab : "profile"} onTabChange={changeTab} onClose={closeInfoPanel}
      onToggleArchive={() => void toggleArchive()} archiving={archiving.isLoading} error={failure}
      openAssistant={(id, chatId) => navigate(assistantHref(id, chatId))} />}
  </div>;
}
