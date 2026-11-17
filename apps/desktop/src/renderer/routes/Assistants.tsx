import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useGetAccountQuery } from "@/lib/redux/api";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { useAssistantOverviewQuery, useAssistantConversationsQuery, useArchiveAssistantMutation } from "@/lib/redux/api/assistantsApi";
import { Button } from "@/components/ui";
import { Bot, New } from "@/components/ui/icons";
import { AssistantProfileHeader } from "@/features/assistants/components/assistant-profile-header";
import { assistantConversationOwner, visitAssistantConversation, replaceAssistantConversationDraft } from "@/lib/redux/slices/assistantsSlice";
import { useSetMainHeader } from "@/hooks/use-main-header";
import { AssistantProfileForm } from "@/features/assistants/components/assistant-profile-form";
import { AssistantInfoPanel } from "@/features/assistants/components/assistant-info-panel";
import { AssistantChat } from "@/features/assistants/components/assistant-chat";
import { useAssistantUpdates } from "@/features/assistants/hooks/use-assistant-updates";
import { assistantHref } from "@/features/assistants/lib/assistant-navigation";
import { errorText, isAssistantWorking } from "@/features/assistants/lib/assistant-ui";

export default function AssistantsPage() {
  const backendId = useAppSelector(state => state.backends.activeBackendId ?? "local");
  const { data: account } = useGetAccountQuery();
  return account ? <AssistantConversations key={`${backendId}:${account.id}`} accountId={account.id} backendId={backendId} /> : null;
}

function AssistantConversations({ accountId, backendId }: { accountId: string; backendId: string }) {
  const dispatch = useAppDispatch();
  useAssistantUpdates();
  const { currentData: overview, error, isLoading, refetch } = useAssistantOverviewQuery(accountId);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const selectedId = params.get("assistant");
  const selected = overview?.assistants.find(a => a.id === selectedId);
  const runParam = params.get("run");
  const runId = runParam && runParam !== "new" ? runParam : null;
  const tab = params.get("tab");
  const creating = params.get("new") === "1";
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
    } else if (selected && chats && !runParam) {
      setParams(previous => { const next = new URLSearchParams(previous); next.set("run", savedView?.activeRunId ?? chats[0]?.id ?? "new"); return next; }, { replace: true });
    }
  }, [overview, creating, selectedId, selected, chats, runParam, savedView?.activeRunId, setParams]);
  const changeTab = useCallback((value?: string) => setParams(previous => { const next = new URLSearchParams(previous); if (value) next.set("tab", value); else next.delete("tab"); next.delete("new"); return next; }), [setParams]);
  const panelOpen = !!selected && !!tab && !creating;
  const closeInfoPanel = useCallback(() => {
    changeTab();
    document.getElementById("assistant-profile-trigger")?.focus({ preventScroll: true });
  }, [changeTab]);
  const working = selected ? isAssistantWorking(overview, selected.id) : false;
  const header = useMemo(() => !creating && selected ? <AssistantProfileHeader assistant={selected} working={working} isPanelOpen={panelOpen} onOpenDetails={() => changeTab(panelOpen ? undefined : "profile")} /> : null,
    [creating, selected, working, panelOpen, changeTab]);
  useSetMainHeader(header, false, !creating && isLoading);
  const closeCreation = () => setParams(previous => { const next = new URLSearchParams(previous); next.delete("new"); return next; });
  const toggleArchive = async () => {
    if (!selected) return;
    setFailure("");
    try { await archive({ accountId, id: selected.id, archived: !selected.isArchived }).unwrap(); }
    catch (e) { setFailure(errorText(e)); }
  };
  return <div className="@container/assistant-layout relative flex h-full min-h-0 overflow-hidden rounded-b-2xl bg-primary text-primary-900 dark:bg-primary-950 dark:text-primary-100">
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
    {creating ? <div className="scroll-bounce min-h-0 flex-1 overflow-y-auto noscrollbar">
      <AssistantProfileForm accountId={accountId} onClose={closeCreation} onCreated={id => navigate(assistantHref(id))} />
    </div> : selected ? <>
      {selected.isArchived ? <div className="flex flex-1 flex-col items-center justify-center gap-4 text-sm text-primary-500"><p>{selected.name} is archived.</p><Button variant="subtle" disabled={archiving.isLoading} onClick={() => void toggleArchive()}>Restore assistant</Button>{failure && <p role="alert" className="text-danger">{failure}</p>}</div> : runParam ? <AssistantChat key={`${selected.id}:${runId ?? "new"}`} assistant={selected} welcome={overview?.welcomes?.find(w => w.assistantId === selected.id && w.runId === runId)} selectedRunId={runId} onOpenDetails={() => changeTab("profile")} onSelectRun={id => {
        if (!id) { openChat("new"); return; }
        if (!runId) dispatch(replaceAssistantConversationDraft({ ownerKey, runId: id }));
        else dispatch(visitAssistantConversation({ ownerKey, runId: id, initialIds: chats?.map(chat => chat.id) ?? [] }));
        navigateChat(id, !runId);
      }} /> : <div className="flex flex-1 items-center justify-center text-sm text-primary-500">Loading conversation…</div>}
    </> : <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      {error ? <><p role="alert" className="text-sm text-danger">{errorText(error)}</p><Button variant="ghost" onClick={() => void refetch()}>Retry</Button></> : isLoading ? <p className="text-sm text-primary-500">Loading assistants…</p> : <><Bot className="size-8 text-primary-400" /><h1 className="text-xl font-medium">{selectedId ? "Assistant unavailable" : "Your assistants"}</h1><p className="max-w-sm text-sm text-primary-500">{selectedId ? "Choose an assistant from the sidebar." : "Create an assistant, then start a conversation. Your team can share memory and work together."}</p><Button variant="subtle" onClick={() => setParams({ new: "1" })}><New className="size-4" />New assistant</Button></>}
    </div>}
    </div>
    {selected && overview && <AssistantInfoPanel key={selected.id} assistant={selected} overview={overview} isOpen={panelOpen}
      chats={chats} selectedRunId={runId} chatsError={chatsError} onSelectChat={openChat} onRetryChats={() => void refetchChats()}
      tab={tab === "routines" || tab === "chats" || tab === "memory" || tab === "tasks" ? tab : "profile"} onTabChange={changeTab} onClose={closeInfoPanel}
      onToggleArchive={() => void toggleArchive()} archiving={archiving.isLoading} error={failure}
      openAssistant={(id, chatId) => navigate(assistantHref(id, chatId))} />}
  </div>;
}
