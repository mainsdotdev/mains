import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import fuzzysort from "fuzzysort";
import type { GlobalSearchResult } from "@mains/contracts/search";
import { isProviderId } from "@mains/contracts/provider-ids";
import { providerModes, type ModeId } from "@mains/contracts/modes";
import {
  Chat,
  Clock,
  Connect,
  Document,
  Enter,
  Mains,
  Plus,
  Project,
  ProjectFolder,
  Quit,
  Search,
  Settings,
  Sparkles,
  Sun,
  Terminal,
} from "@/components/ui/icons";
import { Modal } from "@/components/ui";
import { parseIcon, type IconComponent } from "@/lib/icon-registry";
import {
  useGetAccountQuery,
  useGetRunArtifactsQuery,
  useGetRunsQuery,
  useGlobalSearchQuery,
  useListCollectionsQuery,
  useListProjectsQuery,
} from "@/lib/redux/api";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  setBottomTerminalOpen,
} from "@/lib/redux/slices/appSettingsSlice";
import { isElectron, useCapabilities } from "@/lib/platform";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { useDocumentViewer } from "@/hooks/use-document-viewer";
import { selectSessionRunId } from "@/features/workspace/components/session-panel/select-session-run";
import { requestVisualizationFollowUp } from "@/features/workspace/lib/visualization-bridge";
import { MODE_CONFIGS } from "@/lib/mode-config";
import { classifyDocType } from "@/lib/document-viewer";
import { SETTINGS_MAIN_NAV_ITEMS } from "@/features/settings/settings-sections";
import { useCommandNavigation } from "./use-command-navigation";
import {
  OPEN_COMMAND_MENU_EVENT,
  requestCommandMenuQuickAction,
} from "./command-menu-bridge";
import { Bag, Code } from "@/components/ui/icons/space";

type IconTone = "neutral" | "blue" | "purple" | "amber";

interface MenuItemModel {
  id: string;
  title: string;
  subtitle?: string | null;
  detail?: string | null;
  keywords?: string;
  group?: GlobalSearchResult["kind"];
  icon: IconComponent;
  iconTone?: IconTone;
  projectIcon?: string;
  meta?: string;
  shortcut?: ReactNode;
  onSelect: () => unknown | Promise<unknown>;
}

const ICON_TONE_CLASSES: Record<IconTone, string> = {
  neutral: "bg-primary-600 text-primary-50 dark:bg-primary-800",
  blue: "bg-sky-600 text-primary-50 dark:bg-sky-700",
  purple: "bg-rose-600 text-primary-50 dark:bg-rose-500",
  amber: "bg-amber-600 text-primary-50 dark:bg-amber-500",
};

const PROJECT_ICON_BACKGROUND_CLASSES: Record<string, string> = {
  default: "bg-primary-700 dark:bg-primary-600",
  pink: "bg-pink-600 dark:bg-pink-500",
  red: "bg-red-500 dark:bg-red-400",
  orange: "bg-orange-500 dark:bg-orange-400",
  amber: "bg-amber-500 dark:bg-amber-400",
  green: "bg-lime-500 dark:bg-lime-400",
  blue: "bg-blue-500 dark:bg-blue-400",
  purple: "bg-indigo-500 dark:bg-indigo-400",
};

interface PendingDocument {
  runId: string;
  path: string;
  fileName: string;
  docType: NonNullable<ReturnType<typeof classifyDocType>>;
}

function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

function fuzzyFilter(
  items: MenuItemModel[],
  query: string,
  limit = 12,
): MenuItemModel[] {
  const trimmed = query.trim();
  if (!trimmed) return items.slice(0, limit);
  return fuzzysort
    .go(trimmed, items, {
      keys: ["title", "subtitle", "keywords"],
      threshold: 0.18,
      limit,
    })
    .map((result) => result.obj);
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function modeIcon(mode: ModeId): IconComponent {
  if (mode === "developer") return Code;
  if (mode === "work") return Bag;
  return Chat;
}

function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd className="flex h-5 min-w-5 items-center justify-center rounded-md glass-button px-1.5 font-sans text-xxs font-medium text-primary-700   dark:text-primary-200 ">
      {children}
    </kbd>
  );
}

