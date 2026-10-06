import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Text, toast } from "@/components/ui";
import {
  Library,
  Passport,
  Page,
  New,
  Option,
  Picture,
} from "@/components/ui/icons";
import { Layers } from "@/components/ui/icons/space";
import { ProjectIcon } from "@/components/layout/sidebar/project-icon";
import { SidebarGroupSection } from "@/components/layout/sidebar/sidebar-group-section";
import { useGetAccountQuery, useListCollectionsQuery } from "@/lib/redux/api";
import {
  useCreateAtlasPageMutation,
  useListAtlasQuery,
} from "@/lib/redux/api/atlasApi";
import { atlasError } from "../hooks/use-save-to-atlas";
import { AtlasPageIcon } from "./atlas-page-icon";
import { AtlasPageMenu } from "./atlas-page-menu";
import { AtlasTrashMenu } from "./atlas-trash-menu";
import { useAtlasOwnerKey } from "../hooks/use-atlas-tabs";
import { requestAtlasPage } from "../lib/page-actions";
import {
  ATLAS_TYPES,
  atlasLibraryHref,
  atlasView,
} from "../lib/atlas-navigation";

const typeIcons = { all: Passport, page: Page, file: Library, image: Picture };
const itemClass = (active: boolean) =>
  `flex py-1.5 w-full items-center gap-2 text-s text-primary-950 dark:text-primary rounded-[10px] px-2 text-left text-s cursor-pointer transition-colors ${
    active
            ? "bg-primary/50 glass-outline-soft glass-outline dark:bg-primary/5"
            : "hover:bg-primary/50 dark:hover:bg-primary/5"
  }`;

export function AtlasSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const view = atlasView(params);
  const { data: account } = useGetAccountQuery();
  const ownerKey = useAtlasOwnerKey(account?.id ?? "");
  const items = useListAtlasQuery(
    { accountId: account?.id ?? "" },
    { skip: !account },
  );
  const { data: collections = [] } = useListCollectionsQuery(
    { accountId: account?.id ?? "" },
    { skip: !account },
  );
  const [create, creating] = useCreateAtlasPageMutation();
  const [showAllRecents, setShowAllRecents] = useState(false);
  const recent = (items.data ?? [])
    .filter((item) => item.kind === "page" && !item.trashedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const inImageCreator = pathname.startsWith("/atlas/images/");
  const inPage = pathname.startsWith("/atlas/") && !inImageCreator;
  const activeType = inImageCreator ? "image" : inPage ? "page" : view.type;
  const newPage = async () => {
    if (!account) return;
    try {
      const page = await create({
        accountId: account.id,
        title: "Untitled page",
        collectionId: view.collectionId || null,
      }).unwrap();
      navigate(`/atlas/${page.item.id}`);
    } catch (error) {
      toast.error(atlasError(error));
    }
  };

  return (
    <div
      className="flex h-full flex-col "

    >
      <div className="flex flex-col items-start pt-12 px-5 md:pt-2">
        <Text size="base" weight="medium" align="left">Atlas</Text>
      </div>
      <nav className="shrink-0 space-y-0.5 py-3 px-3" aria-label="Atlas content">
        <Button
          className={`${itemClass(false)} mb-3`}
          aria-label="New Atlas page"
          disabled={!account || creating.isLoading}
          onClick={() => void newPage()}
        >
          <New className="size-3.5 shrink-0" />
          New page
        </Button>
        {ATLAS_TYPES.map(({ value, label }) => {
          const active = activeType === value;
          const Icon = typeIcons[value];
          return (
            <Button
              key={value}
              className={itemClass(active)}
              aria-current={active ? "page" : undefined}
              onClick={() =>
                navigate(atlasLibraryHref(value, "all", view.collectionId))
              }
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Button>
          );
        })}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto noscrollbar px-3 pt-7">
        <SidebarGroupSection
          groupKey="atlas-recents"
          label="Recents"
          count={Math.min(recent.length, showAllRecents ? 30 : 5)}
        >
          <nav aria-label="Recent Atlas pages" className="space-y-0.5">
            {recent.slice(0, showAllRecents ? 30 : 5).map((item) => {
              const active = pathname === `/atlas/${item.id}`;
              return (
                <div key={item.id} className="group/recent relative">
                  <Button
                    className={`${itemClass(active)} pr-8`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => requestAtlasPage({ ownerKey, id: item.id })}
                  >
                    <AtlasPageIcon icon={item.metadata?.icon} className="size-3.5 shrink-0 text-s text-primary-950 dark:text-primary" />
                    <Text as="span" size="s" weight="normal" className="truncate">{item.title}</Text>
                  </Button>
                  <AtlasPageMenu
                    label={`Page options for ${item.title}`}
                    trashed={false}
                    collectionId={item.collectionId}
                    collections={collections}
                    side="right"
                    trigger={<Option className="size-3.5" />}
                    className="absolute right-1 top-1/2 size-6 -translate-y-1/2 rounded-lg text-primary-500 opacity-0 transition-opacity hover:bg-primary/5 group-hover/recent:opacity-100 group-focus-within/recent:opacity-100 aria-expanded:opacity-100"
                    onAction={(action) => requestAtlasPage({ ownerKey, id: item.id, action })}
                  />
                </div>
              );
            })}
            {recent.length === 0 && (
              <Text size="xs" tone="subtle" className="px-2.5 py-2">
                Your pages will appear here.
              </Text>
            )}
            {recent.length > 5 && (
              <Button
                className="px-2.5 py-2 text-xs text-primary-500 hover:text-primary-800 dark:hover:text-primary-200"
                onClick={() => setShowAllRecents(!showAllRecents)}
              >
                {showAllRecents ? "Show less" : "Show more"}
              </Button>
            )}
          </nav>
        </SidebarGroupSection>
        <Text size="xs" tone="subtle" className="mb-2 mt-8 px-2.5">
          Projects
        </Text>
        <nav aria-label="Atlas projects" className="space-y-0.5">
          {collections.map((collection) => (
            <Button
              key={collection.id}
              className={itemClass(view.collectionId === collection.id)}
              aria-pressed={view.collectionId === collection.id}
              onClick={() =>
                navigate(
                  atlasLibraryHref(
                    "all",
                    "all",
                    view.collectionId === collection.id ? "" : collection.id,
                  ),
                )
              }
            >
              <span aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center">
                {collection.icon
                  ? <ProjectIcon icon={collection.icon} projectName={collection.name} />
                  : <Layers className="size-4" />}
              </span>
              <span className="truncate">{collection.name}</span>
            </Button>
          ))}
          {!collections.length && (
            <Text size="xs" tone="subtle" className="px-2.5 py-2">
              Pages can be grouped by project.
            </Text>
          )}
        </nav>
      </div>
      <div className="shrink-0 px-3 pb-3 pt-4">
        {account && <AtlasTrashMenu key={ownerKey} accountId={account.id} collections={collections} className={itemClass(false)} />}
      </div>
    </div>
  );
}
