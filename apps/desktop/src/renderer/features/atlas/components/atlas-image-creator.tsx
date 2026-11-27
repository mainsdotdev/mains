import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Heading3, Muted, SegmentedTabs, Text, toast } from "@/components/ui";
// import { Plus } from "@/components/ui/icons";
import { PageShell } from "@/components/layout/page-shell";
import {
  ActiveSpaceOverrideProvider,
} from "@/hooks/use-active-space";
import {
  useAbortRunMutation,
  type Space,
} from "@/lib/redux/api";
import { useGetProviderAccountInfoQuery, useGetProviderByIdQuery, useGetProviderSkillsQuery } from "@/lib/redux/api/providersApi";
import { store } from "@/lib/redux";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  setComposerContextKey,
  setContextItemsForKey,
  setDraftText,
} from "@/lib/redux/slices/workspaceSlice";
import { getTransport, onTransportChange } from "@/lib/transport";
import { WorkspaceInput } from "@/features/workspace/components/workspace-input";
import { WorkspaceEvents } from "@/features/workspace/components/workspace-events";
import { AsyncQuestionDialogProvider, ComposerSlot } from "@/features/workspace/components/tools/async-question-dialog";
import { PluginLogoProvider } from "@/features/workspace/hooks/use-plugin-logos";
import { useConversationSettings } from "@/features/workspace/hooks/use-conversation-settings";
import { useWorkspaceRuns } from "@/features/workspace/hooks/use-workspace-runs";
import { useToolApproval } from "@/features/workspace/hooks/use-tool-approval";
import {
  getTransientUploadsForOwner,
  setTransientUploadsForOwner,
  useTransientUploads,
} from "@/features/workspace/hooks/use-transient-uploads";
import { serializeAttachments } from "@/features/workspace/lib/run-helpers";
import { createUploadSubmission } from "@/features/workspace/lib/document-lifecycle";
import type { ContextItem } from "@/features/workspace/lib/composer-context";
import { runOwnerKey } from "../../../../shared/ui-state-keys";
import { atlasError } from "../hooks/use-save-to-atlas";
import { useImageCreatorSetup } from "../hooks/use-image-creator-setup";
import { allowsImageSubmission, availableImageSkill, createImageCreatorLifecycle } from "../lib/image-creator-lifecycle";
import {
  atlasImageCreatorHref,
} from "../lib/atlas-navigation";
import {
  findImageGenSkill,
  IMAGE_PROVIDERS,
  isImageGenSkill,
  isImageProvider,
  type ImageProvider,
  // IMAGE_TEMPLATES,
  imageGenContext,
  imagePrompt,
} from "../lib/image-creation";

const EMPTY_CONTEXT: ContextItem[] = [];
const NO_WORKSPACES: readonly string[] = [];
const LOCAL_SELECTION = { selection: "local" } as const;

export default function AtlasImageCreator({
  accountId,
  collectionId,
  runId,
}: {
  accountId: string;
  collectionId: string | null;
  runId?: string;
}) {
  const backendId = useAppSelector((state) => state.backends.activeBackendId);
  const [connectionGeneration, setConnectionGeneration] = useState(0);
  useLayoutEffect(() => onTransportChange(() => setConnectionGeneration((generation) => generation + 1)), []);
  return (
    <ImageCreatorSetup
      key={JSON.stringify([backendId, accountId, runId ?? "new", collectionId, connectionGeneration])}
      accountId={accountId}
      collectionId={collectionId}
      runId={runId}
    />
  );
}

