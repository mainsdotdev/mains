import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type {
  AtlasItem,
  AtlasLibraryEntry as Entry,
} from "@mains/contracts/atlas";
import { ATLAS_LIBRARY_PAGE_SIZE } from "@mains/contracts/atlas";
import { PageShell } from "@/components/layout/page-shell";
import {
  Button,
  DropdownMenuItem,
  DropdownMenuSub,
  HorizontalFadeScroller,
  Input,
  Muted,
  SegmentedTabs,
  Text,
  toast,
} from "@/components/ui";
import {
  Bridge,
  Chat,
  Close,
  Document,
  Download,
  Ellipsis,
  External,
  LibrarySquare,
  List,
  Grid,
  Page,
  Plan,
  Picture,
  Refresh,
  Search,
  Trash,
  Layers,
  ArrowUp,
  Generate,
  Settings,
} from "@/components/ui/icons";
import { Bookmark, Dna, Globe, Lightbulb, Rocket, Star } from "@/components/ui/icons/space";
import { useLazyGetAppsForFileQuery, useListCollectionsQuery } from "@/lib/redux/api";
import {
  useAtlasLibraryQuery,
  useCreateAtlasPageMutation,
  useUpdateAtlasItemMutation,
  useListAtlasTagsQuery,
  useEnrichAtlasBookmarkMutation,
} from "@/lib/redux/api/atlasApi";
import { useDocumentViewer } from "@/hooks/use-document-viewer";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { classifyDocType } from "@/lib/document-viewer";
import { appApi, getTransport } from "@/lib/transport";
import { useCapabilities } from "@/lib/platform";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useSpaceProviderVariant } from "@/hooks/use-space-provider-variant";
import { useAppDispatch } from "@/lib/redux/hooks";
import { updateAtlasPageChat } from "@/lib/redux/slices/atlasSlice";
import { useJumpToRun } from "@/features/workspace/hooks/use-jump-to-run";
import { useBridgeStatus } from "@/features/bridge/hooks/use-bridge";
import { bridgeBackend } from "@/features/bridge/lib/backends";
import { atlasError, useSaveToAtlas } from "../hooks/use-save-to-atlas";
import { useAtlasSearch } from "../hooks/use-atlas-search";
import {
  ATLAS_TYPES,
  atlasView,
  atlasImageCreatorHref,
  type AtlasScope,
} from "../lib/atlas-navigation";
import { ATLAS_TEMPLATES } from "../lib/atlas-templates";
import { AtlasMenu } from "./atlas-menu";
import { AtlasFileIcon } from "./atlas-file-icon";
import { AtlasPageCard } from "./atlas-page-card";
import { resolveReplicaFile, useAtlasFilePath } from "../hooks/use-atlas-file-path";
import { AtlasImagePreview } from "./atlas-image-preview";
import { useAtlasOwnerKey } from "../hooks/use-atlas-tabs";
import { AtlasBookmarkEditor } from "./atlas-bookmark-editor";
import { openAtlasBookmark } from "../lib/bookmark-modal-bridge";
import { AtlasBookmarkCard } from "./atlas-bookmark-card";
import { AtlasItemRow } from "./atlas-item-row";
import { AtlasItemTags } from "./atlas-item-tags";
import { AtlasTagEditor } from "./atlas-tag-editor";
import { AtlasOrganization } from "./atlas-organization";

const templateIcons = [
  { Icon: Document, color: "text-blue-600 dark:text-blue-400" },
  { Icon: Dna, color: "text-emerald-600 dark:text-emerald-400" },
  { Icon: Plan, color: "text-violet-600 dark:text-violet-400" },
  { Icon: Rocket, color: "text-orange-600 dark:text-orange-400" },
  { Icon: Lightbulb, color: "text-red-600 dark:text-red-400" },
];
const templateCardClass =
  "glass-surface flex min-h-24 min-w-48 flex-1 flex-col items-start justify-center gap-3 rounded-3xl px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-accent/40";

function activity(date: string) {
  const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(date).toLocaleDateString();
}

