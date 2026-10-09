import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AtlasItem } from "@mains/contracts/atlas";
import {
  Button,
  DropdownMenu,
  Input,
  Modal,
  Muted,
  Text,
  toast,
} from "@/components/ui";
import { Search, Trash, Undo } from "@/components/ui/icons";
import { useDocumentViewer } from "@/hooks/use-document-viewer";
import { classifyDocType } from "@/lib/document-viewer";
import { useAppDispatch } from "@/lib/redux/hooks";
import {
  useListAtlasQuery,
  useRemoveAtlasItemMutation,
  useUpdateAtlasItemMutation,
} from "@/lib/redux/api/atlasApi";
import { closeAtlasPageTab } from "@/lib/redux/slices/atlasSlice";
import { getTransport } from "@/lib/transport";
import { useAtlasOwnerKey } from "../hooks/use-atlas-tabs";
import { atlasError } from "../hooks/use-save-to-atlas";
import { requestAtlasPage } from "../lib/page-actions";
import { AtlasImagePreview } from "./atlas-image-preview";
import { AtlasFileIcon } from "./atlas-file-icon";
import { AtlasPageIcon } from "./atlas-page-icon";

export function AtlasTrashMenu({
  accountId,
  collections,
  className,
}: {
  accountId: string;
  collections: { id: string; name: string }[];
  className: string;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const ownerKey = useAtlasOwnerKey(accountId);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathnameRef = useRef(pathname);
  useLayoutEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const { open } = useDocumentViewer();
  const [position, setPosition] = useState<{
    x: number;
    y: number;
    anchorTop: number;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<AtlasItem | null>(null);
  const [preview, setPreview] = useState<AtlasItem | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [update] = useUpdateAtlasItemMutation();
  const [remove, removing] = useRemoveAtlasItemMutation();
  const items = useListAtlasQuery({ accountId }, { skip: !position });
  const search = query.trim().toLocaleLowerCase();
  const trashed = (items.data ?? [])
    .filter((item) => item.accountId === accountId && item.trashedAt)
    .sort((a, b) => b.trashedAt!.localeCompare(a.trashedAt!));
  const matches = trashed.filter((item) =>
    item.title.toLocaleLowerCase().includes(search),
  );
  const close = () => setPosition(null);
  const show = (item: AtlasItem) => {
    close();
    if (item.kind === "page") requestAtlasPage({ ownerKey, id: item.id });
    else if (item.kind === "image") setPreview(item);
    else if (item.path)
      open({
        path: item.path,
        fileName: item.fileName ?? item.title,
        docType: classifyDocType(item.path) ?? "md",
      });
  };
  const restore = async (item: AtlasItem) => {
    if (pending.current) return;
    pending.current = true;
    setPendingId(item.id);
    try {
      await update({ accountId, id: item.id, trashed: false }).unwrap();
    } catch (error) {
      toast.error(atlasError(error));
    } finally {
      pending.current = false;
      setPendingId(null);
    }
  };
  const deleteItem = async () => {
    if (!deleting || pending.current) return;
    pending.current = true;
    const transport = getTransport();
    try {
      await remove({ accountId, id: deleting.id }).unwrap();
      if (getTransport() !== transport || !mounted.current) return;
      if (deleting.kind === "page")
        dispatch(closeAtlasPageTab({ ownerKey, id: deleting.id }));
      if (pathnameRef.current === `/atlas/${deleting.id}`)
        navigate("/atlas?type=page");
      setDeleting(null);
    } catch (error) {
      toast.error(atlasError(error));
    } finally {
      pending.current = false;
    }
  };

  return (
    <>
      <Button
        id={id}
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={!!position}
        className={`${className} aria-expanded:bg-primary/50 dark:aria-expanded:bg-primary/5`}
        onClick={(event) => {
          if (position) {
            close();
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setQuery("");
          setPosition({
            x: rect.right + 8,
            y: rect.bottom,
            anchorTop: rect.bottom,
          });
        }}
      >
        <Trash className="size-4 shrink-0" />
        Trash
      </Button>
      <DropdownMenu
        isOpen={!!position}
        position={position ?? { x: 0, y: 0 }}
        onClose={close}
        aria-labelledby={id}
        initialFocusRef={searchRef}
        openUpward
        origin="bottom-left"
        minWidth={0}
        className="flex w-[min(440px,calc(100vw-16px))] max-h-[min(560px,calc(100vh-16px))] flex-col p-2"
      >
        <div className="relative m-1 mb-3 shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary-500" />
          <Input
            ref={searchRef}
            aria-label="Search Trash"
            placeholder="Search in Trash"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9 glass-input"
          />
        </div>
        <div className="min-h-0 overflow-y-auto noscrollbar">
          {items.isLoading ? (
            <Muted className="px-3 py-8 text-center">Loading Trash…</Muted>
          ) : items.error ? (
            <Text role="alert" className="px-3 py-4">
              {atlasError(items.error)}
            </Text>
          ) : !matches.length ? (
            <Muted className="px-3 py-8 text-center">
              {search ? "No matching items" : "Trash is empty"}
            </Muted>
          ) : (
            matches.map((item) => {
              const project = collections.find(
                (collection) => collection.id === item.collectionId,
              );
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-1 rounded-xl px-1 hover:bg-primary-200/40 focus-within:bg-primary-200/40 dark:hover:bg-primary/5 dark:focus-within:bg-primary/5"
                >
                  <Button
                    role="menuitem"
                    tabIndex={-1}
                    aria-label={`Open ${item.title}`}
                    onClick={() => show(item)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-3 text-left focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    {item.kind === "page" ? (
                      <AtlasPageIcon
                        icon={item.metadata?.icon}
                        className="size-5 text-xl text-primary-500"
                      />
                    ) : (
                      <AtlasFileIcon
                        kind={item.kind}
                        fileName={item.fileName ?? item.title}
                        path={item.path}
                        className="size-5 shrink-0 text-primary-500"
                      />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-s text-primary-900 dark:text-primary-100">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-primary-500">
                        {project?.name ??
                          (item.kind === "page"
                            ? "Pages"
                            : item.kind === "image"
                              ? "Images"
                              : "Docs")}
                      </span>
                    </span>
                  </Button>
                  <Button
                    role="menuitem"
                    tabIndex={-1}
                    aria-label={`Restore ${item.title}`}
                    title="Restore"
                    disabled={!!pendingId}
                    aria-busy={pendingId === item.id}
                    onClick={() => void restore(item)}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-primary-500 hover:bg-primary-200/40 hover:text-primary-900 focus-visible:ring-2 focus-visible:ring-accent/40 dark:hover:bg-primary/5 dark:hover:text-primary-100"
                  >
                    <Undo className="size-4" />
                  </Button>
                  <Button
                    role="menuitem"
                    tabIndex={-1}
                    aria-label={`Delete ${item.title} permanently`}
                    title="Delete permanently"
                    disabled={!!pendingId}
                    onClick={() => {
                      close();
                      setDeleting(item);
                    }}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-primary-500 hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-danger/40"
                  >
                    <Trash className="size-4" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </DropdownMenu>
      {preview && (
        <AtlasImagePreview
          title={preview.title}
          path={preview.path}
          onClose={() => setPreview(null)}
        />
      )}
      <Modal
        isOpen={!!deleting}
        onClose={() => {
          if (!removing.isLoading) setDeleting(null);
        }}
        aria-label="Delete Atlas item"
        className="max-w-md p-6"
        returnFocusRef={triggerRef}
      >
        <Text weight="medium">Delete {deleting?.title} permanently?</Text>
        <Muted className="mt-3">
          This permanently removes the item from Atlas.
        </Muted>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="ghost"
            disabled={removing.isLoading}
            onClick={() => setDeleting(null)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            isLoading={removing.isLoading}
            onClick={() => void deleteItem()}
          >
            Delete permanently
          </Button>
        </div>
      </Modal>
    </>
  );
}
