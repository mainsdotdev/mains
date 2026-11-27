import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Assistant } from "@mains/contracts/assistants";
import { Button, Text, toast } from "@/components/ui";
import { AgentTeams, AssistantSteps, Info, Pin, PinFilled, Warning } from "@/components/ui/icons";
import NewButton from "@/components/layout/sidebar/new-button";
import SearchBar from "@/components/layout/sidebar/search-bar";
import { SidebarGroupSection, SIDEBAR_ACTION_ICON } from "@/components/layout/sidebar/sidebar-group-section";
import { SidebarTopRows } from "@/components/layout/sidebar/sidebar-top-rows";
import { useGetAccountQuery } from "@/lib/redux/api";
import { useAssistantOverviewQuery, useSetAssistantPinnedMutation } from "@/lib/redux/api/assistantsApi";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setSidebarCollapsed } from "@/lib/redux/slices/appSettingsSlice";
import { useIsMobile } from "@/lib/platform";
import { assistantHref, assistantTeamGroupKey, assistantTeamWorkHref } from "../lib/assistant-navigation";
import { AssistantMonogram } from "./assistant-monogram";
import { AssistantAvatar } from "./assistant-avatar";
import { AssistantArchiveMenu } from "./assistant-archive-menu";
import { assistantIdsWithPendingSetup, errorText, isAssistantWorking } from "../lib/assistant-ui";

const SHOW_TEAM_ASSIGNMENTS_ACTION = false;

