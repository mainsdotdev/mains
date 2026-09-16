import { useState } from "react";
import { Close, Plus, Search } from "@/components/ui/icons";
import { useGetPulsesQuery, type Pulse } from "@/lib/redux/api/pulseApi";
import { useModeConfig } from "@/hooks/use-mode-config";
import { PulseList } from "@/features/pulse/components/pulse-list";
import { PulseModal } from "@/features/pulse/components/pulse-modal";
import { PulseTemplates } from "@/features/pulse/components/pulse-templates";
import { matchesSearch } from "@/features/pulse/lib/match-search";
import {
  templatesForMode,
  type PulseTemplate,
} from "@/features/pulse/templates";
import { Button, Heading3, Input, Muted } from "@/components/ui";
import { PageShell } from "@/components/layout/page-shell";

export default function PulsePage() {
  const { data: pulses = [], isLoading } = useGetPulsesQuery();
  const { mode } = useModeConfig();
  const [query, setQuery] = useState("");
  const [editingPulse, setEditingPulse] = useState<Pulse | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<PulseTemplate | null>(
    null,
  );
  const [modalOpen, setModalOpen] = useState(false);

  const searching = query.trim().length > 0;
  const visiblePulses = pulses.filter((p) =>
    matchesSearch(query, p.title, p.prompt),
  );
  const visibleTemplates = templatesForMode(mode).filter((t) =>
    matchesSearch(query, t.title, t.description),
  );
  const noMatches =
    searching && visiblePulses.length === 0 && visibleTemplates.length === 0;

  const openCreate = () => {
    setEditingPulse(null);
    setActiveTemplate(null);
    setModalOpen(true);
  };

  const openTemplate = (tpl: PulseTemplate) => {
    setEditingPulse(null);
    setActiveTemplate(tpl);
    setModalOpen(true);
  };

  const openEdit = (pulse: Pulse) => {
    setEditingPulse(pulse);
    setActiveTemplate(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingPulse(null);
    setActiveTemplate(null);
  };

  return (
    <PageShell bottomPadded>
      <header className="flex items-start justify-between mb-6">
        <div>
          <Heading3>Pulse</Heading3>
          <Muted className="mt-1">
            Pulse keeps your work in motion with scheduled, automated runs.
          </Muted>
        </div>
        <Button
          type="button"
          variant="submit"
          onClick={openCreate}
          className="flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="size-4" />
          New Pulse
        </Button>
      </header>

      <div className="relative mb-10">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-4 -translate-y-1/2 text-primary-400" />
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.stopPropagation();
              setQuery("");
            }
          }}
          placeholder="Search pulses and suggestions"
          aria-label="Search pulses and suggestions"
          className={`w-full pl-10 ${query ? "pr-10" : "pr-4"} py-2 text-sm rounded-full bg-primary/40 dark:bg-primary/5 glass-outline`}
        />
        {query && (
          <Button
            onClick={() => setQuery("")}
            tooltip="Clear search"
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 z-10 -translate-y-1/2 p-1 rounded-lg text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-200 hover:bg-primary/50 dark:hover:bg-primary/10"
          >
            <Close className="size-3" />
          </Button>
        )}
      </div>

      {noMatches ? (
        <Muted className="px-1">Nothing matches “{query.trim()}”.</Muted>
      ) : (
        <div className="space-y-12">
          <PulseList
            pulses={visiblePulses}
            isLoading={isLoading}
            searching={searching}
            onEdit={openEdit}
          />
          <PulseTemplates templates={visibleTemplates} onSelect={openTemplate} />
        </div>
      )}

      <PulseModal
        isOpen={modalOpen}
        onClose={closeModal}
        pulse={editingPulse}
        initialTemplate={activeTemplate}
      />
    </PageShell>
  );
}