function ImageCreatorSetup({
  accountId,
  collectionId,
  runId,
}: {
  accountId: string;
  collectionId: string | null;
  runId?: string;
}) {
  const [params, setParams] = useSearchParams();
  const requested = params.get("provider");
  const selected = isImageProvider(requested) ? requested : "codex";
  const setup = useImageCreatorSetup(accountId, runId, selected);
  const providerId = setup.space && isImageProvider(setup.space.providerId) ? setup.space.providerId : selected;
  const [transport] = useState(getTransport);
  // A provider switch retires submission tickets even though both providers share the draft.
  const lifecycle = useMemo(() => createImageCreatorLifecycle(() => getTransport() === transport, accountId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transport, accountId, providerId]);
  const lifecycleState = useSyncExternalStore(lifecycle.subscribe, lifecycle.snapshot);
  const changeProvider = (next: ImageProvider) => {
    if (next === selected || lifecycle.snapshot().phase !== "idle") return;
    setParams((current) => {
      const updated = new URLSearchParams(current);
      updated.set("provider", next);
      return updated;
    }, { replace: true });
  };
  const body = setup.error ? <>
    <Text role="alert">{setup.error}</Text>
    {setup.canRetry && <Button variant="ghost" onClick={setup.retry}>Retry</Button>}
  </> : setup.space ? <ActiveSpaceOverrideProvider space={setup.space}>
    <ImageComposer key={setup.space.id} accountId={accountId} collectionId={runId ? setup.collectionId ?? null : collectionId} runId={runId}
      space={setup.space} providerId={providerId} lifecycle={lifecycle} />
  </ActiveSpaceOverrideProvider> : <Muted>Opening image creator…</Muted>;
  if (runId) return setup.space ? body : <PageShell>{body}</PageShell>;
  return (
    <div className="flex h-full min-h-0 flex-col justify-center-safe overflow-y-auto noscrollbar px-5 py-12">
      <div className="mx-auto w-full max-w-210 shrink-0">
        <Heading3 className="mb-5 text-center text-3xl font-normal">What do you want to create?</Heading3>
        <SegmentedTabs className="mx-auto mb-6 w-fit" semantics="radiogroup" aria-label="Image provider"
          value={selected} options={IMAGE_PROVIDERS} onChange={changeProvider} disabled={lifecycleState.phase !== "idle"} />
        {body}
      </div>
    </div>
  );
}

