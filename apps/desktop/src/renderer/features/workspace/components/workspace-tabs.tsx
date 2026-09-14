import { Plus, Note, Document } from "@/components/ui/icons";
import { RunTab, getTabTitle } from "./run-tab";
import { EditorTab } from "./editor-tab";
import { IssueTab } from "./issue-tab";
import { SignalTab } from "./signal-tab";
import { NoteTab } from "./note-tab";
import { BaseTab } from "./base-tab";
import type { Run } from "../types";
import type { IssueWithEntity, SignalWithEntity } from "@/lib/redux/api";
import type { ReviewTab as ReviewTabType } from "@/lib/redux/slices/workspaceSlice";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { LAYOUT_PANEL_ANIM_MS } from "@/lib/layout";
import { getProviderVariant } from "@/lib/provider-variants";
import { useAppSelector } from "@/lib/redux/hooks";
import { useIsMobile } from "@/lib/platform";
import { ProviderIcon } from "./provider-icon";
import { MobileTabSwitcher, type MobileTab } from "./mobile-tab-switcher";

const EMPTY_NOTE_TABS: ReviewTabType[] = [];

interface WorkspaceTabsProps {
  runs: Run[];
  activeTab: "editor" | string;
  hasSelectedFile?: boolean;
  fileName?: string;
  issueTabs: IssueWithEntity[];
  signalTabs?: SignalWithEntity[];
  noteTabs?: ReviewTabType[];
  onSelectEditorTab: () => void;
  onSelectRunTab: (runId: string) => void;
  onCloseTab: (runId: string) => void;
  onRenameRun: (runId: string, newTitle: string) => void;
  onNewRun: () => void;
  onSelectIssueTab: (entityId: string) => void;
  onCloseIssueTab: (entityId: string, e: React.MouseEvent) => void;
  onSelectSignalTab?: (entityId: string) => void;
  onCloseSignalTab?: (entityId: string, e: React.MouseEvent) => void;
  onSelectNoteTab?: (noteId: string) => void;
  onCloseNoteTab?: (noteId: string, e: React.MouseEvent) => void;
  onCloseEditorTab?: (e: React.MouseEvent) => void;
  showNewRunTab?: boolean;
  onSelectNewRunTab?: () => void;
  onCloseNewRunTab?: (e: React.MouseEvent) => void;
  variant?: "claude" | "copilot" | "codex" | "cursor";
}

