import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type {
  AtlasGeneratedFile,
  AtlasItem,
  AtlasListItem,
  AtlasKind,
} from "@mains/contracts/atlas";
import { PageShell } from "@/components/layout/page-shell";
import {
  Button,
  DropdownMenuItem,
  DropdownMenuSub,
  Input,
  Muted,
  SegmentedTabs,
  Text,
  toast,
} from "@/components/ui";
import {
  Chat,
  Document,
  Download,
  Ellipsis,
  Generate,
  LibrarySquare,
  List,
  Grid,
  Page,
  Plan,
  Picture,
  Refresh,
  Search,
  Trash,
  Filter,
  ArrowUp,
} from "@/components/ui/icons";
import { Dna, Globe, Lightbulb, Rocket, Star } from "@/components/ui/icons/space";
import { useListCollectionsQuery } from "@/lib/redux/api";
import {
  useAtlasGeneratedQuery,
  useCreateAtlasPageMutation,
  useListAtlasQuery,
  useUpdateAtlasItemMutation,
} from "@/lib/redux/api/atlasApi";
import { useDocumentViewer } from "@/hooks/use-document-viewer";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { classifyDocType } from "@/lib/document-viewer";
import { appApi, getTransport } from "@/lib/transport";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useSpaceProviderVariant } from "@/hooks/use-space-provider-variant";
import { useAppDispatch } from "@/lib/redux/hooks";
import { updateAtlasPageChat } from "@/lib/redux/slices/atlasSlice";
import { useJumpToRun } from "@/features/workspace/hooks/use-jump-to-run";
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
import { AtlasPageIcon } from "./atlas-page-icon";
import { AtlasPageCard } from "./atlas-page-card";
import { AtlasImagePreview } from "./atlas-image-preview";
import { useAtlasOwnerKey } from "../hooks/use-atlas-tabs";

type Entry = {
  key: string;
  kind: AtlasKind;
  title: string;
  date: string;
  collectionId: string | null;
  path: string | null;
  saved?: AtlasListItem;
  generated?: AtlasGeneratedFile;
};
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