/** `device` names the other device whose conversation holds this file. */
function ImageTile({ entry, onOpen, fill = false, device }: { entry: Entry; onOpen: () => void; fill?: boolean; device?: string | null }) {
  const path = useAtlasFilePath(entry.saved?.accountId, entry.saved?.id, entry.path, entry.generated);
  const src = useLocalImageUrl(path ?? "", 768, entry.date);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return (
    <>
      <Button
        onClick={onOpen}
        aria-label={`Open ${entry.title}`}
        className={`block w-full overflow-hidden bg-primary-100 focus-visible:ring-2 focus-visible:ring-accent/60 dark:bg-primary-900 ${fill ? "relative aspect-square h-full focus-visible:ring-inset" : "rounded-t-xl"}`}
      >
        {src && src !== failedSrc ? (
          <img
            src={src}
            onError={() => setFailedSrc(src)}
            alt={entry.title}
            loading="lazy"
            decoding="async"
            className={fill ? "absolute inset-0 size-full object-cover" : "block h-auto w-full"}
          />
        ) : (
          <span className={`flex items-center justify-center ${fill ? "absolute inset-0" : "aspect-4/3"}`}>
            <Picture className="size-8 text-primary-400" />
          </span>
        )}
      </Button>
      {device && (
        <span className="pointer-events-none absolute left-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary-950/75 text-primary-100">
          <Bridge aria-hidden="true" className="size-3.75" />
          <span className="sr-only">From {device}</span>
        </span>
      )}
    </>
  );
}