export function WorkspaceTabs({
  runs,
  activeTab,
  hasSelectedFile,
  fileName,
  issueTabs,
  signalTabs = [],
  variant,
  noteTabs = EMPTY_NOTE_TABS,
  onSelectEditorTab,
  onSelectRunTab,
  onCloseTab,
  onRenameRun,
  onNewRun,
  onSelectIssueTab,
  onCloseIssueTab,
  onSelectSignalTab,
  onCloseSignalTab,
  onSelectNoteTab,
  onCloseNoteTab,
  onCloseEditorTab,
  showNewRunTab,
  onSelectNewRunTab,
  onCloseNewRunTab,
}: WorkspaceTabsProps) {
  const sidebarCollapsed = useAppSelector((state) => state.appSettings.sidebarCollapsed);
  const isMobile = useIsMobile();

  if (isMobile) {
    // Mirrors the previous ternary's final fallback (undefined → Codex).
    const { icon: MobileProviderIcon, accentClassName } = getProviderVariant(variant ?? "codex");
    const providerIcon = (
      <MobileProviderIcon className={cn("size-4", accentClassName)} />
    );
    const mobileTabs: MobileTab[] = [];
    if (hasSelectedFile) {
      mobileTabs.push({
        id: "editor",
        label: fileName || "Editor",
        icon: <Document className="size-4" />,
        group: "Editor",
        onSelect: onSelectEditorTab,
        onClose: onCloseEditorTab,
      });
    }
    issueTabs.forEach((it) => {
      const label =
        it.issue.number != null
          ? `#${it.issue.number} ${it.entity.title || ""}`
          : it.entity.title || "Issue";
      mobileTabs.push({
        id: `issue:${it.issue.entityId}`,
        label,
        icon: <ProviderIcon provider={it.issue.provider} />,
        group: "Issues",
        onSelect: () => onSelectIssueTab(it.issue.entityId),
        onClose: (e) => onCloseIssueTab(it.issue.entityId, e),
      });
    });
    signalTabs.forEach((s) => {
      mobileTabs.push({
        id: `signal:${s.signal.entityId}`,
        label: s.entity.title || "Signal",
        icon: <ProviderIcon provider={s.signal.source} />,
        group: "Signals",
        onSelect: () => onSelectSignalTab?.(s.signal.entityId),
        onClose: (e) => onCloseSignalTab?.(s.signal.entityId, e),
      });
    });
    noteTabs.forEach((n) => {
      mobileTabs.push({
        id: `note:${n.id}`,
        label: n.title,
        icon: <Note className="size-4" />,
        group: "Notes",
        onSelect: () => onSelectNoteTab?.(n.id),
        onClose: (e) => onCloseNoteTab?.(n.id, e),
      });
    });
    runs.forEach((r) => {
      mobileTabs.push({
        id: r.id,
        label: getTabTitle(r),
        icon: providerIcon,
        group: "Runs",
        onSelect: () => onSelectRunTab(r.id),
        onClose: () => onCloseTab(r.id),
      });
    });
    if (showNewRunTab) {
      mobileTabs.push({
        id: "new-run",
        label: "New Run",
        icon: providerIcon,
        group: "Runs",
        onSelect: () => onSelectNewRunTab?.(),
        onClose: (e) => onCloseNewRunTab?.(e),
      });
    }
    return (
      <MobileTabSwitcher
        tabs={mobileTabs}
        activeTab={activeTab}
        onNewRun={onNewRun}
      />
    );
  }

  return (
    <div className="flex items-end">
      <div
        className="relative flex-1 flex items-end overflow-x-auto noscrollbar"
        style={{
          // Clears the sidebar-toggle cluster once the sidebar is gone. Third
          // and last term of the strip's left edge (content margin + header
          // padding + this), so it runs on the same clock as the other two —
          // untransitioned it snapped 12px ahead of them.
          paddingLeft: sidebarCollapsed ? "0.75rem" : undefined,
          transition: `padding ${LAYOUT_PANEL_ANIM_MS}ms ease-out`,
        }}
      >
        {hasSelectedFile && (
          <EditorTab
            isActive={activeTab === "editor"}
            isFirst
            onClick={onSelectEditorTab}
            hasFile={hasSelectedFile}
            fileName={fileName}
            onClose={onCloseEditorTab}
          />
        )}

        {issueTabs.map((issue, i) => {
          const tabId = `issue:${issue.issue.entityId}`;
          return (
            <IssueTab
              key={tabId}
              issue={issue}
              isActive={activeTab === tabId}
              isFirst={!hasSelectedFile && i === 0}
              onClick={() => onSelectIssueTab(issue.issue.entityId)}
              onClose={(e) => onCloseIssueTab(issue.issue.entityId, e)}
            />
          );
        })}

        {signalTabs.map((signal, i) => {
          const tabId = `signal:${signal.signal.entityId}`;
          return (
            <SignalTab
              key={tabId}
              signal={signal}
              isActive={activeTab === tabId}
              isFirst={
                !hasSelectedFile &&
                issueTabs.length === 0 &&
                i === 0
              }
              onClick={() => onSelectSignalTab?.(signal.signal.entityId)}
              onClose={(e) => onCloseSignalTab?.(signal.signal.entityId, e)}
            />
          );
        })}

        {noteTabs.map((note, i) => {
          const tabId = `note:${note.id}`;
          return (
            <NoteTab
              key={tabId}
              review={note}
              isActive={activeTab === tabId}
              isFirst={
                !hasSelectedFile &&
                issueTabs.length === 0 &&
                signalTabs.length === 0 &&
                i === 0
              }
              onClick={() => onSelectNoteTab?.(note.id)}
              onClose={(e) => onCloseNoteTab?.(note.id, e)}
            />
          );
        })}

        {runs.map((run, i) => (
          <RunTab
            variant={variant}
            key={run.id}
            run={run}
            isActive={run.id === activeTab}
            isFirst={!hasSelectedFile && issueTabs.length === 0 && signalTabs.length === 0 && noteTabs.length === 0 && i === 0}
            onClick={() => onSelectRunTab(run.id)}
            onClose={() => onCloseTab(run.id)}
            onRename={(newTitle) => onRenameRun(run.id, newTitle)}
            title={getTabTitle(run)}
          />
        ))}
        {showNewRunTab && (
          <div className="animate-slide-in-left min-w-0">
            <NewRunTab
              variant={variant!}
              isActive={activeTab === "new-run"}
              onClick={() => onSelectNewRunTab?.()}
              onClose={(e) => onCloseNewRunTab?.(e)}
            />
          </div>
        )}
        <Button
          onClick={onNewRun}
          className="p-2.5 shrink-0 text-primary-900 ml-0.5 mb-0.5 mr-8 dark:text-primary-100  hover:text-primary-950 dark:hover:text-primary-100 hover:bg-primary/20 dark:hover:bg-primary/5  rounded-xl cursor-pointer transition-colors"
          title="New run"
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function NewRunTab({
  isActive,
  variant,
  onClick,
  onClose,
}: {
  isActive: boolean;
  variant: "copilot" | "claude" | "codex" | "cursor";
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
}) {
  const { icon: ProviderIcon, accentClassName } = getProviderVariant(variant);

  return (
    <BaseTab
      isActive={isActive}
      onClick={onClick}
      onClose={onClose}
      icon={<ProviderIcon className={cn( "size-4", accentClassName)} />}
      label="New Run"
    />
  );
}
