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
import { useNavigate } from "react-router-dom";
import { Button, Heading3, Muted, Text, toast } from "@/components/ui";
// import { Plus } from "@/components/ui/icons";
import { PageShell } from "@/components/layout/page-shell";
import {
  ActiveSpaceOverrideProvider,
} from "@/hooks/use-active-space";
import {
  useAbortRunMutation,
  type Space,
} from "@/lib/redux/api";
import { useGetProviderSkillsQuery } from "@/lib/redux/api/providersApi";
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
  const setup = useImageCreatorSetup(accountId, runId);
  if (setup.error) return <PageShell>
    <Text role="alert">{setup.error}</Text>
    {setup.canRetry && <Button variant="ghost" onClick={setup.retry}>Retry</Button>}
  </PageShell>;
  if (!setup.space) return <PageShell><Muted>Opening image creator…</Muted></PageShell>;
  return <ActiveSpaceOverrideProvider space={setup.space}>
    <ImageComposer accountId={accountId} collectionId={setup.collectionId ?? collectionId} runId={runId} space={setup.space} />
  </ActiveSpaceOverrideProvider>;
}

function ImageComposer({
  accountId,
  collectionId,
  runId,
  space,
}: {
  accountId: string;
  collectionId: string | null;
  runId?: string;
  space: Space;
}) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [transport] = useState(getTransport);
  const [lifecycle] = useState(() => createImageCreatorLifecycle(() => getTransport() === transport, accountId));
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
    space.id,
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
  const skills = useGetProviderSkillsQuery({ id: "codex" }, {
    refetchOnMountOrArgChange: true,
  });
  const imageGen = findImageGenSkill(skills.data);
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
  const [files, setFiles] = useTransientUploads(composerKey);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const selection = { ...LOCAL_SELECTION, operationIsCurrent: lifecycle.current };
  const ws = useWorkspaceRuns(
    undefined,
    "codex",
    "work",
    runId,
    NO_WORKSPACES,
    selection,
  );
  const activeRun = ws.activeRun;
  const conversation = useConversationSettings({
    backendId,
    providerId: "codex",
    ownerKey: runId ? runOwnerKey(backendId, runId) : composerKey,
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
  const canSubmit = allowsImageSubmission({ skill: readySkill, prompt: draft, runsLoaded: ws.runsLoaded,
    settingsReady: conversation.ready, loading: ws.isLoading, runId, activeRun });
  useLayoutEffect(() => { lifecycle.observeEligibility(canSubmit, readySkill); }, [lifecycle, canSubmit, readySkill]);
  const submit = async () => {
    if (
      !skillContext ||
      !readySkill
    )
      return;
    const ticket = lifecycle.beginSubmission(canSubmit);
    if (!ticket) return;
    const settings = conversation.settings;
    const intent = conversation.beginSettingsIntent();
    const uploadSubmission = createUploadSubmission(files);
    ticket.own(() => uploadSubmission.close());
    const submittedFiles = uploadSubmission.files;
    const submittedContext = [
      ...contextItems.filter(
        (item) => item.kind !== "skill" || item.name !== skillContext.name,
      ),
      skillContext,
    ];
    try {
      const uploads = submittedFiles.length
        ? await serializeAttachments(submittedFiles)
        : undefined;
      if (!ticket.submit()) return;
      const message = draft.includes(`$${readySkill.name}`)
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
            "codex",
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
              (item.kind === "skill" && item.name === skillContext.name) ||
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
      showPluginsButton={false}
      providerId="codex"
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
  const skillNotice = !readySkill && (
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
  return (
    <PluginLogoProvider providerId="codex">
    <AsyncQuestionDialogProvider ownerKey={runOwnerKey(backendId, ws.activeRunId ?? runId ?? "new")}
      runId={ws.activeRunId} runStatus={ws.activeRun?.status} turns={ws.currentTurns}
      events={ws.currentEvents} historical={ws.history?.historical}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
          {runId && (
            <Button
              variant="ghost"
              onClick={() =>
                navigate(atlasImageCreatorHref(collectionId ?? ""))
              }
            >
              New image
            </Button>
          )}
        </div>
        {runId ? (
          <>
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
                variant="codex"
              />
            </div>
            <div className="shrink-0 px-5 pb-4">
              {skillNotice}
              {ws.error && <Text role="alert">{ws.error}</Text>}
              <ComposerSlot request={approval} onRespond={respond} variant="codex" maxHeight="30dvh">
                {composer}
              </ComposerSlot>
              {cancelPreparation}
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto noscrollbar px-5 pb-12">
            <div className="mx-auto w-full max-w-210 pt-[min(24dvh,240px)]">
              <Heading3 className="mb-8 text-center text-3xl font-normal">
                What do you want to create?
              </Heading3>
              {skillNotice}
              {ws.error && (
                <Text role="alert" className="mb-3">
                  {ws.error}
                </Text>
              )}
              {composer}
              {cancelPreparation}
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
            </div>
          </div>
        )}
      </div>
    </AsyncQuestionDialogProvider>
    </PluginLogoProvider>
  );
}
