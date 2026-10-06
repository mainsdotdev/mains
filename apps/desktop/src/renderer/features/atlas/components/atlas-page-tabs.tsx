import { Button } from "@/components/ui";
import { Plus } from "@/components/ui/icons";
import { BaseTab } from "@/features/workspace/components/base-tab";
import { AtlasPageIcon } from "./atlas-page-icon";

export function AtlasPageTabs({ tabs, activeId, creating, onSelect, onClose, onNewPage }: {
  tabs: { id: string; title: string; icon?: string }[];
  activeId?: string;
  creating: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewPage: () => void;
}) {
  return <div className="-ml-3 flex min-w-0 items-end" role="tablist" aria-label="Atlas page tabs"
    onKeyDown={(event) => {
      if ((event.target as HTMLElement).getAttribute("role") !== "tab" || !tabs.length) return;
      const index = tabs.findIndex((tab) => `atlas-tab-${tab.id}` === (event.target as HTMLElement).id);
      const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
        : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
      if (next !== null) { event.preventDefault(); onSelect(tabs[next].id); }
    }}>
    <div className="relative flex min-w-0 items-end overflow-x-auto px-3 noscrollbar">
      {tabs.map((tab, index) => <BaseTab key={tab.id} isActive={tab.id === activeId} isFirst={index === 0}
        id={`atlas-tab-${tab.id}`} role="tab" ariaLabel={tab.title} ariaControls={`atlas-panel-${tab.id}`}
        tabIndex={tab.id === activeId || (!activeId && index === 0) ? 0 : -1}
        icon={<AtlasPageIcon icon={tab.icon} />} label={tab.title} tooltip={tab.title}
        onClick={() => onSelect(tab.id)} closeLabel={`Close ${tab.title}`}
        onClose={(event) => { event.stopPropagation(); onClose(tab.id); }} />)}
    </div>
    <Button variant="icon" disabled={creating} onClick={onNewPage} aria-label="New Atlas page tab" tooltip="New page" tooltipPosition="bottom"
      className="mb-1.5 mr-8 p-1! -ml-2 rounded-lg hover:bg-primary/5!"><Plus className="size-4.5" /></Button>
  </div>;
}
