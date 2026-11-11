import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import { useNavigate } from "react-router-dom";
import type { AtlasPage, AtlasItem } from "@mains/contracts/atlas";
import type { PartialBlock } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { PageShell } from "@/components/layout/page-shell";
import { Button, Input, Modal, Muted, Text, Textarea, toast } from "@/components/ui";
import { Undo } from "@/components/ui/icons";
import {
  useAtlasPageQuery,
  useAtlasRevisionsQuery,
  useCreateAtlasPageMutation,
  useRestoreAtlasPageMutation,
  useResolveAtlasConflictMutation,
  useSaveAtlasPageMutation,
  useUpdateAtlasItemMutation,
  useUploadAtlasFileMutation,
} from "@/lib/redux/api/atlasApi";
import { useListCollectionsQuery } from "@/lib/redux/api";
import { useIsDarkMode } from "@/hooks/use-is-dark-mode";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { appApi, getTransport } from "@/lib/transport";
import { signLocalImage } from "@/lib/local-image-url";
import { signLocalDocument } from "@/lib/local-document-url";
import { atlasError } from "../hooks/use-save-to-atlas";
import { AUTOSAVE_INTERVAL_MS, createPageSaveQueue, type PageDraft } from "../lib/page-save-queue";
import { downloadAtlasText } from "../lib/download";
import { pageFileData } from "../lib/page-upload";
import { createAtlasPageLifecycle, type AtlasPageOperation } from "../lib/page-lifecycle";
import type {
  AtlasPageAction,
  AtlasPendingPageAction,
} from "../lib/page-actions";
import { AtlasPageChat } from "./atlas-page-chat";
import { AtlasPageHeader } from "./atlas-page-header";
import { AtlasPageToolbar } from "./atlas-page-toolbar";
import { AtlasPageConflicts } from "./atlas-page-conflicts";

export interface AtlasPageEditorHandle {
  flush: () => Promise<boolean>;
  collectionId: string | null;
  performAction: (action: AtlasPageAction) => Promise<void>;
}
interface AtlasPageEditorProps {
  accountId: string;
  id: string;
  handleRef: Ref<AtlasPageEditorHandle>;
  onTitleChange: (title: string) => void;
  requestedAction?: AtlasPendingPageAction;
  onActionHandled?: (token: string) => void;
  draftScope?: string;
}

function readDraft(key: string): { version: number; draft: PageDraft } | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return value &&
      Number.isInteger(value.version) &&
      Array.isArray(value.draft?.blocks) &&
      typeof value.draft.title === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

export default function AtlasPageEditor({
  accountId,
  id,
  handleRef,
  onTitleChange,
  requestedAction,
  onActionHandled,
  draftScope,
}: AtlasPageEditorProps) {
  const query = useAtlasPageQuery({ accountId, id }, { pollingInterval: 5000 });
  if (query.isLoading)
    return (
      <PageShell>
        <Muted>Opening page…</Muted>
      </PageShell>
    );
  if (query.error || !query.data || !("revision" in query.data))
    return (
      <PageShell>
        <Text role="alert">
          {query.error
            ? atlasError(query.error)
            : "Page is no longer available"}
        </Text>
      </PageShell>
    );
  return (
    <PageEditor
      page={query.data}
      reload={async () => {
        const result = await query.refetch();
        if (result.error) throw result.error;
        return result.data;
      }}
      handleRef={handleRef}
      onTitleChange={onTitleChange}
      requestedAction={requestedAction}
      draftScope={draftScope}
      onActionHandled={onActionHandled}
    />
  );
}

