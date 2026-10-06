import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useGetAccountQuery } from "@/lib/redux/api";
import { PageShell } from "@/components/layout/page-shell";
import { Button, Heading3, Muted, Text, toast } from "@/components/ui";
import { AtlasLibrary } from "@/features/atlas/components/atlas-library";
import { AtlasPageTabs } from "@/features/atlas/components/atlas-page-tabs";
import type { AtlasPageEditorHandle } from "@/features/atlas/components/atlas-page-editor";
import { useAtlasTabs } from "@/features/atlas/hooks/use-atlas-tabs";
import { atlasError } from "@/features/atlas/hooks/use-save-to-atlas";
import { useSetMainHeader } from "@/hooks/use-main-header";
import { useCreateAtlasPageMutation } from "@/lib/redux/api/atlasApi";
import { useAppDispatch } from "@/lib/redux/hooks";
import { closeAtlasPageTab, renameAtlasPageTab } from "@/lib/redux/slices/atlasSlice";
import { useSpaceProviderVariant } from "@/hooks/use-space-provider-variant";
import { getTransport } from "@/lib/transport";
import { subscribeAtlasPageRequests, type AtlasPendingPageAction } from "@/features/atlas/lib/page-actions";
import { ActiveSpaceOverrideProvider, useActiveSpace } from "@/hooks/use-active-space";

const AtlasPageEditor = lazy(() => import("@/features/atlas/components/atlas-page-editor"));
const AtlasImageCreator = lazy(() => import("@/features/atlas/components/atlas-image-creator"));

export default function Atlas({ imageCreation = false }: { imageCreation?: boolean }) {
  const provider = useSpaceProviderVariant();
  const { activeSpace } = useActiveSpace();
  const workSpace = useMemo(() => activeSpace ? { ...activeSpace, mode: "work" as const } : null, [activeSpace]);
  if (!provider.supportsAtlas) return <PageShell>
    <Heading3 className="mb-6">Atlas</Heading3>
    <Muted>Atlas isn&apos;t available for this agent yet.</Muted>
  </PageShell>;
  return workSpace ? <ActiveSpaceOverrideProvider space={workSpace}>
    <AtlasContent imageCreation={imageCreation} />
  </ActiveSpaceOverrideProvider> : <AtlasContent imageCreation={imageCreation} />;
}

function AtlasContent({ imageCreation }: { imageCreation: boolean }) {
  const { data: account, error, refetch } = useGetAccountQuery();
  if (error) return <PageShell><Text role="alert">Could not connect to Atlas.</Text>
    <Button variant="ghost" className="mt-4" onClick={() => void refetch()}>Retry</Button></PageShell>;
  if (!account) return <PageShell><Muted>Loading Atlas…</Muted></PageShell>;
  return <AtlasSurface key={account.id} accountId={account.id} imageCreation={imageCreation} />;
}

function AtlasSurface({ accountId, imageCreation }: { accountId: string; imageCreation: boolean }) {
  const { itemId, runId } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { ownerKey, tabs } = useAtlasTabs(accountId, itemId);
  const editorRef = useRef<AtlasPageEditorHandle>(null);
  const [createPage] = useCreateAtlasPageMutation();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const collectionId = params.get("project");
  const runAction = useCallback(async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await action(); }
    catch (error) { toast.error(atlasError(error)); }
    finally { pending.current = false; setBusy(false); }
  }, []);
  const selectPage = useCallback((id: string) => {
    if (id === itemId) return;
    void runAction(async () => {
      if (editorRef.current && !(await editorRef.current.flush())) return;
      navigate(`/atlas/${id}`);
      document.getElementById(`atlas-tab-${id}`)?.focus();
      document.getElementById(`atlas-tab-${id}`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    });
  }, [itemId, navigate, runAction]);
  useEffect(() => subscribeAtlasPageRequests((request) => {
    if (request.ownerKey !== ownerKey) return;
    const action = request.action;
    if (!action) { selectPage(request.id); return; }
    const transport = getTransport();
    void runAction(async () => {
      if (request.id === itemId && editorRef.current) {
        await editorRef.current.performAction(action);
        return;
      }
      if (editorRef.current && !(await editorRef.current.flush())) return;
      if (getTransport() !== transport) return;
      navigate(`/atlas/${request.id}`, { state: {
        atlasPageAction: { ...request, action, token: crypto.randomUUID() } satisfies AtlasPendingPageAction,
      } });
    });
  }), [ownerKey, itemId, navigate, runAction, selectPage]);
  const requestedAction = (location.state as { atlasPageAction?: AtlasPendingPageAction } | null)?.atlasPageAction;
  const pageAction = requestedAction?.ownerKey === ownerKey && requestedAction.id === itemId ? requestedAction : undefined;
  const actionHandled = useCallback((token: string) => {
    if (requestedAction?.token !== token) return;
    navigate(`${location.pathname}${location.search}`, {
      replace: true, state: { ...location.state, atlasPageAction: undefined },
    });
  }, [location, navigate, requestedAction?.token]);
  const closePage = useCallback((id: string) => {
    void runAction(async () => {
      if (id === itemId && editorRef.current && !(await editorRef.current.flush())) return;
      dispatch(closeAtlasPageTab({ ownerKey, id }));
      if (id !== itemId) return;
      const index = tabs.findIndex((tab) => tab.id === id);
      const remaining = tabs.filter((tab) => tab.id !== id);
      const next = remaining[Math.min(index, remaining.length - 1)];
      navigate(next ? `/atlas/${next.id}` : "/atlas?type=page");
    });
  }, [dispatch, itemId, navigate, ownerKey, runAction, tabs]);
  const newPage = useCallback(() => {
    void runAction(async () => {
      if (editorRef.current && !(await editorRef.current.flush())) return;
      const next = await createPage({ accountId, title: "Untitled page",
        collectionId: editorRef.current?.collectionId ?? collectionId ?? null }).unwrap();
      navigate(`/atlas/${next.item.id}`);
    });
  }, [accountId, collectionId, createPage, navigate, runAction]);
  const titleChanged = useCallback((title: string) => {
    if (itemId) dispatch(renameAtlasPageTab({ ownerKey, id: itemId, title }));
  }, [dispatch, itemId, ownerKey]);
  const header = useMemo(() => tabs.length ? <AtlasPageTabs tabs={tabs} activeId={itemId} creating={busy}
    onSelect={selectPage} onClose={closePage} onNewPage={newPage} /> : null,
  [tabs, itemId, busy, selectPage, closePage, newPage]);
  useSetMainHeader(imageCreation ? null : header, !!itemId && tabs[0]?.id === itemId);

  if (imageCreation) return <Suspense fallback={<PageShell><Muted>Opening image creator…</Muted></PageShell>}>
    <AtlasImageCreator accountId={accountId} collectionId={collectionId} runId={runId} />
  </Suspense>;
  return itemId ? <Suspense fallback={<PageShell><Muted>Opening page…</Muted></PageShell>}>
    <AtlasPageEditor key={`${ownerKey}:${itemId}`} accountId={accountId} id={itemId} handleRef={editorRef} onTitleChange={titleChanged}
      requestedAction={pageAction} onActionHandled={actionHandled} />
  </Suspense> : <AtlasLibrary key={`${ownerKey}:${collectionId ?? ""}`} accountId={accountId} />;
}
