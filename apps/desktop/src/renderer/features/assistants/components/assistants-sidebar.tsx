import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Assistant } from "@mains/contracts/assistants";
import { Button, Text } from "@/components/ui";
import { Plus } from "@/components/ui/icons";
import NewButton from "@/components/layout/sidebar/new-button";
import SearchBar from "@/components/layout/sidebar/search-bar";
import { SidebarItemHoverCard } from "@/components/layout/sidebar/sidebar-item-hover-card";
import { useGetAccountQuery } from "@/lib/redux/api";
import { useAssistantOverviewQuery } from "@/lib/redux/api/assistantsApi";
import { useAppDispatch } from "@/lib/redux/hooks";
import { setSidebarCollapsed } from "@/lib/redux/slices/appSettingsSlice";
import { useIsMobile } from "@/lib/platform";
import { assistantHref } from "../lib/assistant-navigation";
import { AssistantMonogram } from "./assistant-monogram";
import { errorText, isAssistantWorking } from "../lib/assistant-ui";

export function AssistantsSidebar() {
  const { data: account } = useGetAccountQuery();
  const { currentData: overview, error, refetch } = useAssistantOverviewQuery(account?.id ?? "", { skip: !account });
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const mobile = useIsMobile();
  const open = (href: string) => {
    navigate(href);
    if (mobile) dispatch(setSidebarCollapsed(true));
  };
  const query = searchQuery.trim().toLocaleLowerCase();
  const assistants = overview?.assistants
    .filter(a => !a.isArchived && (!query || `${a.name} ${a.description}`.toLocaleLowerCase().includes(query)))
    .reverse() ?? [];
  return (
    <div className="flex h-full flex-col text-primary-900 dark:text-primary-100">
      <div className="relative mx-3 mb-2.5 mt-12 h-8 shrink-0 md:mt-2">
        <div inert={searchExpanded} className={`pr-9 transition-opacity duration-150 motion-reduce:transition-none ${searchExpanded ? "opacity-0" : "opacity-100"}`}>
          <NewButton title="mate" icon={<Plus className="size-3.5" />} onClick={() => { const next = new URLSearchParams(params); next.delete("tab"); next.set("new", "1"); open(`/assistants?${next}`); }} />
        </div>
        <div className={`absolute inset-y-0 right-0 flex items-center justify-end transition-[width] duration-200 ease-out motion-reduce:transition-none ${searchExpanded ? "w-full" : "w-8"}`}>
          <SearchBar isExpanded={searchExpanded} searchQuery={searchQuery} searchLabel="Search mates" onToggle={() => setSearchExpanded(true)} onSearchChange={setSearchQuery} onClear={() => { setSearchQuery(""); setSearchExpanded(false); }} />
        </div>
      </div>
      <nav aria-label="Mates" className="scroll-bounce min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-4 noscrollbar">
        {!!error && <div className="px-2 py-3 text-xs text-danger">{errorText(error)}<Button variant="ghost" onClick={() => void refetch()}>Retry</Button></div>}
        {!overview && !error && <p className="px-2 py-3 text-xs text-primary-500">Loading mates…</p>}
        {overview && !assistants.length && <p className="px-2 py-3 text-xs text-primary-500">{query ? "No matching mates" : "Your mates will appear here."}</p>}
        {assistants.map(assistant => <AssistantItem key={assistant.id} assistant={assistant}
          working={isAssistantWorking(overview, assistant.id)} active={params.get("new") !== "1" && params.get("assistant") === assistant.id}
          open={open} onOpenDetails={() => open(`${assistantHref(assistant.id, params.get("assistant") === assistant.id ? params.get("run") : null)}&tab=profile`)} />)}
      </nav>
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
