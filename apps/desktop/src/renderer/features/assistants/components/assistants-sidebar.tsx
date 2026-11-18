import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Assistant } from "@mains/contracts/assistants";
import { Button, Text } from "@/components/ui";
import { AssistantSteps } from "@/components/ui/icons";
import NewButton from "@/components/layout/sidebar/new-button";
import SearchBar from "@/components/layout/sidebar/search-bar";
import { SidebarGroupSection } from "@/components/layout/sidebar/sidebar-group-section";
import { SidebarItemHoverCard } from "@/components/layout/sidebar/sidebar-item-hover-card";
import { SidebarTopRows } from "@/components/layout/sidebar/sidebar-top-rows";
import { useGetAccountQuery } from "@/lib/redux/api";
import { useAssistantOverviewQuery } from "@/lib/redux/api/assistantsApi";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setSidebarCollapsed } from "@/lib/redux/slices/appSettingsSlice";
import { useIsMobile } from "@/lib/platform";
import { assistantHref, assistantTeamGroupKey } from "../lib/assistant-navigation";
import { AssistantMonogram } from "./assistant-monogram";
import { AssistantArchiveMenu } from "./assistant-archive-menu";
import { errorText, isAssistantWorking } from "../lib/assistant-ui";

export function AssistantsSidebar() {
  const backendId = useAppSelector(state => state.backends.activeBackendId);
  const { data: account } = useGetAccountQuery();
  const { currentData: overview, error, refetch } = useAssistantOverviewQuery(account?.id ?? "", { skip: !account });
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
  const groupsByTeam = new Map<string | null, Assistant[]>();
  for (const assistant of overview?.assistants.slice().reverse() ?? []) {
    if (assistant.isArchived) continue;
    const members = groupsByTeam.get(assistant.teamId);
    if (members) members.push(assistant);
    else groupsByTeam.set(assistant.teamId, [assistant]);
  }
  const showTeamHeadings = groupsByTeam.size > 1 || !groupsByTeam.has(null);
  const teamNames = new Map(overview?.teams.map(team => [team.id, team.name]));
  const visibleGroups = Array.from(groupsByTeam, ([teamId, members]) => ({
    teamId,
    label: teamId === null ? "No team" : teamNames.get(teamId) ?? "Unavailable team",
    members: query ? members.filter(a => `${a.name} ${a.description}`.toLocaleLowerCase().includes(query)) : members,
  })).filter(group => group.members.length > 0);
  return (
    <div className="flex h-full flex-col text-primary-900 dark:text-primary-100">
      <SidebarTopRows header={<Text as="h2" size="base" weight="medium" className="px-2">Mates</Text>}>
        <div inert={searchExpanded} className={`pr-9 transition-opacity duration-150 motion-reduce:transition-none ${searchExpanded ? "opacity-0" : "opacity-100"}`}>
          <NewButton title="mate" icon={<AssistantSteps aria-hidden="true" className="size-3.5 shrink-0" />} onClick={() => { const next = new URLSearchParams(params); next.delete("tab"); next.set("new", "1"); open(`/assistants?${next}`); }} />
        </div>
        <div className={`absolute inset-y-0 right-0 flex items-center justify-end transition-[width] duration-200 ease-out motion-reduce:transition-none ${searchExpanded ? "w-full" : "w-8"}`}>
          <SearchBar isExpanded={searchExpanded} searchQuery={searchQuery} searchLabel="Search mates" onToggle={() => setSearchExpanded(true)} onSearchChange={setSearchQuery} onClear={() => { setSearchQuery(""); setSearchExpanded(false); }} />
        </div>
      </SidebarTopRows>
      <nav aria-label="Mates" className="scroll-bounce min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4 noscrollbar">
        {!!error && <div className="px-2 py-3 text-xs text-danger">{errorText(error)}<Button variant="ghost" onClick={() => void refetch()}>Retry</Button></div>}
        {!overview && !error && <p className="px-2 py-3 text-xs text-primary-500">Loading mates…</p>}
        {overview && !visibleGroups.length && <p className="px-2 py-3 text-xs text-primary-500">{query ? "No matching mates" : "Your mates will appear here."}</p>}
        {visibleGroups.map(({ teamId, label, members }) => {
          const groupKey = assistantTeamGroupKey(backendId, account?.id ?? "", teamId);
          const rows = members.map(assistant => <AssistantItem key={assistant.id} assistant={assistant}
            working={isAssistantWorking(overview, assistant.id)} active={params.get("new") !== "1" && params.get("assistant") === assistant.id}
            open={open} onOpenDetails={() => open(`${assistantHref(assistant.id, params.get("assistant") === assistant.id ? params.get("run") : null)}&tab=profile`)} />);
          if (!showTeamHeadings) return <div key={groupKey} className="space-y-1.5">{rows}</div>;

          return (
            <section key={groupKey} aria-label={label}>
              <SidebarGroupSection key={query ? "search" : "browse"} groupKey={query ? undefined : groupKey}
                label={label} labelWeight="medium" count={members.length}>
                <div className="space-y-1.5 pt-1 pl-2">{rows}</div>
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

function AssistantItem({ assistant, working, active, open, onOpenDetails }: {
  assistant: Assistant; working: boolean; active: boolean; open(href: string): void; onOpenDetails(): void;
}) {
  return (
    <div>
      <SidebarItemHoverCard title={assistant.name} description={assistant.description} updatedAt={assistant.updatedAt} actions={[]}>
        <div className={`group/assistant flex items-center gap-2 rounded-2xl px-2.5 py-2.5 transition-colors ${active ? "glass-outline-soft glass-outline bg-primary/50 dark:bg-primary/5" : "hover:bg-primary/50 dark:hover:bg-primary/5"}`}>
          <AssistantMonogram avatar={assistant.avatar} name={assistant.name} providerId={assistant.providerId} working={working} onClick={onOpenDetails} />
          <Button variant="bare" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-current={active ? "page" : undefined} onClick={() => open(assistantHref(assistant.id))}>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Text as="span" size="s" weight="medium" className="truncate">{assistant.name}</Text>
              <span className="truncate text-xs text-primary-500">{assistant.description || assistant.spaceSnapshot.name}</span>
            </span>
          </Button>
        </div>
      </SidebarItemHoverCard>
    </div>
  );
}