export function AssistantsSidebar() {
  const backendId = useAppSelector(state => state.backends.activeBackendId);
  const { data: account } = useGetAccountQuery();
  const { currentData: overview, error, refetch } = useAssistantOverviewQuery(account?.id ?? "", { skip: !account });
  const [setPinned, { isLoading: changingPin }] = useSetAssistantPinnedMutation();
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const mobile = useIsMobile();
  const open = (href: string) => {
    navigate(href);
    if (mobile) dispatch(setSidebarCollapsed(true));
  };
  const query = searchQuery.trim().toLocaleLowerCase();
  const matches = (mate: Assistant) => !query || `${mate.name} ${mate.description}`.toLocaleLowerCase().includes(query);
  const pendingSetup = assistantIdsWithPendingSetup(overview?.welcomes);
  const pinned: Array<Assistant & { pinnedAt: Date }> = [];
  const matchingPinnedTeams = new Set<string>();
  const groupsByTeam = new Map<string | null, Assistant[]>();
  for (const assistant of overview?.assistants.slice().reverse() ?? []) {
    if (assistant.isArchived) continue;
    if (assistant.pinnedAt != null) {
      if (matches(assistant)) {
        pinned.push({ ...assistant, pinnedAt: assistant.pinnedAt });
        if (SHOW_TEAM_ASSIGNMENTS_ACTION && assistant.teamId) matchingPinnedTeams.add(assistant.teamId);
      }
      continue;
    }
    const members = groupsByTeam.get(assistant.teamId);
    if (members) members.push(assistant);
    else groupsByTeam.set(assistant.teamId, [assistant]);
  }
  for (const teamId of matchingPinnedTeams) {
    if (!groupsByTeam.has(teamId)) groupsByTeam.set(teamId, []);
  }
  pinned.sort((a, b) => new Date(b.pinnedAt).getTime() - new Date(a.pinnedAt).getTime() || a.id.localeCompare(b.id));
  const showTeamHeadings = groupsByTeam.size > 1 || !groupsByTeam.has(null);
  const teamNames = new Map(overview?.teams.map(team => [team.id, team.name]));
  const visibleGroups = Array.from(groupsByTeam, ([teamId, members]) => ({
    teamId,
    label: teamId === null ? "No team" : teamNames.get(teamId) ?? "Unavailable team",
    members: members.filter(matches),
  })).filter(group => group.members.length > 0 || (group.teamId !== null && matchingPinnedTeams.has(group.teamId)));
  const changePin = async (assistant: Assistant) => {
    try { await setPinned({ accountId: assistant.accountId, id: assistant.id, pinned: assistant.pinnedAt == null }).unwrap(); }
    catch (error) { toast.error(errorText(error)); }
  };
  const renderMate = (assistant: Assistant) => <AssistantItem key={assistant.id} assistant={assistant}
    needsSetup={pendingSetup.has(assistant.id)}
    working={isAssistantWorking(overview, assistant.id)} active={params.get("new") !== "1" && params.get("assistant") === assistant.id}
    open={open} onOpenDetails={() => open(`${assistantHref(assistant.id, params.get("assistant") === assistant.id ? params.get("run") : null)}&tab=profile`)}
    onTogglePin={assistant.pinnedAt !== undefined ? () => void changePin(assistant) : undefined} changingPin={changingPin} />;
  return (
    <div className="flex h-full flex-col text-primary-900 dark:text-primary-100">
      <SidebarTopRows header={<Text as="h2" size="base" weight="medium" className="px-2 font-sf-expanded">Mates</Text>}>
        <div inert={searchExpanded} className={`pr-9 transition-opacity duration-150 motion-reduce:transition-none ${searchExpanded ? "opacity-0" : "opacity-100"}`}>
          <NewButton title="mate" icon={<AssistantSteps aria-hidden="true" className="size-3.5 shrink-0" />} onClick={() => { const next = new URLSearchParams(params); next.delete("tab"); next.delete("team"); next.set("new", "1"); open(`/assistants?${next}`); }} />
        </div>
        <div className={`absolute inset-y-0 right-0 flex items-center justify-end transition-[width] duration-200 ease-out motion-reduce:transition-none ${searchExpanded ? "w-full" : "w-8"}`}>
          <SearchBar isExpanded={searchExpanded} searchQuery={searchQuery} searchLabel="Search mates" onToggle={() => setSearchExpanded(true)} onSearchChange={setSearchQuery} onClear={() => { setSearchQuery(""); setSearchExpanded(false); }} />
        </div>
      </SidebarTopRows>
      <nav aria-label="Mates" className="scroll-bounce min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4 select-none noscrollbar">
        {!!error && <div className="px-2 py-3 text-xs text-danger">{errorText(error)}<Button variant="ghost" onClick={() => void refetch()}>Retry</Button></div>}
        {!overview && !error && <p className="px-2 py-3 text-xs text-primary-500">Loading mates…</p>}
        {overview && !pinned.length && !visibleGroups.length && <p className="px-2 py-3 text-xs text-primary-500">{query ? "No matching mates" : "Your mates will appear here."}</p>}
        {pinned.length > 0 && <section aria-label="Pinned">
          <SidebarGroupSection key={query ? "search" : "browse"} groupKey={query ? undefined : JSON.stringify([backendId ?? "local", account?.id ?? "", "mate-pins"])}
            label="Pinned" labelWeight="medium" count={pinned.length}>
            <div className="grid grid-cols-3 gap-1.5 pt-1">{pinned.map(renderMate)}</div>
          </SidebarGroupSection>
        </section>}
        {visibleGroups.map(({ teamId, label, members }) => {
          const groupKey = assistantTeamGroupKey(backendId, account?.id ?? "", teamId);
          const rows = members.map(renderMate);
          if (!showTeamHeadings) return <div key={groupKey} className="space-y-1.5">{rows}</div>;

          return (
            <section key={groupKey} aria-label={label}>
              <SidebarGroupSection key={query ? "search" : "browse"} groupKey={query ? undefined : groupKey}
                label={label} labelWeight="medium" count={members.length}
                secondaryAction={SHOW_TEAM_ASSIGNMENTS_ACTION && teamId && teamNames.has(teamId) ? {
                  label: `View assignments for ${label}`, icon: <AgentTeams aria-hidden="true" className={SIDEBAR_ACTION_ICON} />,
                  fadeOnHover: true, current: params.get("team") === teamId,
                  onClick: () => open(assistantTeamWorkHref(teamId)),
                } : undefined}>
                {!!rows.length && <div className="space-y-1.5 pt-1">{rows}</div>}
              </SidebarGroupSection>
            </section>
          );
        })}
      </nav>
      {account && <div className="shrink-0 px-3 pt-4 pb-3">
        <AssistantArchiveMenu key={`${backendId}:${account.id}`} accountId={account.id} assistants={overview?.assistants} error={error}
          onOpen={id => open(assistantHref(id))}
          onRemoved={id => {
            if (params.get("assistant") === id) setParams(params.get("new") === "1" ? { new: "1" } : {}, { replace: true });
          }} />
      </div>}
    </div>
  );
}

