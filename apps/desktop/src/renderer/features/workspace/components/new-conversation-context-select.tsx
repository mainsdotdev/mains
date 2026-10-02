import { useRef, useState } from "react";
import { Button, DropdownMenu, DropdownMenuItem, Input, Text } from "@/components/ui";
import { ArrowUp, Plus, ProjectFolder, Search } from "@/components/ui/icons";
import { ProjectIcon } from "@/components/layout/sidebar/project-icon";
import { useModeConfig } from "@/hooks/use-mode-config";
import {
  useGetAccountQuery,
  useListCollectionsQuery,
  useListProjectsQuery,
  useListWorkspacesQuery,
  useListWorkspaceGitStatesQuery,
  type Collection,
  type Workspace,
} from "@/lib/redux/api";
import type { NewConversationContext } from "../lib/ui-context";
import { requestCommandMenuQuickAction } from "@/features/command-menu/command-menu-bridge";

export function NewConversationContextSelect({
  workspace,
  project,
  onChange,
  disabled = false,
}: {
  workspace: Pick<Workspace, "id" | "name" | "projectId"> | null;
  project?: Pick<Collection, "id" | "name" | "icon">;
  onChange: (selection: NewConversationContext) => void;
  disabled?: boolean;
}) {
  const { mode } = useModeConfig();
  const isDeveloper = mode === "developer";
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<{ x: number; y: number; anchorTop: number } | null>(null);
  const { data: account } = useGetAccountQuery();
  const { data: collections = [], isLoading: loadingCollections } = useListCollectionsQuery(
    { accountId: account?.id ?? "" },
    { skip: isDeveloper || !account },
  );
  const { data: projects = [] } = useListProjectsQuery(undefined, { skip: !isDeveloper });
  const { data: workspaces = [], isLoading: loadingWorkspaces } = useListWorkspacesQuery(undefined, { skip: !isDeveloper });
  const { data: gitStates = [] } = useListWorkspaceGitStatesQuery(undefined, { skip: !isDeveloper });
  const projectById = new Map(projects.map((item) => [item.id, item]));
  const gitStateById = new Map(gitStates.map((item) => [item.workspaceId, item]));
  const workspaceName = (item: Pick<Workspace, "id" | "name">) => gitStateById.get(item.id)?.branch ?? item.name;
  const workspaceProject = workspace?.projectId ? projectById.get(workspace.projectId) : undefined;
  const label = isDeveloper
    ? workspace
      ? [workspaceProject?.name, workspaceName(workspace)]
          .filter((name, index, names) => name && names.indexOf(name) === index)
          .join(" / ")
      : "No workspace"
    : project?.name ?? "No project";
  const selectedProject = isDeveloper ? workspaceProject : project;
  const query = search.trim().toLocaleLowerCase();
  const matches = (name: string) => name.toLocaleLowerCase().includes(query);
  const workspaceLabel = (item: Workspace) => {
    const projectName = (item.projectId ? projectById.get(item.projectId)?.name : undefined) ?? item.name;
    const branch = gitStateById.get(item.id)?.branch ?? (item.name !== projectName ? item.name : null);
    return branch ? `${projectName} / ${branch}` : projectName;
  };
  const choices = isDeveloper ? workspaces.filter((item) => !item.isArchived && matches(workspaceLabel(item))) : [];
  const projectChoices = collections.filter((item) => !item.isArchived && matches(item.name));
  const showNoProject = !isDeveloper && matches("No project");

  const open = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    trigger.focus();
    setSearch("");
    const rect = trigger.getBoundingClientRect();
    setPosition({ x: rect.left, y: rect.bottom + 8, anchorTop: rect.top - 8 });
  };
  const select = (selection: NewConversationContext) => {
    setPosition(null);
    onChange(selection);
  };

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        disabled={disabled}
        aria-label={`${isDeveloper ? "Workspace" : "Project"}: ${label}`}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        className="flex max-w-full items-center gap-1.5 rounded-2xl px-2.5 py-1 text-s glass-card"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => position ? setPosition(null) : open()}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            open();
          }
        }}
      >
        <span className="shrink-0" aria-hidden="true">
          {selectedProject ? <ProjectIcon icon={selectedProject.icon} projectName={selectedProject.name} /> : <ProjectFolder className="size-4" />}
        </span>
        <span className="min-w-0 truncate">{label}</span>
        <ArrowUp aria-hidden="true" className="size-3.5 shrink-0 text-primary-500 rotate-180" />
      </Button>
      <DropdownMenu
        isOpen={position !== null && !disabled}
        position={position ?? { x: 0, y: 0 }}
        onClose={() => setPosition(null)}
        aria-label={isDeveloper ? "Select workspace" : "Select project"}
        openUpward
        origin="bottom-left"
        initialFocus="selected"
        initialFocusRef={searchRef}
        minWidth={240}
        className="w-72 max-w-[calc(100vw-1rem)]"
      >
        <div className="mx-2 mb-1 flex items-center gap-2 border-b border-primary-200 py-1 dark:border-primary-800">
          <Search aria-hidden="true" className="size-4 shrink-0 text-primary-500" />
          <Input
            ref={searchRef}
            variant="bare"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search projects"
            placeholder="Search projects"
            className="w-full py-1 text-s"
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.stopPropagation();
              listRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)')?.click();
            }}
          />
        </div>
        <div ref={listRef} style={{ maxHeight: Math.min(288, Math.max(32, (position?.anchorTop ?? 0) - 120)) }} className="overflow-y-auto noscrollbar space-y-0.5">
          {isDeveloper ? (
            <>
              {choices.map((item) => {
                const groupProject = item.projectId ? projectById.get(item.projectId) : undefined;
                return (
                  <DropdownMenuItem key={item.id} selected={item.id === workspace?.id}
                    indicator="none" className="px-2.5 py-1.5 gap-2"
                    disabled={gitStateById.get(item.id)?.pathExists === false}
                    onClick={() => select({ workspaceId: item.id })}>
                    <span aria-hidden="true" className="shrink-0"><ProjectIcon icon={groupProject?.icon ?? null} projectName={groupProject?.name ?? item.name} /></span>
                    <span className="min-w-0 truncate">{workspaceLabel(item)}</span>
                  </DropdownMenuItem>
                );
              })}
              {choices.length === 0 && <Text size="xs" tone="muted" className="px-1.5 py-2.5">{loadingWorkspaces ? "Loading workspaces…" : query ? "No matching projects or branches" : "No workspaces yet"}</Text>}
            </>
          ) : (
            <>
              {showNoProject && <DropdownMenuItem selected={!project} indicator="none" className="px-2.5 py-1.5 gap-2" onClick={() => select({ collectionId: null })}>
                <ProjectFolder aria-hidden="true" className="size-4 shrink-0" />
                No project
              </DropdownMenuItem>}
              {projectChoices.map((item) => (
                <DropdownMenuItem key={item.id} selected={item.id === project?.id} indicator="none" className="px-2.5 py-1.5 gap-2" onClick={() => select({ collectionId: item.id })}>
                  <span aria-hidden="true" className="shrink-0"><ProjectIcon icon={item.icon} projectName={item.name} /></span>
                  <span className="min-w-0 truncate">{item.name}</span>
                </DropdownMenuItem>
              ))}
              {loadingCollections && <Text size="xs" tone="muted" className="px-2 py-3">Loading projects…</Text>}
              {!loadingCollections && !showNoProject && projectChoices.length === 0 && <Text size="xs" tone="muted" className="px-2 py-3">No matching projects</Text>}
            </>
          )}
        </div>
        <div className="mt-1 border-t border-primary-200 pt-1 dark:border-primary-800">
          <DropdownMenuItem className="px-2.5 py-1.5 gap-2" onClick={() => {
            setPosition(null);
            requestCommandMenuQuickAction(isDeveloper ? "open-add-project" : "create-collection-project");
          }}>
            <Plus aria-hidden="true" className="size-4 shrink-0" />
            New project
          </DropdownMenuItem>
        </div>
      </DropdownMenu>
    </>
  );
}