export function AtlasLibrary({ accountId }: { accountId: string }) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const ownerKey = useAtlasOwnerKey(accountId);
  const provider = useSpaceProviderVariant();
  const ProviderIcon = provider.icon;
  const { activeSpace, spaces } = useActiveSpace();
  const providerSpaces = spaces.filter(
    (space) =>
      space.accountId === accountId &&
      space.providerId === provider.providerId,
  );
  const creationSpace =
    activeSpace?.accountId === accountId && activeSpace.providerId === provider.providerId
      ? activeSpace
      : providerSpaces[0];
  const creatingPage = useRef(false);
  const [params, setParams] = useSearchParams();
  const { type, scope, collectionId } = atlasView(params);
  const [searchValue, setSearchValue] = useAtlasSearch();
  const rawPage = Number(params.get("page") ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 100000 ? rawPage : 1;
  const [preview, setPreview] = useState<Entry | null>(null);
  const [bookmarkEditor, setBookmarkEditor] = useState<AtlasItem | null>(null);
  const [tagEditor, setTagEditor] = useState<AtlasItem | null>(null);
  const [managingTags, setManagingTags] = useState(false);
  const { data: tags = [] } = useListAtlasTagsQuery({ accountId });
  const [enrichBookmark] = useEnrichAtlasBookmarkMutation();
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const previousPage = useRef(page);
  const grid = params.get("layout") === "grid" || (type === "image" || type === "bookmark") && params.get("layout") !== "list";
  const library = useAtlasLibraryQuery({
    accountId, type, scope, page,
    collectionId: collectionId || undefined,
    query: params.get("q") || undefined,
    tagId: params.get("tag") || undefined,
    ...(grid && (type === "page" || type === "all") ? { includePagePreview: true } : {}),
  }, { pollingInterval: 15000 });
  const entries = library.currentData?.items ?? [];
  const previewImagePaths = useMemo(() => new Map(Object.entries(library.currentData?.previewImages ?? {})), [library.currentData]);
  useEffect(() => {
    if (previousPage.current !== page) resultsRef.current?.scrollIntoView?.({ block: "start" });
    previousPage.current = page;
  }, [page]);
  useEffect(() => {
    if (!library.currentData || library.currentData.page === page) return;
    const next = new URLSearchParams(params);
    if (library.currentData.page > 1) next.set("page", String(library.currentData.page));
    else next.delete("page");
    setParams(next, { replace: true });
  }, [library.currentData, page, params, setParams]);
  const { data: collections = [] } = useListCollectionsQuery({ accountId });
  const [createPage, creating] = useCreateAtlasPageMutation();
  const [update, updating] = useUpdateAtlasItemMutation();
  const { save, saving } = useSaveToAtlas();
  const { open } = useDocumentViewer();
  const { openWithApp } = useCapabilities();
  const [fetchApps, { currentData: handlerApps = [], isFetching: appsLoading, originalArgs: appsPath }] =
    useLazyGetAppsForFileQuery();
  const jumpToRun = useJumpToRun();
  const { data: bridgeStatus } = useBridgeStatus();
  const deviceOf = (entry: Entry) => !entry.saved && entry.generated?.replica
    ? bridgeBackend(bridgeStatus, entry.generated.replica.backendId).label : null;
  const originLabel = (entry: Entry) => {
    if (entry.saved) return "Saved to Atlas";
    if (entry.generated?.origin !== "attachment") return "Generated";
    const device = deviceOf(entry);
    return device ? `Uploaded on ${device}` : "Uploaded";
  };
  const focusSearch = params.get("focus") === "search";
  useEffect(() => {
    if (focusSearch) searchRef.current?.focus();
  }, [focusSearch]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete("focus");
    if (key !== "page" && key !== "layout") next.delete("page");
    if (value && !(key === "page" && value === "1") && !(["view", "type"].includes(key) && value === "all"))
      next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const change = async (
    item: AtlasItem,
    fields: { trashed?: boolean; isFavorite?: boolean },
  ) => {
    try {
      await update({ accountId, id: item.id, ...fields }).unwrap();
    } catch (error) {
      toast.error(atlasError(error));
    }
  };
  const newPage = async (
    template?: (typeof ATLAS_TEMPLATES)[number],
    chat?: { draft: string; spaceId: string | null },
  ) => {
    if (creatingPage.current) return;
    creatingPage.current = true;
    const transport = getTransport();
    try {
      const page = await createPage({
        accountId,
        title: template?.title ?? "Untitled page",
        markdown: template?.markdown,
        collectionId: collectionId || null,
      }).unwrap();
      if (getTransport() !== transport) return;
      if (chat)
        dispatch(
          updateAtlasPageChat({
            ownerKey,
            id: page.item.id,
            patch: { ...chat, mode: "details" },
          }),
        );
      navigate(`/atlas/${page.item.id}`);
    } catch (error) {
      toast.error(atlasError(error));
    } finally {
      creatingPage.current = false;
    }
  };
  const resolvePath = async (entry: Entry) => {
    if (!entry.saved && entry.generated?.replica) return resolveReplicaFile(entry.generated.runId, entry.generated.replica);
    if (!entry.saved) return entry.path;
    const response = await appApi.atlas.resolveFile({ accountId: entry.saved.accountId, id: entry.saved.id });
    if (!response.success) throw new Error(response.error ?? "File unavailable");
    return response.data as string;
  };
  const show = (entry: Entry) => {
    if (entry.kind === "bookmark" && entry.saved?.url) {
      void window.api.shell.openExternal(entry.saved.url).catch((error: unknown) => toast.error(atlasError(error)));
      return;
    }
    if (entry.kind === "page") {
      navigate(`/atlas/${entry.key}`);
      return;
    }
    if (entry.kind === "image") {
      setPreview(entry);
      return;
    }
    void (async () => {
      const path = await resolvePath(entry);
      if (path) open({ path, fileName: entry.saved?.fileName ?? entry.title,
        docType: classifyDocType(path, true) ?? "md",
        byteSize: entry.generated?.byteSize ?? entry.saved?.byteSize ?? undefined });
    })().catch((error: unknown) => toast.error(atlasError(error)));
  };
  const source = async (entry: Entry) => {
    const runId = entry.generated?.runId ?? entry.saved?.sourceRunId;
    if (!runId) return;
    try {
      const response = await appApi.runs.getById(runId);
      if (response.success && response.data) await jumpToRun(response.data);
      else toast.error("Source conversation is no longer available");
    } catch (error) {
      toast.error(atlasError(error));
    }
  };
  const saveCopy = async (entry: Entry) => {
    if (!entry.path && !entry.generated?.replica) return;
    try {
      const response = await appApi.fileExplorer.saveFileAs(
        (await resolvePath(entry))!,
        entry.saved?.fileName ?? entry.title,
      );
      if (!response.success)
        toast.error(response.error ?? "Could not save a copy");
      else if (response.data) toast.success("Copy saved");
    } catch (error) {
      toast.error(atlasError(error));
    }
  };
  const openWith = async (path: string, bundleId: string) => {
    try {
      const response = await window.api.shell.openFileWithBundle(path, bundleId);
      if (!response.success) toast.error(response.error ?? "Could not open file");
    } catch (error) {
      toast.error(atlasError(error));
    }
  };
  const itemMenu = (entry: Entry, image = false) => (
    <AtlasMenu
      label={`Actions for ${entry.title}`}
      className={`size-7 rounded-full ${image ? "bg-primary-950/75 text-primary-100 hover:bg-primary-950" : "text-primary-500 hover:bg-primary-200/60 dark:hover:bg-primary-800"}`}
      trigger={<Ellipsis className="size-4" />}
      menuClassName={entry.path ? "w-72" : undefined}
      scrollable={!!entry.path}
      onOpen={() => {
        if (entry.path && openWithApp) void fetchApps(entry.path, true);
      }}
    >
      {(close) => (
        <>
          <DropdownMenuItem
            onClick={() => {
              close();
              show(entry);
            }}
          >
            <Page className="size-4" />
            Open
          </DropdownMenuItem>
          {entry.saved && !entry.saved.trashedAt && (
            <DropdownMenuItem onClick={() => { close(); setTagEditor(entry.saved!); }}>
              <Bookmark className="size-4" />{entry.saved.tags?.length ? "Edit tags" : "Add tags"}
            </DropdownMenuItem>
          )}
          {/* Another device's file is saved to Atlas from that device. */}
          {entry.kind === "bookmark" && entry.saved && <>
            <DropdownMenuItem onClick={() => { close(); setBookmarkEditor(entry.saved!); }}><Document className="size-4" />Edit bookmark</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { close(); void navigator.clipboard.writeText(entry.saved!.url ?? "").catch((error) => toast.error(atlasError(error))); }}><External className="size-4" />Copy link</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { close(); void enrichBookmark({ accountId, id: entry.saved!.id }).unwrap().catch((error) => toast.error(atlasError(error))); }}><Refresh className="size-4" />Refresh details and tags</DropdownMenuItem>
          </>}
          {entry.generated && !entry.saved && !entry.generated.replica && (
            <DropdownMenuItem
              disabled={saving}
              onClick={() => {
                close();
                void save(entry.generated!.runId, entry.path!);
              }}
            >
              <Globe className="size-4" />
              Save to Atlas
            </DropdownMenuItem>
          )}
          {(entry.path || entry.generated?.replica) && (
            <DropdownMenuItem
              onClick={() => {
                close();
                void saveCopy(entry);
              }}
            >
              <Download className="size-4" />
              Save a copy
            </DropdownMenuItem>
          )}
          {(entry.generated?.runId || entry.saved?.sourceRunId) && (
            <DropdownMenuItem
              onClick={() => {
                close();
                void source(entry);
              }}
            >
              <Chat className="size-4" />
              Open chat
            </DropdownMenuItem>
          )}
          {entry.path && openWithApp && appsPath === entry.path && (
            appsLoading ? (
              <Text as="div" size="xs" tone="subtle" className="px-3 py-2">
                Loading applications…
              </Text>
            ) : handlerApps.map((app) => (
              <DropdownMenuItem
                key={app.bundleId}
                onClick={() => {
                  close();
                  void openWith(entry.path!, app.bundleId);
                }}
              >
                {app.icon ? (
                  <img src={app.icon} alt="" draggable={false} className="size-4 shrink-0 rounded-sm" />
                ) : (
                  <External className="size-4 shrink-0 opacity-70" />
                )}
                <span className="min-w-0 flex-1 truncate text-left" title={`Open with ${app.name}`}>
                  Open with {app.name}
                </span>
              </DropdownMenuItem>
            ))
          )}
          {entry.saved && (
            <>
              <DropdownMenuItem
                disabled={updating.isLoading}
                onClick={() => {
                  close();
                  void change(entry.saved!, {
                    isFavorite: !entry.saved!.isFavorite,
                  });
                }}
              >
                <Star filled={entry.saved.isFavorite} className="size-4" />
                {entry.saved.isFavorite
                  ? "Remove from favorites"
                  : "Add to favorites"}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="danger"
                onClick={() => {
                  close();
                  void change(entry.saved!, { trashed: true });
                }}
              >
                <Trash className="size-4" />
                Move to Trash
              </DropdownMenuItem>
            </>
          )}
        </>
      )}
    </AtlasMenu>
  );
  const imageCard = (entry: Entry) => (
    <article key={entry.key} className="group relative mb-4 min-w-0 break-inside-avoid overflow-hidden rounded-xl glass-surface">
      <div className="relative">
        <ImageTile entry={entry} onOpen={() => show(entry)} device={deviceOf(entry)} />
        <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{itemMenu(entry, true)}</div>
      </div>
      <div className="px-3 py-2.5">
        <p className="mb-1 truncate text-s font-medium text-primary-900 dark:text-primary-100">{entry.title}</p>
        <AtlasItemTags tags={entry.saved?.tags ?? []} onTag={(id) => setFilter("tag", id)} />
        <div className={`mt-1 flex min-w-0 items-center gap-1 text-xxs text-primary-500 ${entry.saved?.isFavorite ? "pr-7" : ""}`}>
          {!entry.saved && entry.generated && entry.generated.origin !== "attachment" && <Generate aria-hidden="true" className="size-3 shrink-0" />}
          <span className="min-w-0 truncate">{originLabel(entry)}</span><span aria-hidden="true">·</span><span className="shrink-0">{activity(entry.date)}</span>
        </div>
      </div>
      {entry.saved?.isFavorite && <Star filled role="img" aria-label="Favorite" className="pointer-events-none absolute bottom-3 right-3 size-3.5 text-accent" />}
    </article>
  );
  const scopes: { value: AtlasScope; label: string }[] = [
    { value: "all", label: "All" },
    ...(type === "image"
      ? [{ value: "generated" as const, label: "Your creations" }]
      : []),
    ...(type !== "page" && type !== "bookmark"
      ? [{ value: "uploads" as const, label: "Uploads" }]
      : []),
    { value: "favorites", label: "Favorites" },
    ...(type !== "page" && type !== "bookmark"
      ? [{ value: "saved" as const, label: "Saved to Atlas" }]
      : []),
    ...(type === "all" || type === "file"
      ? [{ value: "generated" as const, label: "Generated" }]
      : []),
  ];
  const project = collections.find((item) => item.id === collectionId);
  const title = type === "all" && project
    ? project.name
    : ATLAS_TYPES.find((item) => item.value === type)!.label;
  const loading = library.isFetching && !library.currentData;
  const error = library.error;

  return (
    <PageShell
      className="atlas-library flex min-h-0 max-w-360 flex-col overflow-hidden px-0 pt-0"
    >
      <div className="shrink-0 px-6 pt-8 md:px-12 md:pt-10 xl:px-16">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight text-primary-900 dark:text-primary-100">
            {title}
          </h1>
          <div className="ml-auto flex items-center gap-2.5">
            <Button variant="icon" aria-label="Atlas settings" tooltip="Atlas settings"
              onClick={() => navigate("/settings?section=atlas")}>
              <Settings className="size-4" />
            </Button>
            <div
              className="mr-1 hidden items-center gap-1 sm:flex"
              role="group"
              aria-label="Library layout"
            >
              {[true, false].map((value) => (
                <Button
                  variant="icon"
                  key={String(value)}
                  aria-label={value ? "Grid view" : "List view"}
                  aria-pressed={grid === value}
                  className={`flex size-8 items-center justify-center  text-primary-500 focus-visible:ring-2 focus-visible:ring-accent/40 ${grid === value ? "bg-primary-200/70 dark:bg-primary-800/20" : "hover:bg-primary-100 dark:hover:bg-primary-900"}`}
                  onClick={() => setFilter("layout", value ? "grid" : "list")}
                >
                  {value ? (
                    <Grid className="size-4" />
                  ) : (
                    <List className="size-4" />
                  )}
                </Button>
              ))}
            </div>
            <div className="relative w-40 sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-2 size-3.5 text-primary-500" />
              <Input
                ref={searchRef}
                variant="bare"
                aria-label="Search Atlas"
                placeholder="Search"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                className="h-8 w-full rounded-full glass-input  pl-8 pr-3 text-xs "
              />
            </div>
            {type === "bookmark" ? (
              <Button variant="primary" className="inline-flex gap-2" onClick={() => openAtlasBookmark({ accountId, collectionId: collectionId || undefined })}>
                <Bookmark aria-hidden="true" className="size-4" />
                Add bookmark
              </Button>
            ) : type === "image" && provider.supportsAtlas ? (
              <Button
                aria-label="New image"
                variant="primary"
                className="inline-flex gap-2"
                onClick={() => navigate(atlasImageCreatorHref(collectionId))}
              >
                <Picture aria-hidden="true" className="size-4" />
                New image
              </Button>
            ) : (
              <AtlasMenu
                label="New Atlas item"
                disabled={creating.isLoading}
                className="text-primary-700 dark:text-primary-300 glass-primary px-3 py-1.5 text-s rounded-xl gap-1"
                trigger={
                  <>
                    New
                    <ArrowUp className="size-3 rotate-180" />
                  </>
                }
              >
                {(close) => (
                  <>
                    <DropdownMenuItem onClick={() => { close(); openAtlasBookmark({ accountId, collectionId: collectionId || undefined }); }}><Bookmark className="size-4" />New bookmark</DropdownMenuItem>
                    {type === "all" && provider.supportsAtlas && <DropdownMenuItem
                      onClick={() => { close(); navigate(atlasImageCreatorHref(collectionId)); }}>
                      <Picture className="size-4" />New image
                    </DropdownMenuItem>}
                    {provider.supportsAtlas && <><DropdownMenuItem
                      onClick={() => {
                        close();
                        void newPage();
                      }}
                    >
                      <Page className="size-4" />
                      Blank page
                    </DropdownMenuItem>
                    {ATLAS_TEMPLATES.map((template, index) => {
                      const { Icon, color } = templateIcons[index];
                      return (
                        <DropdownMenuItem
                          key={template.title}
                          onClick={() => {
                            close();
                            void newPage(template);
                          }}
                        >
                          <Icon className={`size-4 ${color}`} />
                          {template.title}
                        </DropdownMenuItem>
                      );
                    })}</>}
                  </>
                )}
              </AtlasMenu>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {!!scopes.length && (
            <SegmentedTabs
              value={scope}
              semantics="radiogroup"
              aria-label="Atlas view"
              variant="plain"
              options={scopes}
              className="text-xs"
              onChange={(value) => setFilter("view", value)}
            />
          )}
          <AtlasMenu
            label="Filter Atlas"
            variant="filter"
            className={(open) => `ml-auto ${open || project || params.get("tag") ? "bg-primary/80 dark:bg-primary/10 glass-outline text-primary-900 dark:text-primary-100" : ""}`}
            trigger={<Layers className="w-3.5 h-3.5" />}
          >
            {(close) => (
              <>
                <DropdownMenuSub label={<>Tag{params.get("tag") ? ` · ${tags.find((tag) => tag.id === params.get("tag"))?.name ?? "Selected"}` : ""}</>}>
                  <DropdownMenuItem selected={!params.get("tag")} onClick={() => { close(); setFilter("tag", ""); }}>All tags</DropdownMenuItem>
                  {tags.map((tag) => <DropdownMenuItem key={tag.id} selected={params.get("tag") === tag.id} onClick={() => { close(); setFilter("tag", tag.id); }}>{tag.name} <span className="ml-auto text-xs text-primary-500">{tag.count}</span></DropdownMenuItem>)}
                </DropdownMenuSub>
                <DropdownMenuSub
                  label={<>Project{project ? ` · ${project.name}` : ""}</>}
                >
                  <DropdownMenuItem
                    selected={!collectionId}
                    onClick={() => {
                      close();
                      setFilter("project", "");
                    }}
                  >
                    All projects
                  </DropdownMenuItem>
                  {collections.map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      selected={collectionId === item.id}
                      onClick={() => {
                        close();
                        setFilter("project", item.id);
                      }}
                    >
                      {item.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSub>
                <DropdownMenuItem onClick={() => { close(); setManagingTags(true); }}><Bookmark className="size-4" />Manage tags</DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    close();
                    void library.refetch();
                  }}
                >
                  <Refresh className="size-4" />
                  Refresh
                </DropdownMenuItem>
              </>
            )}
          </AtlasMenu>
        </div>
      </div>
      {params.get("tag") && <div className="shrink-0 px-6 pt-4 md:px-12 xl:px-16">
        <Button aria-label="Clear tag filter" className="inline-flex max-w-full items-center gap-2 rounded-full glass-outline px-3 py-1 text-xs text-primary-600 focus-visible:ring-2 focus-visible:ring-accent/40 dark:text-primary-300" onClick={() => setFilter("tag", "")}>
          <span className="min-w-0 truncate">Tag: {tags.find((tag) => tag.id === params.get("tag"))?.name ?? "Selected"}</span>
          <Close aria-hidden="true" className="size-3 shrink-0" />
        </Button>
      </div>}
      <div className="scroll-bounce min-h-0 flex-1 overflow-y-auto noscrollbar px-6 pt-8 pb-16 md:px-12 xl:px-16 mask-[linear-gradient(to_bottom,transparent,black_1.75rem)]">
        {provider.supportsAtlas && type === "all" && scope === "all" && !params.get("tag") && !searchValue && page === 1 && (
          <section className="mb-10" aria-label="Start a page">
            <Text size="sm" weight="medium" className="mb-4">
              Start a page
            </Text>
            <HorizontalFadeScroller
              arrows
              className="pb-2"
              contentClassName="flex min-w-full w-max gap-3"
            >
              <Button
                disabled={creating.isLoading}
                onClick={() =>
                  void newPage(undefined, {
                    draft: "Create a page about ",
                    spaceId: creationSpace?.id ?? null,
                  })
                }
                className={templateCardClass}
              >
                <ProviderIcon className="size-4 shrink-0 text-primary-800 dark:text-primary-200" />
                <span className="whitespace-nowrap text-s text-primary-800 dark:text-primary-200">
                  Create page with {provider.label}
                </span>
              </Button>
              {ATLAS_TEMPLATES.map((template, index) => {
                const { Icon, color } = templateIcons[index];
                return (
                  <Button
                    key={template.title}
                    disabled={creating.isLoading}
                    onClick={() => void newPage(template)}
                    className={templateCardClass}
                  >
                    <Icon className={`size-5 ${color}`} />
                    <span className="whitespace-nowrap text-s text-primary-800 dark:text-primary-200">
                      {template.title}
                    </span>
                  </Button>
                );
              })}
            </HorizontalFadeScroller>
          </section>
        )}
        <div ref={resultsRef} className="scroll-mt-8" />
        {!!error && (
          <Text className="mb-4" role="alert">
            {atlasError(error)}
          </Text>
        )}
        {loading ? (
          <Muted className="py-16 text-center">Loading your items…</Muted>
        ) : !entries.length ? (
          <div className="flex flex-col items-center py-24 text-center">
            {!searchValue && scope === "favorites" ? (
              <Star className="mb-5 size-10 text-primary-400" />
            ) : !searchValue && scope === "generated" ? (
              <Generate className="mb-5 size-10 text-primary-400" />
            ) : !searchValue && scope === "uploads" ? (
              <ArrowUp className="mb-5 size-10 text-primary-400" />
            ) : type === "image" ? (
              <Picture className="mb-5 size-10 text-primary-400" />
            ) : (
              <LibrarySquare className="mb-5 size-10 text-primary-400" />
            )}
            <Text weight="medium">
              {searchValue
                ? "No matching items"
                : scope === "favorites"
                    ? "No favorites yet"
                    : scope === "uploads"
                      ? "No uploads yet"
                    : `No ${type === "all" ? "items" : title.toLowerCase()} yet`}
            </Text>
            <Muted className="mt-2 max-w-sm px-4">
              {searchValue
                ? "Try a different search or project."
                : scope === "favorites"
                    ? "Add an item to favorites from its menu."
                    : scope === "uploads"
                      ? "Files attached to your conversations will appear here."
                    : type === "bookmark" ? "Save a link. Atlas will fetch its preview and organize it with your chosen model."
                    : type === "page" || type === "all"
                      ? "Create a page to start collecting your work."
                      : "Files from your conversations will appear here. Save to Atlas to keep a permanent copy."}
            </Muted>
            {!searchValue && type === "bookmark" && scope === "all" && <Button variant="primary" className="mt-6" onClick={() => openAtlasBookmark({ accountId, collectionId: collectionId || undefined })}>Save a bookmark</Button>}
            {provider.supportsAtlas && !searchValue &&
              scope === "all" &&
              (type === "page" || type === "all") && (
                <Button
                  variant="primary"
                  className="mt-6"
                  onClick={() => void newPage()}
                >
                  Create a page
                </Button>
              )}
          </div>
        ) : type === "image" && grid ? (
          <div className="columns-2 gap-4 md:columns-3 xl:columns-4 2xl:columns-6">
            {entries.map(imageCard)}
          </div>
        ) : grid ? (
          <div className={type === "all"
            ? "columns-2 gap-4 lg:columns-3 xl:columns-4 *:mb-4 *:break-inside-avoid"
            : "grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4"}>
            {entries.map((entry) => {
              if (entry.kind === "bookmark" && entry.saved) return <AtlasBookmarkCard key={entry.key} item={entry.saved} menu={itemMenu(entry)} onOpen={() => show(entry)} onTag={(id) => setFilter("tag", id)} />;
              if (entry.kind === "page" && entry.saved) return (
                <AtlasPageCard
                  key={entry.key}
                  item={entry.saved}
                  activity={activity(entry.date)}
                  menu={itemMenu(entry)}
                  imagePaths={previewImagePaths}
                  fitContent={type === "all"}
                  onOpen={() => show(entry)}
                  onTag={(id) => setFilter("tag", id)}
                />
              );
              if (entry.kind === "image") return imageCard(entry);
              return (
                <article key={entry.key} className="group relative overflow-hidden rounded-xl glass-surface">
                  <Button aria-label={`Open ${entry.title}`} onClick={() => show(entry)}
                    className="flex aspect-2/1 max-h-36 w-full items-center justify-center bg-primary-100/70 focus-visible:ring-2 focus-visible:ring-accent/40 dark:bg-primary-900/70">
                    <AtlasFileIcon kind={entry.kind} fileName={entry.saved?.fileName ?? entry.generated?.fileName ?? entry.title} path={entry.path} className="size-9 text-accent/70" />
                  </Button>
                  <div className="p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <Button className="min-w-0 flex-1 text-left focus-visible:ring-2 focus-visible:ring-accent/40" onClick={() => show(entry)}>
                        <Text size="s" className="truncate">{entry.title}</Text>
                      </Button>
                      {itemMenu(entry)}
                    </div>
                    <AtlasItemTags tags={entry.saved?.tags ?? []} onTag={(id) => setFilter("tag", id)} />
                    <Muted className={`mt-1 text-xxs ${entry.saved?.isFavorite ? "pr-7" : ""}`}>{activity(entry.date)}</Muted>
                  </div>
                  {entry.saved?.isFavorite && <Star filled role="img" aria-label="Favorite" className="pointer-events-none absolute bottom-3 right-3 size-3.5 text-accent" />}
                </article>
              );
            })}
          </div>
        ) : (
          <ul aria-label="Atlas items">
            {entries.map((entry) => {
              const runId = entry.generated?.runId ?? entry.saved?.sourceRunId;
              const device = deviceOf(entry);
              return <li key={entry.key}>
                <AtlasItemRow entry={entry} menu={itemMenu(entry)} onOpen={() => show(entry)} onTag={(id) => setFilter("tag", id)}
                  onSource={runId ? () => void source(entry) : undefined}
                  sourceLabel={runId ? `${entry.generated?.runTitle ?? "Conversation"}${device ? ` · ${device}` : ""}` : undefined} />
              </li>;
            })}
          </ul>
        )}
        {!loading && library.currentData && (page > 1 || library.currentData.hasNext) && (
          <nav aria-label="Atlas pagination" className="mt-4 px-2 flex items-center justify-between gap-4  dark:border-primary-900">
            <Text size="s" tone="subtle" role="status" aria-live="polite">
              {entries.length > 0 && `${(page - 1) * ATLAS_LIBRARY_PAGE_SIZE + 1}–${(page - 1) * ATLAS_LIBRARY_PAGE_SIZE + entries.length} · `}Page {page}
            </Text>
            <div className="flex items-center gap-2">
              <Button variant="primary" disabled={page === 1 || library.isFetching} onClick={() => setFilter("page", String(page - 1))}>
                Previous
              </Button>
              <Button
                variant="primary"
                disabled={!library.currentData.hasNext || library.isFetching}
                onClick={() => setFilter("page", String(page + 1))}
              >
                Next
              </Button>
            </div>
          </nav>
        )}
      </div>
      {preview && (
        <AtlasImagePreview accountId={preview.saved?.accountId} id={preview.saved?.id} title={preview.title} path={preview.path}
          generated={preview.saved ? undefined : preview.generated} onClose={() => setPreview(null)} />
      )}
      {bookmarkEditor && <AtlasBookmarkEditor accountId={accountId} item={bookmarkEditor} collectionId={collectionId} onClose={() => setBookmarkEditor(null)} />}
      {tagEditor?.accountId === accountId && <AtlasTagEditor key={tagEditor.id} item={tagEditor} onClose={() => setTagEditor(null)} />}
      {managingTags && <AtlasOrganization accountId={accountId} onClose={() => setManagingTags(false)} />}
    </PageShell>
  );
}