function ImageComposer({
  accountId,
  collectionId,
  runId,
  space,
  providerId,
  lifecycle,
}: {
  accountId: string;
  collectionId: string | null;
  runId?: string;
  space: Space;
  providerId: ImageProvider;
  lifecycle: ReturnType<typeof createImageCreatorLifecycle>;
}) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const lifecycleState = useSyncExternalStore(lifecycle.subscribe, lifecycle.snapshot);
  useLayoutEffect(() => {
    const detach = lifecycle.attach();
    const off = onTransportChange(() => lifecycle.retire());
    return () => { off(); detach(); };
  }, [lifecycle]);
  const backendId = useAppSelector((state) => state.backends.activeBackendId);
  const composerKey = JSON.stringify([
    backendId ?? "local",
    "atlas-image",
    accountId,
    runId ? space.id : null,
    runId ?? "new",
    collectionId,
  ]);
  useLayoutEffect(() => {
    const previousKey = store.getState().workspace.composerContextKey;
    dispatch(setComposerContextKey(composerKey));
    return () => {
      if (store.getState().workspace.composerContextKey === composerKey)
        dispatch(setComposerContextKey(previousKey));
    };
  }, [dispatch, composerKey]);
  const draft = useAppSelector(
    (state) => state.workspace.draftTextByKey[composerKey] ?? "",
  );
  const contextItems = useAppSelector((state) =>
    state.workspace.composerContextKey === composerKey
      ? state.workspace.contextItems
      : (state.workspace.contextItemsByKey[composerKey] ?? EMPTY_CONTEXT),
  );
  const setDraft = useCallback(
    (text: string) => { lifecycle.editDraft(); dispatch(setDraftText({ key: composerKey, text })); },
    [dispatch, composerKey, lifecycle],
  );
  const usesSkill = providerId === "codex";
  const skills = useGetProviderSkillsQuery({ id: "codex" }, {
    skip: !usesSkill,
    refetchOnMountOrArgChange: true,
  });
  const cursor = useGetProviderByIdQuery("cursor", { skip: usesSkill });
  const cursorAccount = useGetProviderAccountInfoQuery("cursor", { skip: usesSkill, refetchOnMountOrArgChange: true });
  const cursorChecking = cursor.isLoading || cursorAccount.isFetching;
  const cursorReady = !cursorChecking && !cursor.error && !cursorAccount.error &&
    cursor.data?.isEnabled === true && cursorAccount.data?.cli?.compatibility !== "unsupported" &&
    (cursorAccount.data?.account?.type === "cursor" || !!cursor.data.config?.apiKey);
  const imageGen = usesSkill ? findImageGenSkill(skills.data) : undefined;
  const checkingSkill = skills.isLoading || skills.isFetching;
  const readySkill = availableImageSkill(imageGen, checkingSkill, skills.error);
  const skillContext = useMemo(
    () => (readySkill ? imageGenContext(readySkill) : null),
    [readySkill],
  );
  const selectSkill = useCallback(() => {
    if (!skillContext) return;
    const state = store.getState().workspace;
    const items =
      state.composerContextKey === composerKey
        ? state.contextItems
        : (state.contextItemsByKey[composerKey] ?? EMPTY_CONTEXT);
    dispatch(
      setContextItemsForKey({
        key: composerKey,
        items: [
          ...items.filter(
            (item) => item.kind !== "skill" || item.name !== skillContext.name,
          ),
          skillContext,
        ],
      }),
    );
  }, [dispatch, composerKey, skillContext]);
  useEffect(() => {
    if (!readySkill) return;
    selectSkill();
    const text = store.getState().workspace.draftTextByKey[composerKey] ?? "";
    if (!text.includes(`$${readySkill.name}`))
      setDraft(imagePrompt(text, readySkill));
  }, [readySkill, selectSkill, setDraft, composerKey]);
  useLayoutEffect(() => {
    if (usesSkill || runId) return;
    const state = store.getState().workspace;
    const items = state.composerContextKey === composerKey ? state.contextItems : state.contextItemsByKey[composerKey] ?? EMPTY_CONTEXT;
    const next = items.filter((item) => item.kind !== "skill" || !isImageGenSkill(item));
    const tokens = new Set(items.flatMap((item) => item.kind === "skill" && isImageGenSkill(item) ? [`$${item.name}`] : []));
    const text = state.draftTextByKey[composerKey] ?? "";
    const cleaned = text.replace(/\$[\w-]+/g, (token) =>
      tokens.has(token) || isImageGenSkill({ name: token.slice(1) }) ? "" : token);
    if (text !== cleaned) setDraft(cleaned.trimStart());
    if (items.length !== next.length) dispatch(setContextItemsForKey({ key: composerKey, items: next }));
  }, [usesSkill, runId, composerKey, setDraft, dispatch]);
  const [files, setFiles] = useTransientUploads(composerKey);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const selection = { ...LOCAL_SELECTION, operationIsCurrent: lifecycle.current, atlasImage: true } as const;
  const ws = useWorkspaceRuns(
    undefined,
    providerId,
    "work",
    runId,
    NO_WORKSPACES,
    selection,
  );
  const activeRun = ws.activeRun;
  const conversation = useConversationSettings({
    backendId,
    providerId,
    ownerKey: runId ? runOwnerKey(backendId, runId) : usesSkill ? composerKey : JSON.stringify([composerKey, providerId]),
    runId: runId ?? null,
    run: activeRun,
    latestModel: [...ws.currentTurns].reverse().find((turn) => turn.model)
      ?.model,
    loadingRun: !!runId && !ws.runsLoaded,
  });
  const { pendingApprovals, respond } = useToolApproval(ws.runs);
  const approval = pendingApprovals.find(
    (item) => item.runId === ws.activeRunId,
  );
  const [abortRun] = useAbortRunMutation();
  const preparing = lifecycleState.phase === "preparing" || lifecycleState.phase === "submitting" || lifecycleState.phase === "accepted";
  const busy = preparing || ws.isLoading;
  const activity =
    activeRun?.status === "running" || activeRun?.status === "queued";
  useLayoutEffect(() => { lifecycle.observeRun(activeRun); }, [lifecycle, activeRun]);
  const canSubmit = allowsImageSubmission({ providerId, skill: readySkill, prompt: draft, runsLoaded: ws.runsLoaded,
    settingsReady: conversation.ready && (usesSkill || cursorReady), loading: ws.isLoading, runId, activeRun });
  useLayoutEffect(() => { lifecycle.observeEligibility(canSubmit, readySkill); }, [lifecycle, canSubmit, readySkill]);
  const submit = async () => {
    const ticket = lifecycle.beginSubmission(canSubmit);
    if (!ticket) return;
    const settings = conversation.settings;
    const intent = conversation.beginSettingsIntent();
    const uploadSubmission = createUploadSubmission(files);
    ticket.own(() => uploadSubmission.close());
    const submittedFiles = uploadSubmission.files;
    const submittedContext = skillContext ? [
      ...contextItems.filter(
        (item) => item.kind !== "skill" || item.name !== skillContext.name,
      ),
      skillContext,
    ] : contextItems;
    try {
      const uploads = submittedFiles.length
        ? await serializeAttachments(submittedFiles)
        : undefined;
      if (!ticket.submit()) return;
      const message = !readySkill || draft.includes(`$${readySkill.name}`)
        ? draft
        : imagePrompt(draft, readySkill);
      const accepted = runId
        ? await ws.continueRun(
            runId,
            message,
            settings.model,
            uploads,
            submittedContext,
            undefined,
            settings,
          )
        : await ws.executeRun(
            message,
            undefined,
            providerId,
            settings.model,
            uploads,
            submittedContext,
            collectionId,
            undefined,
            settings,
          );
      if (!accepted || !ticket.accept(!runId)) return;
      conversation.rememberSettings(settings, intent);
      if (!runId && typeof accepted === "string")
        await conversation.saveDraftSettingsToRun(accepted, settings, ticket.current);
      if (!ticket.current()) return;
      if (ticket.unchangedDraft() && store.getState().workspace.draftTextByKey[composerKey] === draft)
        setDraft(runId ? imagePrompt("", readySkill) : "");
      setTransientUploadsForOwner(
        composerKey,
        uploadSubmission.accept(getTransientUploadsForOwner(composerKey)),
      );
      const current = store.getState().workspace;
      const latestContext =
        current.composerContextKey === composerKey
          ? current.contextItems
          : (current.contextItemsByKey[composerKey] ?? EMPTY_CONTEXT);
      dispatch(
        setContextItemsForKey({
          key: composerKey,
          items: latestContext.filter(
            (item) =>
              (item.kind === "skill" && item.name === skillContext?.name) ||
              !submittedContext.includes(item),
          ),
        }),
      );
      if (
        !runId &&
        typeof accepted === "string" &&
        ticket.current()
      )
        navigate(atlasImageCreatorHref(collectionId ?? "", accepted), {
          replace: true,
        });
    } catch (error) {
      if (ticket.current()) toast.error(atlasError(error));
    } finally {
      uploadSubmission.close();
      ticket.finish();
    }
  };
  const stop = async () => {
    if (!activeRun) return;
    const ticket = lifecycle.beginStop(activeRun.id, activity);
    if (!ticket) return;
    try {
      await abortRun(activeRun.id).unwrap();
      ticket.succeed();
    } catch (error) {
      if (ticket.current()) toast.error(atlasError(error));
    } finally {
      ticket.finish();
    }
  };
  const cancelPreparation = lifecycleState.phase === "preparing" &&
    <Button variant="ghost" onClick={() => lifecycle.cancelPreparation()}>Cancel preparation</Button>;
  const composer = (
    <WorkspaceInput
      goal={draft}
      onGoalChange={setDraft}
      onSubmit={() => void submit()}
      activeRun={activeRun}
      canResume={!!runId}
      isLoading={busy}
      disabled={busy || !ws.runsLoaded}
      sendDisabled={!lifecycle.canSubmit(canSubmit)}
      allowVoice={false}
      showGoalButton={false}
      providerId={providerId}
      selectedModel={conversation.settings.model}
      onModelChange={conversation.changeModel}
      settingsConfig={conversation.settings.config}
      onSettingsConfigChange={conversation.changeConfig}
      settingsReady={conversation.ready}
      uploadedFiles={files}
      onUploadedFilesChange={setFiles}
      attachmentMode="images"
      uploadInputRef={uploadInputRef}
      onStop={() => void stop()}
      projectId={collectionId ?? undefined}
      layout="centered"
      placeholder="Describe the image you want to create…"
      inputLabel="Image prompt"
      sendLabel="Create image"
    />
  );
  const skillNotice = usesSkill && !readySkill && (
    <div className="mx-auto mb-5 flex w-full max-w-210 flex-wrap items-center justify-between gap-3 rounded-2xl glass-card px-4 py-3">
      <Text size="s">
        {checkingSkill
          ? "Checking Image Gen skill…"
          : skills.error
            ? "Could not check Codex skills."
            : imageGen
              ? "Enable the Image Gen skill in Codex, then refresh."
              : "Add the Image Gen skill to Codex, then refresh."}
      </Text>
      {!checkingSkill && (
        <Button variant="ghost" onClick={() => void skills.refetch()}>
          {skills.error ? "Retry" : "Refresh"}
        </Button>
      )}
    </div>
  );
  const cursorNotice = !usesSkill && (
    cursorChecking ? <Muted className="mb-3">Checking Cursor…</Muted> :
    cursor.data?.isEnabled === false ? <Text role="alert" className="mb-3">Enable Cursor in Settings to create images.</Text> :
    cursor.error || cursorAccount.error ? <div className="mb-3 flex items-center gap-3">
      <Text role="alert">Could not check Cursor.</Text>
      <Button variant="ghost" onClick={() => { void cursor.refetch(); void cursorAccount.refetch(); }}>Retry</Button>
    </div> : null
  );
  const composerBody = <>
    {skillNotice}
    {cursorNotice}
    {ws.error && <Text role="alert" className="mb-3">{ws.error}</Text>}
    <ComposerSlot request={approval} onRespond={respond} variant={providerId} maxHeight="30dvh">
      {composer}
    </ComposerSlot>
    {cancelPreparation}
  </>;
  return (
    <PluginLogoProvider providerId={providerId}>
    <AsyncQuestionDialogProvider ownerKey={runOwnerKey(backendId, ws.activeRunId ?? runId ?? "new")}
      runId={ws.activeRunId} runStatus={ws.activeRun?.status} turns={ws.currentTurns}
      events={ws.currentEvents} historical={ws.history?.historical}>
      <div className="flex h-full min-h-0 flex-col">
        {runId ? (
          <>
            <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
              <Button
                variant="ghost"
                onClick={() =>
                  navigate(atlasImageCreatorHref(collectionId ?? "", undefined, providerId))
                }
              >
                New image
              </Button>
              <Muted>{IMAGE_PROVIDERS.find((option) => option.value === providerId)?.label}</Muted>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <WorkspaceEvents
                runs={ws.runs}
                activeTab={ws.activeRunId ?? "new-run"}
                currentEvents={ws.currentEvents}
                turns={ws.currentTurns}
                history={ws.history}
                currentWorkspace={null}
                issueTabs={[]}
                eventsEndRef={ws.eventsEndRef as RefObject<HTMLDivElement>}
                isSubmitting={busy}
                variant={providerId}
              />
            </div>
            <div className="shrink-0 px-5 pb-4">
              {composerBody}
            </div>
          </>
        ) : (
          <>
              {composerBody}
              {/* Templates are temporarily hidden until this section is revisited.
              <section className="mt-10" aria-label="Image templates">
                <Text className="mb-4" weight="medium">
                  Templates
                </Text>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Button
                    className="relative flex aspect-4/5 flex-col items-start justify-end rounded-3xl glass-card p-4 text-left text-s"
                    onClick={() => uploadInputRef.current?.click()}
                    aria-label="Upload a photo"
                  >
                    <Plus className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-primary-500" />
                    Upload a photo
                  </Button>
                  {IMAGE_TEMPLATES.map((template) => (
                    <Button
                      key={template.title}
                      aria-label={`${template.title} template`}
                      aria-pressed={draft.includes(template.prompt)}
                      className="flex aspect-4/5 flex-col items-start justify-end rounded-3xl glass-card p-4 text-left text-s focus-visible:ring-2 focus-visible:ring-accent/40"
                      onClick={() => {
                        selectSkill();
                        setDraft(imagePrompt(template.prompt, readySkill));
                      }}
                    >
                      {template.title}
                    </Button>
                  ))}
                </div>
              </section>
              */}
          </>
        )}
      </div>
    </AsyncQuestionDialogProvider>
    </PluginLogoProvider>
  );
}