function PageEditor({
  page,
  reload,
  handleRef,
  onTitleChange,
  requestedAction,
  onActionHandled,
  draftScope,
}: {
  page: AtlasPage;
  reload: () => Promise<AtlasPage | null | undefined>;
  handleRef: Ref<AtlasPageEditorHandle>;
  onTitleChange: (title: string) => void;
  requestedAction?: AtlasPendingPageAction;
  onActionHandled?: (token: string) => void;
  draftScope?: string;
}) {
  const { accountId, id } = page.item;
  const navigate = useNavigate();
  const [mountedTransport] = useState(getTransport);
  // Synced Page IDs are shared. A web client switching backends must keep
  // each backend's optimistic ordinal and interrupted draft separate.
  const draftKey = `mains:atlas:draft:${draftScope ?? accountId}:${id}`;
  const [recovered] = useState(() => readDraft(draftKey));
  const [name, setName] = useState(recovered?.draft.title ?? page.item.title);
  const [saveState, setSaveState] = useState<{
    saving: boolean;
    dirty: boolean;
    error: unknown | null;
  }>({ saving: false, dirty: false, error: null });
  const [savePage] = useSaveAtlasPageMutation();
  const [upload] = useUploadAtlasFileMutation();
  const [createPage] = useCreateAtlasPageMutation();
  const [updateItem] = useUpdateAtlasItemMutation();
  const { copy } = useCopyToClipboard({
    onSuccess: () => toast.success("Page contents copied"),
    onError: () => toast.error("Could not copy page contents"),
  });
  const applying = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pageState, setPageState] = useState({ editable: !page.item.trashedAt, busy: false });
  const [initialVersion] = useState(page.item.version);
  const uploadFile = async (file: File) => {
    try {
      const item = await upload({
        accountId,
        pageId: id,
        fileName: file.name,
        data: await pageFileData(file),
      }).unwrap();
      return `atlas-file://${item.id}`;
    } catch (error) {
      toast.error(atlasError(error));
      throw error;
    }
  };
  const editor = useCreateBlockNote(
    {
      initialContent: (recovered?.draft.blocks ??
        page.revision.blocks) as PartialBlock[],
      uploadFile,
      resolveFileUrl: async (url) => {
        if (!url.startsWith("atlas-file://")) return url;
        const response = await appApi.atlas.get({
          accountId,
          id: url.slice("atlas-file://".length),
        });
        if (!response.success || !response.data)
          throw new Error("Embedded file unavailable");
        const item = response.data as AtlasItem;
        if (!item.path) throw new Error("Embedded file unavailable");
        const signed =
          item.kind === "image"
            ? await signLocalImage(item.path)
            : await signLocalDocument(item.path);
        if (!signed) throw new Error("Could not open the embedded file");
        return signed;
      },
    },
    [],
  );
  const [queue] = useState(() =>
    createPageSaveQueue({
      page,
      save: (draft, expectedVersion) => {
        if (getTransport() !== mountedTransport)
          return Promise.reject(
            new Error("Backend changed; reopen this page to save"),
          );
        return savePage({
          accountId,
          id,
          title: draft.title.trim() || "Untitled page",
          blocks: draft.blocks,
          expectedVersion,
        }).unwrap();
      },
      persist: (draft, version) => {
        try {
          if (draft)
            localStorage.setItem(draftKey, JSON.stringify({ version, draft }));
          else localStorage.removeItem(draftKey);
        } catch {
          /* Saving to the backend still works when local draft storage is full. */
        }
      },
      onState: setSaveState,
    }),
  );
  const [lifecycle] = useState(() => createAtlasPageLifecycle({
    isCurrent: () => getTransport() === mountedTransport,
    save: () => queue.flush(),
    trashed: !!page.item.trashedAt,
    onState: setPageState,
  }));
  useLayoutEffect(() => {
    lifecycle.activate();
    return () => { void lifecycle.flush(); lifecycle.deactivate(); };
  }, [lifecycle]);
  useLayoutEffect(() => {
    lifecycle.setTrashed(!!page.item.trashedAt);
    if (page.item.trashedAt && timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, [page.item.trashedAt, lifecycle]);
  const flush = useCallback(() => lifecycle.flush(), [lifecycle]);
  useEffect(() => {
    onTitleChange(name || "Untitled page");
  }, [name, onTitleChange]);
  const schedule = (title: string = queue.draft.title) => {
    if (applying.current || !lifecycle.canEdit) return;
    queue.edit({ title, blocks: editor.document });
    // Throttle, not debounce: later keystrokes keep the running timer, so
    // continuous typing still reaches the backend within one interval.
    timer.current ??= setTimeout(() => {
      timer.current = null;
      void flush();
    }, AUTOSAVE_INTERVAL_MS);
  };
  useEffect(() => {
    if (recovered) {
      queue.edit(recovered.draft);
      if (recovered.version !== initialVersion)
        queue.block(
          "A newer version exists. Your recovered draft is kept here; export it or save it as a new Page.",
        );
      else void flush();
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      void flush();
    };
  }, [queue, recovered, initialVersion, flush]);
  useEffect(() => {
    let cancelled = false;
    // The backend query is an external document source; apply after this render.
    void Promise.resolve().then(() => {
      if (cancelled || !queue.sync(page)) return;
      applying.current = true;
      editor.replaceBlocks(
        editor.document,
        page.revision.blocks as PartialBlock[],
      );
      setName(page.item.title);
      applying.current = false;
    });
    return () => {
      cancelled = true;
    };
  }, [page, editor, queue]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saveState.dirty) {
        // The autosave interval can still be running; save now so the next
        // close attempt finds a clean page instead of waiting for the timer.
        void flush();
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saveState.dirty, flush]);
  const [history, setHistory] = useState(false);
  const revisions = useAtlasRevisionsQuery(
    { accountId, id },
    { skip: !history, refetchOnMountOrArgChange: true, pollingInterval: 5000 },
  );
  const [restore] = useRestoreAtlasPageMutation();
  const [resolveConflict] = useResolveAtlasConflictMutation();
  const { data: collections = [] } = useListCollectionsQuery({ accountId });
  const importRef = useRef<HTMLInputElement>(null);
  const performAction = useCallback(
    async (action: AtlasPageAction) => {
      if (getTransport() !== mountedTransport)
        throw new Error("Backend changed; reopen this page");
      const trash = action.type === "trash";
      if (trash && timer.current) clearTimeout(timer.current);
      if (trash) timer.current = null;
      await lifecycle.run(async () => {
        switch (action.type) {
        case "copy":
          await copy(
            `# ${name || "Untitled page"}\n\n${editor.blocksToMarkdownLossy()}`,
          );
          break;
        case "import":
          if (!page.item.trashedAt) importRef.current?.click();
          break;
        case "export":
          if (action.format === "markdown")
            downloadAtlasText(
              `${name || "page"}.md`,
              editor.blocksToMarkdownLossy(),
            );
          else
            downloadAtlasText(
              `${name || "page"}.json`,
              JSON.stringify(editor.document, null, 2),
              "application/json",
            );
          break;
        case "history":
          setHistory(true);
          break;
        case "move":
          if (!page.item.trashedAt)
            await updateItem({
              accountId,
              id,
              collectionId: action.collectionId,
            }).unwrap();
          break;
        case "trash": {
          await updateItem({ accountId, id, trashed: true }).unwrap();
          break;
        }
        }
      }, trash ? "trash" : action.type === "move" || action.type === "import" ? "edit" : "read");
    },
    [
      mountedTransport,
      copy,
      name,
      editor,
      page.item.trashedAt,
      updateItem,
      accountId,
      id,
      lifecycle,
    ],
  );
  useImperativeHandle(
    handleRef,
    () => ({
      flush,
      collectionId: page.item.collectionId,
      performAction,
    }),
    [flush, page.item.collectionId, performAction],
  );
  useEffect(() => {
    if (!requestedAction) return;
    let cancelled = false;
    // Strict Mode may retire this effect before the surface is committed.
    // Consume the one-shot request only in the surviving effect.
    void Promise.resolve().then(async () => {
      if (cancelled || !lifecycle.consume(requestedAction.token)) return;
      onActionHandled?.(requestedAction.token);
      await performAction(requestedAction.action);
    }).catch((error: unknown) => toast.error(atlasError(error)));
    return () => { cancelled = true; };
  }, [requestedAction, onActionHandled, performAction, lifecycle]);
  const applyLatest = async ({ current }: AtlasPageOperation) => {
    const next = await reload();
    if (!current()) return;
    if (!next) throw new Error("Page is no longer available");
    queue.reset(next);
    applying.current = true;
    try {
      editor.replaceBlocks(editor.document, next.revision.blocks as PartialBlock[]);
      setName(next.item.title);
    } finally { applying.current = false; }
  };
  const reloadLatest = () => lifecycle.run(async (operation) => {
    // A recovery reload may discard a draft, but never an accepted write that
    // is still running. A blocked queue need not save successfully to reload.
    await queue.flush();
    if (operation.current()) await applyLatest(operation);
  }, "recover");
  const duplicate = async () => {
    try {
      await lifecycle.run(async ({ current }) => {
        const next = await createPage({
          accountId,
          title: `${name || "Untitled page"} (draft)`,
          blocks: editor.document,
          collectionId: page.item.collectionId,
        }).unwrap();
        if (!current()) return;
        localStorage.removeItem(draftKey);
        navigate(`/atlas/${next.item.id}`);
      }, "recover");
    } catch (error) {
      toast.error(atlasError(error));
    }
  };
  const beforeSend = useCallback(async () => {
    if (!lifecycle.canEdit || saveState.error) return false;
    return lifecycle.run(() => {}, "send");
  }, [saveState.error, lifecycle]);
  const backToPages = () => {
    void lifecycle.run(() => navigate("/atlas?type=page"))
      .catch((error: unknown) => toast.error(atlasError(error)));
  };

  return (
    <div
      className="atlas-page relative flex h-full min-h-0 flex-col"
      id={`atlas-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`atlas-tab-${id}`}
    >
      <AtlasPageToolbar
        title={name}
        icon={page.item.metadata?.icon}
        isFavorite={page.item.isFavorite}
        trashed={!!page.item.trashedAt}
        collectionId={page.item.collectionId}
        collections={collections}
        onBack={backToPages}
        onFavorite={() => {
          void updateItem({ accountId, id, isFavorite: !page.item.isFavorite })
            .unwrap()
            .catch((error: unknown) => toast.error(atlasError(error)));
        }}
        onAction={(action) => {
          void performAction(action).catch((error: unknown) =>
            toast.error(atlasError(error)),
          );
        }}
      />
      <Text className="sr-only" aria-live="polite">
        {saveState.error
          ? "Draft kept locally"
          : saveState.saving
            ? "Saving…"
            : saveState.dirty
              ? "Draft saved on this device"
              : "Saved"}
      </Text>
      <div className="min-h-0 flex-1 overflow-y-auto noscrollbar pb-44">
        <AtlasPageHeader item={page.item}>
          {!!page.conflicts?.length && !page.item.trashedAt && <AtlasPageConflicts page={page}
            resolving={pageState.busy}
            onResolve={(choice, revisionId) => lifecycle.run(async (operation) => {
              await resolveConflict({ accountId, id, choice, revisionId, expectedVersion: queue.version }).unwrap();
              if (operation.current()) await applyLatest(operation);
            }, "revision")} />}
          {page.item.trashedAt && (
            <div className="mb-6 flex items-center gap-3">
              <Muted>This page is in Trash.</Muted>
              <Button
                variant="primary"
                onClick={() => {
                  void lifecycle.run(async () => { await updateItem({ accountId, id, trashed: false }).unwrap(); },
                    "restore")
                    .catch((error: unknown) => toast.error(atlasError(error)));
                }}
              >
                Restore page
              </Button>
            </div>
          )}
          {saveState.error != null && (
            <div
              role="alert"
              className="mb-6 rounded-xl border border-primary-200 p-4 dark:border-primary-800"
            >
              <Text>{atlasError(saveState.error)}</Text>
              <Muted className="mt-2">
                Your draft is still shown below. Export it before reloading, or
                keep it as a new page.
              </Muted>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => void duplicate()}>
                  Save draft as new page
                </Button>
                <Button
                  variant="ghost"
                  disabled={saveState.saving}
                  onClick={() => void reloadLatest().catch((error: unknown) => toast.error(atlasError(error)))}
                >
                  Reload latest
                </Button>
                {!queue.blocked && (
                  <Button variant="ghost" onClick={() => void queue.retry()}>
                    Retry save
                  </Button>
                )}
              </div>
            </div>
          )}
          <Textarea
            variant="bare"
            aria-label="Page title"
            rows={1}
            value={name}
            placeholder="Untitled page"
            maxLength={240}
            disabled={!pageState.editable || !!page.item.trashedAt}
            onChange={(event) => {
              const title = event.target.value.replace(/[\r\n]+/g, " ");
              setName(title);
              schedule(title);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing)
                event.preventDefault();
            }}
            className="atlas-title mb-8 block w-full resize-none overflow-hidden bg-transparent px-0 font-semibold"
          />
        </AtlasPageHeader>
        <div className="px-8 md:px-16">
          <div className="mx-auto max-w-3xl">
            <BlockNoteView
              editor={editor}
              theme={useIsDarkMode() ? "dark" : "light"}
              editable={pageState.editable && !page.item.trashedAt}
              onChange={() => schedule()}
            />
          </div>
        </div>
      </div>
      <Input
        ref={importRef}
        type="file"
        accept=".md,.markdown,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void lifecycle.run(async ({ current }) => {
            if (file.size > 2 * 1024 * 1024)
              throw new Error("Page import exceeds the 2 MB limit");
            const text = await file.text();
            const blocks = file.name.toLowerCase().endsWith(".json")
              ? JSON.parse(text)
              : await editor.tryParseMarkdownToBlocks(text);
            if (!Array.isArray(blocks) || !blocks.length)
              throw new Error("Invalid Page file");
            // Imported blocks receive fresh IDs, including nested children. JSON
            // exported from this same Page must not duplicate existing block IDs.
            const freshIds = (block: PartialBlock): PartialBlock => {
              const { id: _id, children, ...rest } = block;
              return {
                ...rest,
                ...(children ? { children: children.map(freshIds) } : {}),
              } as PartialBlock;
            };
            // Import appends to the existing document so it preserves current work.
            if (!current()) return;
            editor.insertBlocks(
              blocks.map(freshIds),
              editor.document[editor.document.length - 1],
              "after",
            );
            schedule();
          }, "edit").catch((error: unknown) => toast.error(atlasError(error)));
        }}
      />
      <Modal
        isOpen={history}
        onClose={() => setHistory(false)}
        aria-label="Page history"
        className="max-w-lg p-6"
      >
        <Text weight="medium">Page history</Text>
        <Muted className="mt-2">
          Restoring an earlier version creates a new revision. Shows the last
          version of each of the 10 most recent editing sessions.
        </Muted>
        <div className="mt-5 max-h-[60vh] overflow-y-auto divide-y divide-primary-200/60 dark:divide-primary-800/60">
          {revisions.isLoading && <Muted>Loading history…</Muted>}
          {revisions.error != null && (
            <Text role="alert">{atlasError(revisions.error)}</Text>
          )}
          {revisions.data?.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div>
                <Text size="sm">
                  {row.title}
                </Text>
                <Muted className="mt-1 text-xs">
                  {row.actor === "agent" ? "Agent" : row.actor === "restore" ? "Restored" : "You"} ·{" "}
                  {new Date(row.createdAt).toLocaleString()}
                  {" · "}{row.backendLabel ?? row.backendId ?? "This device"}
                </Muted>
              </div>
              <Button
                variant="ghost"
                className="inline-flex"
                leftIcon={<Undo className="size-4" />}
                disabled={
                  row.id === page.revision.id ||
                  !!page.item.trashedAt ||
                  pageState.busy
                }
                onClick={() => {
                  void lifecycle.run(async (operation) => {
                    await restore({ accountId, id, revisionId: row.id, expectedVersion: queue.version }).unwrap();
                    if (!operation.current()) return;
                    await applyLatest(operation);
                    if (operation.current()) setHistory(false);
                  }, "revision").catch((error: unknown) => toast.error(atlasError(error)));
                }}
              >
                Restore
              </Button>
            </div>
          ))}
        </div>
      </Modal>
      <AtlasPageChat
        accountId={accountId}
        id={id}
        title={name}
        collectionId={page.item.collectionId}
        disabled={!!page.item.trashedAt || !!saveState.error}
        beforeSend={beforeSend}
      />
    </div>
  );
}