function MenuIcon({ item }: { item: MenuItemModel }) {
  if (item.projectIcon) {
    const parsed = parseIcon(item.projectIcon);
    if (parsed.type === "icon") {
      const ProjectIcon = parsed.value;
      const backgroundClass =
        PROJECT_ICON_BACKGROUND_CLASSES[parsed.color ?? "default"] ??
        PROJECT_ICON_BACKGROUND_CLASSES.default;
      return (
        <span
          className={`flex size-6 shrink-0 items-center justify-center rounded-lg ${backgroundClass}`}
        >
          <ProjectIcon className="size-3.5 text-white" />
        </span>
      );
    }

    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-xs leading-none dark:bg-primary-700">
        {parsed.value}
      </span>
    );
  }

  const Icon = item.icon;
  return (
    <span
      className={`flex size-6 shrink-0 items-center justify-center rounded-lg ${ICON_TONE_CLASSES[item.iconTone ?? "neutral"]}`}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

function MenuRow({ item }: { item: MenuItemModel }) {
  return (
    <Command.Item
      value={item.id}
      onSelect={() => void item.onSelect()}
      className="group mx-1.5 flex min-h-9 cursor-default select-none items-center gap-3 rounded-xl px-2.5 py-1 text-primary-800 outline-none data-[selected=true]:bg-primary-950/5.5 dark:text-primary-100 dark:data-[selected=true]:bg-primary/5"
    >
      <MenuIcon item={item} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-s font-medium tracking-[-0.01em]">
            {item.title}
          </span>
          {item.subtitle && (
            <span className="truncate text-xs text-primary-500 dark:text-primary-400">
              {item.subtitle}
            </span>
          )}
        </span>
        {item.detail && (
          <span className="mt-0.5 block truncate text-xs text-primary-500 dark:text-primary-400">
            {item.detail}
          </span>
        )}
      </span>
      {item.meta && (
        <span className="max-w-28 shrink-0 truncate text-xxs text-primary-400 dark:text-primary-500">
          {item.meta}
        </span>
      )}
      {item.shortcut && (
        <span className="ml-1 flex shrink-0 items-center gap-1 opacity-75">
          {item.shortcut}
        </span>
      )}
      <Enter className="hidden size-3.5 shrink-0 text-primary-400 group-data-[selected=true]:block" />
    </Command.Item>
  );
}

function MenuGroup({
  heading,
  items,
}: {
  heading: string;
  items: MenuItemModel[];
}) {
  if (items.length === 0) return null;
  return (
    <Command.Group
      heading={heading}
      className="pb-1.5 **:[[cmdk-group-heading]]:px-4 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:pt-2.5 **:[[cmdk-group-heading]]:text-xxs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-primary-400 dark:**:[[cmdk-group-heading]]:text-primary-500"
    >
      <div className="space-y-1">
      {items.map((item) => (
        <MenuRow key={item.id} item={item} />
      ))}
      </div>
    </Command.Group>
  );
}

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pendingDocument, setPendingDocument] =
    useState<PendingDocument | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const documentViewer = useDocumentViewer();
  const { nativeDialogs } = useCapabilities();
  const { darkMode, toggleDarkMode } = useDarkMode();
  const { activeSpace } = useActiveSpace();
  const mode = activeSpace?.mode ?? "developer";
  const { newChat, openRun, openWorkspace, switchMode } =
    useCommandNavigation();
  const sessionRunId = useAppSelector((state) =>
    selectSessionRunId(state.workspace),
  );
  const bottomTerminalOpen = useAppSelector(
    (state) => state.appSettings.bottomTerminalOpen,
  );
  const { data: account } = useGetAccountQuery();
  const { data: recentRuns = [] } = useGetRunsQuery(10, { skip: !open });
  const { data: projects = [] } = useListProjectsQuery(undefined, {
    skip: !open || mode !== "developer",
  });
  const { data: collections = [] } = useListCollectionsQuery(
    { accountId: account?.id ?? "" },
    {
      skip: !open || mode === "developer" || !account?.id,
    },
  );
  const { data: runArtifacts = [] } = useGetRunArtifactsQuery(
    sessionRunId ?? "",
    { skip: !open || !sessionRunId },
  );

  const debouncedQuery = useDebouncedValue(query.trim(), 90);
  const shouldSearchRecords = open && debouncedQuery.length >= 2;
  const {
    currentData: searchResults = [],
    isFetching,
    isError: isSearchError,
  } = useGlobalSearchQuery(
    {
      query: debouncedQuery,
      accountId: account?.id,
      limitPerKind: 10,
    },
    { skip: !shouldSearchRecords },
  );

  const close = useCallback(() => setOpen(false), []);
  const openMenu = useCallback(() => {
    setQuery("");
    setOpen(true);
  }, []);
  const toggleMenu = useCallback(() => {
    if (open) close();
    else openMenu();
  }, [close, open, openMenu]);
  const runAndClose = useCallback(
    (action: () => unknown | Promise<unknown>) => async () => {
      close();
      await action();
    },
    [close],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        (!event.metaKey && !event.ctrlKey) ||
        !event.altKey ||
        event.shiftKey ||
        event.code !== "KeyK"
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      toggleMenu();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [toggleMenu]);

  useEffect(() => {
    if (!isElectron) return;
    const unsubscribe = window.api.browser.onShortcut(({ action }) => {
      if (action === "command-palette") toggleMenu();
    });
    return () => {
      unsubscribe();
    };
  }, [toggleMenu]);

  useEffect(() => {
    window.addEventListener(OPEN_COMMAND_MENU_EVENT, openMenu);
    return () => window.removeEventListener(OPEN_COMMAND_MENU_EVENT, openMenu);
  }, [openMenu]);

  useEffect(() => {
    if (!pendingDocument || sessionRunId !== pendingDocument.runId) return;
    const frame = requestAnimationFrame(() => {
      documentViewer.open({
        path: pendingDocument.path,
        fileName: pendingDocument.fileName,
        docType: pendingDocument.docType,
      });
      setPendingDocument(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [documentViewer, pendingDocument, sessionRunId]);

  const commands = useMemo<MenuItemModel[]>(() => {
    const items: MenuItemModel[] = [
      {
        id: "command:pulse",
        title: "Open Pulse",
        subtitle: "Automations",
        keywords: "pulse automation schedule suggestion",
        icon: Clock,
        onSelect: runAndClose(() => navigate("/pulse")),
      },
      {
        id: "command:theme",
        title: darkMode
          ? "Switch to light appearance"
          : "Switch to dark appearance",
        keywords: "theme appearance light dark theme",
        icon: Sun,
        onSelect: runAndClose(toggleDarkMode),
      },
    ];

    if (mode === "developer") {
      items.push({
        id: "command:terminal",
        title: bottomTerminalOpen ? "Close terminal" : "Open terminal",
        keywords: "terminal shell console toggle",
        icon: Terminal,
        onSelect: runAndClose(() =>
          dispatch(setBottomTerminalOpen(!bottomTerminalOpen)),
        ),
      });
    }

    if (activeSpace) {
      for (const targetMode of providerModes(activeSpace.providerId)) {
        if (targetMode === activeSpace.mode) continue;
        const config = MODE_CONFIGS[targetMode];
        items.push({
          id: `command:mode:${targetMode}`,
          title: `Switch to ${config.label}`,
          subtitle: config.description,
          keywords: `mode ${targetMode} ${config.label}`,
          icon: modeIcon(targetMode),
          onSelect: runAndClose(() => switchMode(targetMode)),
        });
      }
    }

    if (isElectron) {
      items.push({
        id: "command:quit",
        title: "Quit Mains",
        keywords: "quit exit close mains çıkış kapat",
        icon: Quit,
        meta: "Application",
        shortcut: <Keycap>⌘ Q</Keycap>,
        onSelect: runAndClose(() => window.api.app.quit()),
      });
    }
    return items;
  }, [activeSpace, bottomTerminalOpen, darkMode, dispatch, mode, navigate, runAndClose, switchMode, toggleDarkMode]);

  const quickActions = useMemo<MenuItemModel[]>(() => {
    const items: MenuItemModel[] = [
      {
        id: "quick:new-chat",
        title: "New chat",
        subtitle: MODE_CONFIGS[mode].label,
        keywords: "new conversation chat run sohbet yeni",
        icon: Chat,
        iconTone: "blue",
        onSelect: runAndClose(newChat),
      },
    ];

    if (mode === "developer") {
      if (nativeDialogs) {
        items.push({
          id: "quick:add-local-project",
          title: "Add project from local",
          keywords: "add open local folder repository project ekle klasör",
          icon: Plus,
          onSelect: runAndClose(() =>
            requestCommandMenuQuickAction("add-project-from-local"),
          ),
        });
      }
      items.push(
        {
          id: "quick:clone-project",
          title: "Clone from URL",
          keywords: "clone git url repository project remote",
          icon: Connect,
          iconTone: "purple",
          onSelect: runAndClose(() =>
            requestCommandMenuQuickAction("clone-project-from-url"),
          ),
        },
        {
          id: "quick:create-code-project",
          title: "Create new project",
          keywords: "create init repository project new yeni proje",
          icon: Project,
          iconTone: "blue",
          onSelect: runAndClose(() =>
            requestCommandMenuQuickAction("create-code-project"),
          ),
        },
      );
    } else {
      items.push({
        id: "quick:create-collection-project",
        title: "Create new project",
        keywords: "create collection project new yeni proje",
        icon: Project,
        iconTone: "blue",
        onSelect: runAndClose(() =>
          requestCommandMenuQuickAction("create-collection-project"),
        ),
      });
    }

    return items;
  }, [mode, nativeDialogs, newChat, runAndClose]);

  const settingsItems = useMemo<MenuItemModel[]>(
    () =>
      SETTINGS_MAIN_NAV_ITEMS.map((section) => ({
        id: `settings:${section.id}`,
        title: section.label,
        keywords: `settings preferences ${section.id} ${section.label} ayarlar`,
        icon: (section.icon ?? Settings) as IconComponent,
        meta: "Settings",
        onSelect: runAndClose(() =>
          navigate(`/settings?section=${section.id}`),
        ),
      })),
    [navigate, runAndClose],
  );

  const projectSettingsItems = useMemo<MenuItemModel[]>(() => {
    if (mode === "developer") {
      return projects.map((project) => ({
        id: `settings:project:${project.id}`,
        title: project.name,
        keywords: `project workspace repository settings ${project.name} ${project.rootPath}`,
        icon: ProjectFolder,
        projectIcon: project.icon ?? undefined,
        iconTone: "blue",
        meta: "Project settings",
        onSelect: runAndClose(() =>
          navigate(
            `/settings?section=projects&kind=code&id=${encodeURIComponent(project.id)}`,
          ),
        ),
      }));
    }

    return collections
      .filter((collection) => !collection.isArchived)
      .map((collection) => ({
        id: `settings:collection:${collection.id}`,
        title: collection.name,
        keywords: `project collection settings ${collection.name}`,
        icon: ProjectFolder,
        projectIcon: collection.icon ?? undefined,
        iconTone: "blue",
        meta: "Project settings",
        onSelect: runAndClose(() =>
          navigate(
            `/settings?section=projects&kind=collection&id=${encodeURIComponent(collection.id)}`,
          ),
        ),
      }));
  }, [collections, mode, navigate, projects, runAndClose]);

  const suggestions = useMemo<MenuItemModel[]>(() => {
    const seenPrompts = new Set<string>();
    const promptItems: MenuItemModel[] = [];
    for (const artifact of [...runArtifacts].reverse()) {
      if (artifact.kind !== "prompt_suggestion") continue;
      const prompt = artifact.content?.trim();
      if (!prompt || seenPrompts.has(prompt)) continue;
      seenPrompts.add(prompt);
      promptItems.push({
        id: `prompt:${artifact.id}`,
        title: prompt,
        subtitle: "Prompt suggestion",
        keywords: "prompt suggestion continue öneri devam",
        icon: Sparkles,
        iconTone: "blue",
        onSelect: runAndClose(() => requestVisualizationFollowUp({ prompt })),
      });
      if (promptItems.length === 3) break;
    }

    return promptItems;
  }, [runAndClose, runArtifacts]);

  const searchItem = useCallback(
    (result: GlobalSearchResult): MenuItemModel => {
      const icon =
        result.kind === "workspace"
          ? ProjectFolder
          : result.kind === "document"
            ? Document
            : Chat;
      const meta =
        result.kind === "workspace"
          ? "Workspace"
          : result.kind === "document"
            ? "Document"
            : result.snippet
              ? (result.subtitle ?? "Message")
              : "Chat";
      const onSelect = async () => {
        close();
        if (result.kind === "workspace" && result.workspaceId) {
          await openWorkspace(result.workspaceId);
          return;
        }
        if (result.kind === "document" && result.runId) {
          if (result.path) {
            const docType = classifyDocType(result.path);
            if (docType) {
              setPendingDocument({
                runId: result.runId,
                path: result.path,
                fileName: fileName(result.path),
                docType,
              });
            }
          }
          await openRun(result);
          return;
        }
        await openRun(result);
      };
      return {
        id: `result:${result.kind}:${result.id}`,
        title: result.title,
        subtitle: result.snippet ? null : result.subtitle,
        detail: result.snippet,
        group: result.kind,
        icon,
        iconTone:
          result.kind === "document"
            ? "amber"
            : result.kind === "workspace"
              ? "blue"
              : undefined,
        meta,
        onSelect,
      };
    },
    [close, openRun, openWorkspace],
  );

  const recordGroups = useMemo(() => {
    const mapped = searchResults.map(searchItem);
    return {
      workspaces: mapped.filter((item) => item.group === "workspace"),
      chats: mapped.filter((item) => item.group === "run"),
      documents: mapped.filter((item) => item.group === "document"),
    };
  }, [searchItem, searchResults]);

  const recentItems = useMemo<MenuItemModel[]>(() => {
    return recentRuns
      .filter((run) => isProviderId(run.providerId))
      .slice(0, 8)
      .map<MenuItemModel>((run) => ({
        id: `recent:run:${run.id}`,
        title:
          run.title?.trim() ||
          run.goal
            ?.split("\n")
            .find((line) => line.trim())
            ?.trim() ||
          "Untitled chat",
        subtitle: MODE_CONFIGS[run.mode].label,
        icon: Chat,
        meta: "Recent",
        onSelect: runAndClose(() =>
          openRun({
            id: run.id,
            kind: "run",
            title: run.title ?? "Untitled chat",
            subtitle: null,
            snippet: null,
            updatedAt: Number(run.updatedAt),
            workspaceId: run.workspaceId,
            runId: run.id,
            collectionId: run.collectionId,
            spaceId: run.spaceId,
            providerId: isProviderId(run.providerId) ? run.providerId : null,
            mode: run.mode,
            path: null,
          }),
        ),
      }));
  }, [openRun, recentRuns, runAndClose]);

  const filteredCommands = useMemo(
    () => fuzzyFilter(commands, query, 12),
    [commands, query],
  );
  const filteredQuickActions = useMemo(
    () => fuzzyFilter(quickActions, query, 8),
    [query, quickActions],
  );
  const filteredSettings = useMemo(
    () => fuzzyFilter(settingsItems, query, 12),
    [query, settingsItems],
  );
  const filteredProjectSettings = useMemo(
    () => fuzzyFilter(projectSettingsItems, query, 12),
    [projectSettingsItems, query],
  );
  const filteredSuggestions = useMemo(
    () => fuzzyFilter(suggestions, query, query ? 8 : 4),
    [query, suggestions],
  );
  const showingSearch = query.trim().length > 0;
  const visibleCount = showingSearch
    ? filteredCommands.length +
      filteredQuickActions.length +
      filteredSettings.length +
      filteredProjectSettings.length +
      filteredSuggestions.length +
      recordGroups.workspaces.length +
      recordGroups.chats.length +
      recordGroups.documents.length
    : commands.length +
      quickActions.length +
      settingsItems.length +
      projectSettingsItems.length +
      suggestions.length +
      recentItems.length;

  return (
    <Modal
      isOpen={open}
      onClose={close}
      aria-label="Search Mains and run commands"
      initialFocusRef={inputRef}
      placement="top"
      motion="command"
      surface="bare"
      className="command-menu-motion w-[min(44rem,calc(100vw-2rem))] overflow-visible"
    >
      <Command
        label="Search Mains"
        shouldFilter={false}
        loop
        className="flex min-h-0 flex-col gap-3 bg-transparent"
      >
        <div className="glass-surface flex h-14 shrink-0 items-center gap-3 rounded-3xl px-4">
          <Mains className="size-5 shrink-0 text-primary-500 dark:text-primary-400" />
          <Command.Input
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder="Search chats, workspaces, documents, and commands…"
            aria-label="Search"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-primary-950  placeholder:text-primary-400 dark:text-primary-50 dark:placeholder:text-primary-500"
          />
          {isFetching ? (
            <span
              className="size-3.5 animate-spin rounded-full border-2 border-primary-300 border-t-primary-700 dark:border-primary-700 dark:border-t-primary-200"
              aria-label="Searching"
            />
          ) : (
            <div className="flex items-center gap-1">
              <Keycap>esc</Keycap>
            </div>
          )}
        </div>

        <div className="glass-surface min-h-0 overflow-hidden rounded-3xl ">
          <Command.List
            aria-busy={isFetching}
            className="noscrollbar max-h-[min(31rem,62vh)] min-h-24 overflow-y-auto overscroll-contain py-1.5"
          >
            {visibleCount === 0 && !isFetching && (
              <div className="flex min-h-32 flex-col items-center justify-center px-8 text-center">
                <Search className="mb-3 size-5 text-primary-400" />
                <p className="text-s font-medium text-primary-700 dark:text-primary-200">
                  Nothing found
                </p>
                <p className="mt-1 text-xs text-primary-400 dark:text-primary-500">
                  Try a chat title, workspace, document, or command.
                </p>
              </div>
            )}

            {showingSearch && isSearchError && (
              <div className="mx-3 mb-1 rounded-xl border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
                Content search is temporarily unavailable. Commands still work.
              </div>
            )}

            {showingSearch ? (
              <>
                <MenuGroup heading="Workspaces" items={recordGroups.workspaces} />
                <MenuGroup heading="Chats" items={recordGroups.chats} />
                <MenuGroup heading="Documents" items={recordGroups.documents} />
                <MenuGroup
                  heading="Quick Actions"
                  items={filteredQuickActions}
                />
                <MenuGroup heading="Settings" items={filteredSettings} />
                <MenuGroup
                  heading="Projects"
                  items={filteredProjectSettings}
                />
                <MenuGroup heading="Suggestions" items={filteredSuggestions} />
                <MenuGroup heading="Commands" items={filteredCommands} />
              </>
            ) : (
              <>
                <MenuGroup heading="Recent Chats" items={recentItems} />
                <MenuGroup heading="Quick Actions" items={quickActions} />
                <MenuGroup heading="Settings" items={settingsItems} />
                <MenuGroup heading="Projects" items={projectSettingsItems} />
                <MenuGroup heading="Suggestions" items={suggestions} />
                <MenuGroup heading="Commands" items={commands} />
              </>
            )}
          </Command.List>
        </div>
      </Command>
    </Modal>
  );
}
