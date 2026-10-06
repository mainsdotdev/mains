import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useNavigate } from "react-router-dom";
import { Button, Heading3, Muted, Text, toast } from "@/components/ui";
import { Plus } from "@/components/ui/icons";
import { PageShell } from "@/components/layout/page-shell";
import {
  ActiveSpaceOverrideProvider,
  useActiveSpace,
} from "@/hooks/use-active-space";
import {
  useAbortRunMutation,
  useCreateSpaceMutation,
  useGetRunByIdQuery,
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
import { getTransport } from "@/lib/transport";
import { WorkspaceInput } from "@/features/workspace/components/workspace-input";
import { WorkspaceEvents } from "@/features/workspace/components/workspace-events";
import { ToolApprovalDialog } from "@/features/workspace/components/tools/tool-approval-dialog";
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
import type { ContextItem } from "@/features/workspace/lib/composer-context";
import { runOwnerKey } from "../../../../shared/ui-state-keys";
import { atlasError } from "../hooks/use-save-to-atlas";
import {
  atlasImageCreatorHref,
} from "../lib/atlas-navigation";
import {
  findImageGenSkill,
  isImageGenAvailable,
  hasImageInstruction,
  IMAGE_TEMPLATES,
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
  return (
    <ImageCreatorSetup
      key={JSON.stringify([backendId, accountId, runId ?? "new", collectionId])}
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
  const { activeSpace, spaces, allSpaces, isLoaded } = useActiveSpace();
  const [createSpace] = useCreateSpaceMutation();
  const [createdSpace, setCreatedSpace] = useState<Space | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const creation = useRef<Promise<Space> | null>(null);
  const run = useGetRunByIdQuery(runId ?? "", { skip: !runId });
  const savedSpace = runId
    ? allSpaces.find((space) => space.id === run.data?.spaceId)
    : (spaces.find(
        (space) =>
          space.id === activeSpace?.id &&
          space.accountId === accountId &&
          space.providerId === "codex",
      ) ??
      spaces.find(
        (space) =>
          space.accountId === accountId && space.providerId === "codex",
      ));
  const space = savedSpace ?? createdSpace;
  const workSpace = useMemo(
    () => (space ? { ...space, mode: "work" as const } : null),
    [space],
  );
  useEffect(() => {
    if (!isLoaded || space || runId) return;
    let current = true;
    const transport = getTransport();
    // A real Codex Space gives the saved run its provider identity. This never
    // switches the app's active Space or edits another Space's mode.
    creation.current ??= createSpace({
      name: "Codex",
      slug: `codex-images-${crypto.randomUUID()}`,
      providerId: "codex",
      mode: "work",
    }).unwrap();
    void creation.current
      .then((created) => {
        if (current && getTransport() === transport) setCreatedSpace(created);
      })
      .catch((error) => {
        if (current && getTransport() === transport)
          setSetupError(atlasError(error));
      });
    return () => {
      current = false;
    };
  }, [isLoaded, space, runId, createSpace, retry]);
  if (
    runId &&
    (run.error ||
      (run.data !== undefined &&
        (!run.data ||
          run.data.accountId !== accountId ||
          run.data.providerId !== "codex" ||
          run.data.mode !== "work")))
  )
    return (
      <PageShell>
        <Text role="alert">Could not open this image run.</Text>
      </PageShell>
    );
  if (
    runId &&
    run.data &&
    isLoaded &&
    (!space || space.accountId !== accountId || space.providerId !== "codex")
  )
    return (
      <PageShell>
        <Text role="alert">
          The Codex space for this image run is unavailable.
        </Text>
      </PageShell>
    );
  if (setupError)
    return (
      <PageShell>
        <Text role="alert">{setupError}</Text>
        <Button
          variant="ghost"
          onClick={() => {
            creation.current = null;
            setSetupError(null);
            setRetry((value) => value + 1);
          }}
        >
          Retry
        </Button>
      </PageShell>
    );
  if (!workSpace || (runId && !run.data))
    return (
      <PageShell>
        <Muted>Opening image creator…</Muted>
      </PageShell>
    );
  return (
    <ActiveSpaceOverrideProvider space={workSpace}>
      <ImageComposer
        accountId={accountId}
        collectionId={run.data?.collectionId ?? collectionId}
        runId={runId}
        space={workSpace}
      />
    </ActiveSpaceOverrideProvider>
  );
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
  const backendId = useAppSelector((state) => state.backends.activeBackendId);
  const composerKey = JSON.stringify([
    backendId ?? "local",
    "atlas-image",
    accountId,
    space.id,
    runId ?? "new",
    collectionId,
  ]);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    const previousKey = store.getState().workspace.composerContextKey;
    dispatch(setComposerContextKey(composerKey));
    return () => {
      mounted.current = false;
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
    (text: string) => dispatch(setDraftText({ key: composerKey, text })),
    [dispatch, composerKey],
  );
  const skills = useGetProviderSkillsQuery({ id: "codex" }, {
    refetchOnMountOrArgChange: true,
  });
  const imageGen = findImageGenSkill(skills.data);
  const readySkill = isImageGenAvailable(imageGen) ? imageGen : undefined;
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
  const ws = useWorkspaceRuns(
    undefined,
    "codex",
    "work",
    runId,
    NO_WORKSPACES,
    LOCAL_SELECTION,
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
  const [preparing, setPreparing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const pending = useRef(false);
  const busy = preparing || ws.isLoading;
  const activity =
    activeRun?.status === "running" || activeRun?.status === "queued";
  const canSubmit =
    !!readySkill &&
    hasImageInstruction(draft, imageGen) &&
    ws.runsLoaded &&
    conversation.ready;
  const submit = async () => {
    if (
      !canSubmit ||
      pending.current ||
      busy ||
      activity ||
      !skillContext ||
      (runId && activeRun?.id !== runId)
    )
      return;
    pending.current = true;
    setPreparing(true);
    const transport = getTransport();
    const settings = conversation.settings;
    const intent = conversation.beginSettingsIntent();
    const submittedFiles = files;
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
      if (getTransport() !== transport || !mounted.current) return;
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
      if (!accepted || getTransport() !== transport) return;
      conversation.rememberSettings(settings, intent);
      if (!runId && typeof accepted === "string")
        await conversation.saveDraftSettingsToRun(accepted, settings);
      if (getTransport() !== transport) return;
      if (store.getState().workspace.draftTextByKey[composerKey] === draft)
        setDraft(runId ? imagePrompt("", readySkill) : "");
      setTransientUploadsForOwner(
        composerKey,
        getTransientUploadsForOwner(composerKey).filter(
          (file) => !submittedFiles.includes(file),
        ),
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
        mounted.current &&
        getTransport() === transport
      )
        navigate(atlasImageCreatorHref(collectionId ?? "", accepted), {
          replace: true,
        });
    } catch (error) {
      if (getTransport() === transport) toast.error(atlasError(error));
    } finally {
      pending.current = false;
      if (mounted.current) setPreparing(false);
    }
  };
  const stop = async () => {
    if (!activeRun || stopping) return;
    setStopping(true);
    try {
      await abortRun(activeRun.id).unwrap();
    } catch (error) {
      toast.error(atlasError(error));
    } finally {
      if (mounted.current) setStopping(false);
    }
  };
  const composer = (
    <WorkspaceInput
      goal={draft}
      onGoalChange={setDraft}
      onSubmit={() => void submit()}
      activeRun={activeRun}
      canResume={!!runId}
      isLoading={busy}
      disabled={busy || !ws.runsLoaded}
      sendDisabled={!canSubmit}
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
        {skills.isLoading
          ? "Checking Image Gen skill…"
          : skills.error
            ? "Could not check Codex skills."
            : imageGen
              ? "Enable the Image Gen skill in Codex, then refresh."
              : "Add the Image Gen skill to Codex, then refresh."}
      </Text>
      {!skills.isLoading && (
        <Button variant="ghost" onClick={() => void skills.refetch()}>
          {skills.error ? "Retry" : "Refresh"}
        </Button>
      )}
    </div>
  );
  return (
    <PluginLogoProvider providerId="codex">
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
            {approval && (
              <div className="mx-auto w-full max-w-210 px-4 pb-3">
                <ToolApprovalDialog
                  request={approval}
                  onRespond={respond}
                  variant="codex"
                  maxHeight="30dvh"
                />
              </div>
            )}
            <div className="shrink-0 px-5 pb-4">
              {skillNotice}
              {ws.error && <Text role="alert">{ws.error}</Text>}
              {composer}
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto noscrollbar px-5 pb-12">
            <div className="mx-auto w-full max-w-210 pt-[min(24dvh,240px)]">
              <Heading3 className="mb-8 text-center text-3xl font-normal">
                Where should we begin?
              </Heading3>
              {skillNotice}
              {ws.error && (
                <Text role="alert" className="mb-3">
                  {ws.error}
                </Text>
              )}
              {composer}
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
            </div>
          </div>
        )}
      </div>
    </PluginLogoProvider>
  );
}