function AssistantItem({ assistant, needsSetup, working, active, open, onOpenDetails, onTogglePin, changingPin }: {
  assistant: Assistant; needsSetup: boolean; working: boolean; active: boolean; open(href: string): void; onOpenDetails(): void;
  onTogglePin?: () => void; changingPin: boolean;
}) {
  const pinned = assistant.pinnedAt != null;
  const pinLabel = pinned ? "Unpin mate" : "Pin mate";
  const PinIcon = pinned ? PinFilled : Pin;
  const select = () => open(assistantHref(assistant.id));
  const actionVisibility = "opacity-0 group-hover/assistant:opacity-100 group-focus-within/assistant:opacity-100 pointer-coarse:opacity-100";
  const rowPinVisibility = "pointer-events-none opacity-0 group-hover/assistant:pointer-events-auto group-hover/assistant:opacity-100 group-has-[:focus-visible]/assistant:pointer-events-auto group-has-[:focus-visible]/assistant:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100";
  return (
    <div className={`group/assistant relative min-w-0 rounded-2xl transition-colors ${pinned ? "" : "flex items-center gap-2 px-2.5 py-2.5"} ${active ? "glass-outline-soft glass-outline bg-primary/50 dark:bg-primary/5" : "hover:bg-primary/50 dark:hover:bg-primary/5"}`}>
      {pinned ? <>
        <Button variant="bare" title={assistant.name} aria-label={`Open ${assistant.name}${needsSetup ? ", finish setup" : ""}`}
          aria-current={active ? "page" : undefined} onClick={select}
          className="flex w-full min-w-0 flex-col items-center gap-1 rounded-2xl px-1 py-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
          <AssistantAvatar avatar={assistant.avatar} working={working} seed={assistant.name} className="size-11 max-w-full shrink-0" />
          <span className="flex w-full min-w-0 items-center justify-center gap-1">
            <Text as="span" size="xs" weight="medium" className="min-w-0 truncate">{assistant.name}</Text>
            {needsSetup && (
              <Warning aria-hidden="true" className="size-3.5 shrink-0 text-warning" />
            )}
          </span>
        </Button>
        <Button variant="icon" iconSize="xs" aria-label={`About ${assistant.name}`}
          onClick={onOpenDetails} className={`absolute top-1 left-1 ${actionVisibility}`}>
          <Info aria-hidden="true" className="size-3.5" />
        </Button>
      </> : <>
        <AssistantMonogram avatar={assistant.avatar} name={assistant.name} providerId={assistant.providerId} working={working} onClick={onOpenDetails} />
        <Button variant="bare" className={`flex min-w-0 flex-1 items-center gap-2.5 text-left ${onTogglePin ? "group-hover/assistant:pr-7 group-has-focus-visible/assistant:pr-7 pointer-coarse:pr-7" : ""}`} aria-current={active ? "page" : undefined} onClick={select}>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Text as="span" size="s" weight="medium" className="truncate">{assistant.name}</Text>
            {needsSetup ? <span className="flex min-w-0 items-center gap-1.5 text-xs text-primary-500">
              <span className="truncate">Finish setup</span>
              <Warning aria-hidden="true" className="size-3.5 shrink-0 text-warning" />
            </span> : <span className="truncate text-xs text-primary-500">{assistant.description || assistant.spaceSnapshot.name}</span>}
          </span>
        </Button>
      </>}
      {onTogglePin && <span className={`absolute inline-flex ${pinned ? `top-1 right-1 ${actionVisibility}` : `top-1/2 right-2.5 -translate-y-1/2 ${rowPinVisibility}`}`}>
        <Button variant="icon" iconSize="xs" aria-label={`${pinLabel} ${assistant.name}`} aria-pressed={pinned}
          tooltip={pinLabel} onClick={onTogglePin} disabled={changingPin}>
          <PinIcon aria-hidden="true" className="size-3.5" />
        </Button>
      </span>}
    </div>
  );
}