function ImageTile({ entry, onOpen, fill = false }: { entry: Entry; onOpen: () => void; fill?: boolean }) {
  const src = useLocalImageUrl(entry.path ?? "");
  const [failed, setFailed] = useState(false);
  return (
    <Button
      onClick={onOpen}
      aria-label={`Open ${entry.title}`}
      className={`block w-full overflow-hidden bg-primary-100 focus-visible:ring-2 focus-visible:ring-accent/60 dark:bg-primary-900 ${fill ? "relative aspect-square h-full focus-visible:ring-inset" : "rounded-xl"}`}
    >
      {src && !failed ? (
        <img
          src={src}
          onError={() => setFailed(true)}
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
  );
}

function ImageThumbnail({ path }: { path: string | null }) {
  const src = useLocalImageUrl(path);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return src && src !== failedSrc ? (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(src)}
      className="size-full object-cover"
    />
  ) : (
    <Picture className="size-4" />
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
  const [offset, setOffset] = useState(0);
  const [older, setOlder] = useState<AtlasGeneratedFile[]>([]);
  const [preview, setPreview] = useState<Entry | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const grid = type === "image" || params.get("layout") === "grid";
  const needGenerated =
    type !== "page" && (scope === "all" || scope === "generated" || scope === "uploads");
  const saved = useListAtlasQuery({
    accountId,
    ...(grid && (type === "page" || type === "all") ? { includePagePreview: true } : {}),
  }, { pollingInterval: 15000 });
  const previewImagePaths = useMemo(() => new Map(
    (grid ? saved.data ?? [] : [])
      .filter((item) => item.kind === "image" && item.path)
      .map((item) => [`atlas-file://${item.id}`, item.path!]),
  ), [grid, saved.data]);
  const generated = useAtlasGeneratedQuery(
    { accountId, offset, collectionId: collectionId || undefined },
    { skip: !needGenerated, pollingInterval: 15000 },
  );
  const { data: collections = [] } = useListCollectionsQuery({ accountId });
  const [createPage, creating] = useCreateAtlasPageMutation();
  const [update, updating] = useUpdateAtlasItemMutation();
  const { save, saving } = useSaveToAtlas();
  const { open } = useDocumentViewer();
  const jumpToRun = useJumpToRun();
  const focusSearch = params.get("focus") === "search";
  useEffect(() => {
    if (focusSearch) searchRef.current?.focus();
  }, [focusSearch]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete("focus");
    if (value && !(["view", "type"].includes(key) && value === "all"))
      next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const entries = useMemo(() => {
    const persistent = saved.data ?? [];
    const bySource = new Map(
      persistent
        .filter((item) => item.sourceKey)
        .map((item) => [item.sourceKey, item]),
    );
    const results: Entry[] = [];
    if (scope !== "generated" && scope !== "uploads")
      for (const item of persistent) {
        if (
          item.trashedAt ||
          (scope === "favorites" && !item.isFavorite)
        )
          continue;
        results.push({
          key: item.id,
          title: item.title,
          kind: item.kind,
          date: item.updatedAt,
          collectionId: item.collectionId,
          path: item.path,
          saved: item,
        });
      }
    if (scope === "all" || scope === "generated" || scope === "uploads") {
      const files = [
        ...new Map(
          [...older, ...(generated.currentData?.items ?? [])].map((item) => [
            item.sourceKey,
            item,
          ]),
        ).values(),
      ];
      for (const file of files) {
        if (scope === "generated" && file.origin === "attachment") continue;
        if (scope === "uploads" && file.origin !== "attachment") continue;
        if (scope === "all" && bySource.has(file.sourceKey)) continue;
        results.push({
          key: file.sourceKey,
          title: file.fileName,
          kind: file.kind,
          date: file.modifiedAt,
          collectionId: file.collectionId,
          path: file.path,
          generated: file,
          saved:
            scope !== "all" ? bySource.get(file.sourceKey) : undefined,
        });
      }
    }
    return results
      .filter(
        (entry) =>
          (type === "all" || entry.kind === type) &&
          (!collectionId || entry.collectionId === collectionId) &&
          `${entry.title} ${entry.generated?.runTitle ?? ""}`
            .toLocaleLowerCase()
            .includes(searchValue.toLocaleLowerCase().trim()),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [
    saved.data,
    generated.currentData,
    older,
    scope,
    type,
    collectionId,
    searchValue,
  ]);

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
  const show = (entry: Entry) => {
    if (entry.kind === "page") {
      navigate(`/atlas/${entry.key}`);
      return;
    }
    if (entry.kind === "image") {
      setPreview(entry);
      return;
    }
    if (entry.path)
      open({
        path: entry.path,
        fileName: entry.saved?.fileName ?? entry.title,
        docType: classifyDocType(entry.path) ?? "md",
      });
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
    if (!entry.path) return;
    try {
      const response = await appApi.fileExplorer.saveFileAs(
        entry.path,
        entry.saved?.fileName ?? entry.title,
      );
      if (!response.success)
        toast.error(response.error ?? "Could not save a copy");
      else if (response.data) toast.success("Copy saved");
    } catch (error) {
      toast.error(atlasError(error));
    }
  };
  const itemMenu = (entry: Entry, image = false) => (
    <AtlasMenu
      label={`Actions for ${entry.title}`}
      className={`size-7 rounded-full ${image ? "bg-primary-950/75 text-primary-100 hover:bg-primary-950" : "text-primary-500 hover:bg-primary-200/60 dark:hover:bg-primary-800"}`}
      trigger={<Ellipsis className="size-4" />}
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
          {entry.generated && !entry.saved && (
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
          {entry.path && (
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
  const scopes: { value: AtlasScope; label: string }[] = [
    { value: "all", label: "All" },
    ...(type === "image"
      ? [{ value: "generated" as const, label: "Your creations" }]
      : []),
    ...(type !== "page"
      ? [{ value: "uploads" as const, label: "Uploads" }]
      : []),
    { value: "favorites", label: "Favorites" },
    ...(type !== "page"
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
  const loading = saved.isLoading || (needGenerated && generated.isLoading);
  const error = saved.error ?? (needGenerated ? generated.error : undefined);

  return (
    <PageShell
      bottomPadded
      className="atlas-library max-w-360 px-6 pt-8 md:px-12 md:pt-10 xl:px-16"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight text-primary-900 dark:text-primary-100">
          {title}
        </h1>
        <div className="ml-auto flex items-center gap-2.5">
          {type !== "image" && (
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
                  onClick={() => setFilter("layout", value ? "grid" : "")}
                >
                  {value ? (
                    <Grid className="size-4" />
                  ) : (
                    <List className="size-4" />
                  )}
                </Button>
              ))}
            </div>
          )}
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
          {type === "image" ? (
            <Button
              aria-label="New image"
              className="text-primary-700 dark:text-primary-300 glass-primary px-3 py-1.5 text-s rounded-xl gap-1"
              onClick={() => navigate(atlasImageCreatorHref(collectionId))}
            >
              New

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
                  {type === "all" && <DropdownMenuItem
                    onClick={() => { close(); navigate(atlasImageCreatorHref(collectionId)); }}>
                    <Picture className="size-4" />New image
                  </DropdownMenuItem>}
                  <DropdownMenuItem
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
                  })}
                </>
              )}
            </AtlasMenu>
          )}
        </div>
      </div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
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
          className={`ml-auto size-8 rounded-full ${project ? "text-accent" : "text-primary-500 hover:bg-primary-100 dark:hover:bg-primary-900"}`}
          trigger={<Filter className="size-4" />}
        >
          {(close) => (
            <>
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
              <DropdownMenuItem
                onClick={() => {
                  close();
                  setOlder([]);
                  setOffset(0);
                  void saved.refetch();
                  if (needGenerated) void generated.refetch();
                }}
              >
                <Refresh className="size-4" />
                Refresh
              </DropdownMenuItem>
            </>
          )}
        </AtlasMenu>
      </div>
      {type === "all" && scope === "all" && !searchValue && (
        <section className="mb-10" aria-label="Start a page">
          <Text size="sm" weight="medium" className="mb-4">
            Start a page
          </Text>
          <div className="flex gap-3 overflow-x-auto noscrollbar pb-2">
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
          </div>
        </section>
      )}
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
                  : type === "page" || type === "all"
                    ? "Create a page to start collecting your work."
                    : "Files from your conversations will appear here. Save to Atlas to keep a permanent copy."}
          </Muted>
          {!searchValue &&
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
      ) : type === "image" ? (
        <div className="columns-2 gap-4 md:columns-3 xl:columns-4 2xl:columns-6">
          {entries.map((entry) => (
            <div
              key={entry.key}
              className="group relative mb-4 break-inside-avoid overflow-hidden rounded-xl border border-primary-200/60 dark:border-primary-800/70"
            >
              <ImageTile entry={entry} onOpen={() => show(entry)} />
              <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                {itemMenu(entry, true)}
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-primary-950/90 to-transparent px-3 pb-3 pt-8 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <p className="truncate text-xs font-medium text-primary-100">
                  {entry.title}
                </p>
                <p className="mt-1 text-xxs text-primary-300">
                  {entry.saved ? "Saved to Atlas" : entry.generated?.origin === "attachment" ? "Uploaded" : "Generated"}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : grid ? (
        <div className={type === "all"
          ? "columns-2 gap-4 lg:columns-3 xl:columns-4 *:mb-4 *:break-inside-avoid"
          : "grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4"}>
          {entries.map((entry) => {
            if (entry.kind === "page" && entry.saved) return (
              <AtlasPageCard
                key={entry.key}
                item={entry.saved}
                activity={activity(entry.date)}
                menu={itemMenu(entry)}
                imagePaths={previewImagePaths}
                fitContent={type === "all"}
                onOpen={() => show(entry)}
              />
            );
            if (entry.kind === "image") return (
              <div key={entry.key} className="group relative min-w-0 overflow-hidden rounded-3xl bg-primary-100 dark:bg-primary-900">
                <ImageTile entry={entry} onOpen={() => show(entry)} fill={type !== "all"} />
                <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  {itemMenu(entry, true)}
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-primary-950/90 to-transparent px-4 pb-4 pt-12 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <p className="truncate text-s font-medium text-primary-100">{entry.title}</p>
                  <p className="mt-1 text-xs text-primary-300">{activity(entry.date)}</p>
                </div>
              </div>
            );
            return (
              <div
                key={entry.key}
                className="group rounded-3xl glass-surface"
              >
                <Button
                  aria-label={`Open ${entry.title}`}
                  onClick={() => show(entry)}
                  className="flex aspect-4/3 w-full items-center justify-center rounded-t-3xl bg-primary-100/70 focus-visible:ring-2 focus-visible:ring-accent/40 dark:bg-primary-900/70"
                >
                  {entry.kind === "page" ? (
                    <AtlasPageIcon
                      icon={entry.saved?.metadata?.icon}
                      className="size-10 text-4xl text-accent/70"
                    />
                  ) : (
                    <AtlasFileIcon
                      kind={entry.kind}
                      fileName={entry.saved?.fileName ?? entry.generated?.fileName ?? entry.title}
                      path={entry.path}
                      className="size-10 text-accent/70"
                    />
                  )}
                </Button>
                <div className="flex items-center gap-2 p-3">
                  <Button
                    className="min-w-0 flex-1 text-left focus-visible:ring-2 focus-visible:ring-accent/40"
                    onClick={() => show(entry)}
                  >
                    <Text size="s" className="truncate">
                      {entry.title}
                    </Text>
                    <Muted className="mt-1 text-xs">
                      {activity(entry.date)}
                    </Muted>
                  </Button>
                  {itemMenu(entry)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <table className="w-full table-fixed text-left text-s">
          <thead className="text-xs font-normal text-primary-500">
            <tr className="border-b border-primary-200/50 dark:border-primary-900">
              <th className="w-[56%] pb-3 pl-3 font-normal">Name</th>
              <th className="hidden w-[24%] pb-3 font-normal sm:table-cell">
                Source
              </th>
              <th className="pb-3 font-normal">Last activity</th>
              <th className="w-10">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const runId = entry.generated?.runId ?? entry.saved?.sourceRunId;
              return (
                <tr
                  key={entry.key}
                  className="group relative isolate border-b border-primary-200/50 dark:border-primary-900"
                >
                  <td className="py-2 pl-3 pr-4">
                    {/* Keep the decoration inside a cell to avoid an anonymous table column. */}
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 -inset-x-3 z-0 rounded-xl bg-primary-100/50 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-primary-900/50"
                    />
                    <Button
                      className="relative z-10 flex h-9 w-full items-center gap-3 text-left focus-visible:ring-2 focus-visible:ring-accent/40"
                      onClick={() => show(entry)}
                    >
                      <span aria-hidden="true" className="flex size-8 shrink-0 overflow-hidden glass-outline glass-outline-soft items-center justify-center rounded-xl text-accent">
                        {entry.kind === "page" ? (
                          <AtlasPageIcon icon={entry.saved?.metadata?.icon} />
                        ) : entry.kind === "image" ? (
                          <ImageThumbnail path={entry.path} />
                        ) : (
                          <AtlasFileIcon
                            kind={entry.kind}
                            fileName={entry.saved?.fileName ?? entry.generated?.fileName ?? entry.title}
                            path={entry.path}
                            className="size-4"
                          />
                        )}
                      </span>
                      <span className="truncate text-primary-800 dark:text-primary-200">
                        {entry.title}
                      </span>
                      {entry.saved?.isFavorite && (
                        <Star
                          filled
                          className="size-3 shrink-0 text-primary-500"
                        />
                      )}
                    </Button>
                  </td>
                  <td className="relative z-10 hidden pr-5 text-xs text-primary-500 sm:table-cell">
                    {runId ? (
                      <Button
                        className="block max-w-full truncate text-left hover:text-primary-800 focus-visible:ring-2 focus-visible:ring-accent/40 dark:hover:text-primary-200"
                        onClick={() => void source(entry)}
                      >
                        {entry.generated?.runTitle ?? "Conversation"}
                      </Button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td
                    className="relative z-10 text-xs text-primary-500"
                    title={new Date(entry.date).toLocaleString()}
                  >
                    {activity(entry.date)}
                  </td>
                  <td className="relative z-10 pr-2 text-right">{itemMenu(entry)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {/* {needGenerated && generated.currentData?.nextOffset != null && (
        <div className="mt-8 text-center">
          <Button
            variant="ghost"
            disabled={generated.isFetching}
            onClick={loadOlder}
          >
            Load older conversations
          </Button>
        </div>
      )} */}
      {preview && (
        <AtlasImagePreview title={preview.title} path={preview.path} onClose={() => setPreview(null)} />
      )}
    </PageShell>
  );
}
