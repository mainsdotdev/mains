import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  DropdownMenuItem,
  Muted,
  SendButton,
  Text,
  Textarea,
  toast,
} from "@/components/ui";
import { Ellipsis } from "@/components/ui/icons";
import {
  ActiveSpaceOverrideProvider,
  useActiveSpace,
} from "@/hooks/use-active-space";
import { store } from "@/lib/redux";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { useAbortRunMutation, useListRecentRunsQuery, type Run, type Space } from "@/lib/redux/api";
import {
  setComposerContextKey,
  setContextItemsForKey,
} from "@/lib/redux/slices/workspaceSlice";
import {
  updateAtlasPageChat,
  type AtlasPageChatState,
} from "@/lib/redux/slices/atlasSlice";
import { getProviderVariantById } from "@/lib/provider-variants";
import { getTransport } from "@/lib/transport";
import { FloatingChatOverlay } from "@/features/workspace/components/floating-chat-overlay";
import { ComposerSendTargetSelect } from "@/features/workspace/components/composer-send-target-select";
import { WorkspaceInput } from "@/features/workspace/components/workspace-input";
import { WorkspaceEvents } from "@/features/workspace/components/workspace-events";
import { ToolApprovalDialog } from "@/features/workspace/components/tools/tool-approval-dialog";
import { PluginLogoProvider } from "@/features/workspace/hooks/use-plugin-logos";
import { useConversationSettings } from "@/features/workspace/hooks/use-conversation-settings";
import {
  useTransientUploads,
  getTransientUploadsForOwner,
  setTransientUploadsForOwner,
} from "@/features/workspace/hooks/use-transient-uploads";
import { useWorkspaceRuns } from "@/features/workspace/hooks/use-workspace-runs";
import { useToolApproval } from "@/features/workspace/hooks/use-tool-approval";
import {
  composerAnnotationPrompt,
  hasComposerMessage,
} from "@/features/workspace/lib/composer-message";
import type { ContextItem } from "@/features/workspace/lib/composer-context";
import { serializeAttachments } from "@/features/workspace/lib/run-helpers";
import { runOwnerKey } from "../../../../shared/ui-state-keys";
import { useAtlasOwnerKey } from "../hooks/use-atlas-tabs";
import { atlasError } from "../hooks/use-save-to-atlas";
import { AtlasMenu } from "./atlas-menu";

const EMPTY_CHAT: AtlasPageChatState = {
  runId: null,
  spaceId: null,
  draft: "",
  mode: "input",
};
const EMPTY_CONTEXT: ContextItem[] = [];
const EMPTY_RUNS: Run[] = [];
const LOCAL_SELECTION = { selection: "local" } as const;
const NO_WORKSPACES: readonly string[] = [];

interface AtlasPageChatProps {
  accountId: string;
  id: string;
  title: string;
  collectionId: string | null;
  disabled: boolean;
  beforeSend: () => Promise<boolean>;
}
interface ChatPanelProps {
  title: string;
  titleControl?: ReactNode;
  state: AtlasPageChatState;
  update: (patch: Partial<AtlasPageChatState>) => void;
  activity?: "running" | "queued" | null;
  composer: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

export function AtlasPageChat(props: AtlasPageChatProps) {
  const ownerKey = useAtlasOwnerKey(props.accountId);
  const dispatch = useAppDispatch();
  const state = useAppSelector(
    (store) => store.atlas.byOwner[ownerKey]?.chats[props.id] ?? EMPTY_CHAT,
  );
  const { activeSpace } = useActiveSpace();
  // Atlas owns a Work experience without changing any saved Space preference.
  const space = useMemo(() =>
    activeSpace?.accountId === props.accountId && getProviderVariantById(activeSpace.providerId)?.supportsAtlas
      ? { ...activeSpace, mode: "work" as const }
      : undefined, [activeSpace, props.accountId]);
  const update = useCallback(
    (patch: Partial<AtlasPageChatState>) => {
      dispatch(updateAtlasPageChat({ ownerKey, id: props.id, patch }));
    },
    [dispatch, ownerKey, props.id],
  );
  if (!space)
    return (
      <AtlasChatPanel
        title={props.title}
        state={state}
        update={update}
        composer={
          <div className="flex min-h-12 items-center gap-2 px-4 py-2">
            <Textarea
              variant="bare"
              aria-label="Page instruction"
              rows={1}
              value={state.draft}
              disabled
              placeholder="Select a supported agent to work with this page"
              className="min-w-0 flex-1 resize-none bg-transparent text-sm"
            />
            <SendButton
              disabled
              loading={false}
              onSubmit={() => {}}
              label="Send page instruction"
            />
          </div>
        }
      >
        <Muted className="p-5">
          Choose a Claude or Codex space to work with this page.
        </Muted>
      </AtlasChatPanel>
    );
  return (
    <ActiveSpaceOverrideProvider space={space}>
      <AtlasWorkingChat
        key={`${ownerKey}:${props.id}:${space.id}`}
        {...props}
        ownerKey={ownerKey}
        state={state}
        update={update}
        space={space}
      />
    </ActiveSpaceOverrideProvider>
  );
}

function AtlasWorkingChat({
  ownerKey,
  state,
  update,
  space,
  ...page
}: AtlasPageChatProps & {
  ownerKey: string;
  state: AtlasPageChatState;
  update: ChatPanelProps["update"];
  space: Space;
}) {
  const dispatch = useAppDispatch();
  const backendId = useAppSelector((state) => state.backends.activeBackendId);
  const composerKey = JSON.stringify([
    backendId ?? "local",
    "atlas-page",
    page.accountId,
    page.id,
    space.id,
  ]);
  // Use the common composer's ownership seam, so mentions and captures stay
  // with this Page and never replace another workspace's unsent context.
  useLayoutEffect(() => {
    const previousKey = store.getState().workspace.composerContextKey;
    dispatch(setComposerContextKey(composerKey));
    return () => {
      if (store.getState().workspace.composerContextKey === composerKey)
        dispatch(setComposerContextKey(previousKey));
    };
  }, [dispatch, composerKey]);
  const contextItems = useAppSelector((state) =>
    state.workspace.composerContextKey === composerKey
      ? state.workspace.contextItems
      : (state.workspace.contextItemsByKey[composerKey] ?? EMPTY_CONTEXT),
  );
  const [files, setFiles] = useTransientUploads(composerKey);
  const pageChats = useListRecentRunsQuery({
    accountId: page.accountId,
    providerId: space.providerId,
    mode: "work",
    spaceId: space.id,
    atlasPageId: page.id,
    limit: 100,
  }, { pollingInterval: 5000, refetchOnMountOrArgChange: true });
  const savedRuns = pageChats.currentData ?? EMPTY_RUNS;
  // An absent selection restores the most recently used chat. An explicit null
  // in this Space means the user chose New page chat and must stay a new draft.
  const requestedRunId = state.spaceId === space.id
    ? state.runId
    : savedRuns[0]?.id ?? null;
  const discoveringChats = pageChats.currentData === undefined;
  useEffect(() => {
    if (discoveringChats || state.spaceId === space.id) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) update({ runId: requestedRunId, spaceId: space.id });
    });
    return () => { cancelled = true; };
  }, [discoveringChats, state.spaceId, space.id, requestedRunId, update]);
  const ws = useWorkspaceRuns(
    undefined,
    space.providerId,
    "work",
    requestedRunId ?? undefined,
    NO_WORKSPACES,
    LOCAL_SELECTION,
  );
  // A remembered Chat/Developer run cannot become this Page's Work session.
  const runId = ws.activeRun?.id === requestedRunId && ws.activeRun?.mode === "work"
    && ws.activeRun.providerId === space.providerId && ws.activeRun.spaceId === space.id ? requestedRunId : null;
  const conversation = useConversationSettings({
    backendId,
    providerId: space.providerId,
    ownerKey: runId ? runOwnerKey(backendId, runId) : composerKey,
    runId,
    run: ws.activeRun,
    latestModel: [...ws.currentTurns].reverse().find((turn) => turn.model)
      ?.model,
    loadingRun: !!requestedRunId && !ws.runsLoaded,
  });
  const { pendingApprovals, respond } = useToolApproval(ws.runs);
  const approval = pendingApprovals.find(
    (item) => item.runId === ws.activeRunId,
  );
  const [abortRun] = useAbortRunMutation();
  const [preparing, setPreparing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const pending = useRef(false);
  const variant = getProviderVariantById(space.providerId)?.variant ?? "codex";
  const activeRun = ws.activeRun;
  const activity =
    activeRun?.status === "running" || activeRun?.status === "queued"
      ? activeRun.status
      : null;
  const submitting = preparing || ws.isLoading;
  const approvalId = approval?.requestId;
  useEffect(() => {
    if (approvalId) update({ mode: "details" });
  }, [approvalId, update]);

  const submit = async () => {
    if (
      pending.current ||
      submitting ||
      activity ||
      page.disabled ||
      !ws.runsLoaded ||
      discoveringChats ||
      !!pageChats.error ||
      !conversation.ready ||
      !hasComposerMessage(state.draft, files.length, contextItems)
    )
      return;
    pending.current = true;
    setPreparing(true);
    const transport = getTransport();
    const intent = conversation.beginSettingsIntent();
    const settings = conversation.settings;
    const submittedFiles = files;
    const submittedContext = contextItems;
    try {
      const instruction =
        state.draft.trim() ||
        composerAnnotationPrompt(submittedContext) ||
        "Use the attached context to work on this page.";
      if (!(await page.beforeSend()) || getTransport() !== transport) return;
      const uploads = submittedFiles.length
        ? await serializeAttachments(submittedFiles)
        : undefined;
      if (getTransport() !== transport) return;
      update({ mode: "details" });
      const accepted = runId
        ? await ws.continueRun(
            runId,
            instruction,
            settings.model,
            uploads,
            submittedContext,
            undefined,
            settings,
            undefined,
            page.id,
          )
        : await ws.executeRun(
            instruction,
            undefined,
            space.providerId,
            settings.model,
            uploads,
            submittedContext,
            page.collectionId,
            undefined,
            settings,
            undefined,
            page.id,
          );
      if (!accepted) return;
      conversation.rememberSettings(settings, intent);
      if (!runId && typeof accepted === "string") {
        await conversation.saveDraftSettingsToRun(accepted, settings);
        update({ runId: accepted, spaceId: space.id });
      }
      // Only clear the submitted draft. The user may have opened another Page
      // or added more context while the backend was accepting this message.
      if (
        store.getState().atlas.byOwner[ownerKey]?.chats[page.id]?.draft ===
        state.draft
      )
        update({ draft: "" });
      setTransientUploadsForOwner(
        composerKey,
        getTransientUploadsForOwner(composerKey).filter(
          (file) => !submittedFiles.includes(file),
        ),
      );
      const workspace = store.getState().workspace;
      const latestContext =
        workspace.composerContextKey === composerKey
          ? workspace.contextItems
          : (workspace.contextItemsByKey[composerKey] ?? EMPTY_CONTEXT);
      dispatch(
        setContextItemsForKey({
          key: composerKey,
          items: latestContext.filter(
            (item) => !submittedContext.includes(item),
          ),
        }),
      );
    } catch (error) {
      toast.error(atlasError(error));
    } finally {
      pending.current = false;
      setPreparing(false);
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
      setStopping(false);
    }
  };
  const selectChat = (selectedId: string | null) => {
    if (pending.current || submitting) return;
    if (selectedId && !savedRuns.some((run) => run.id === selectedId) && selectedId !== runId) return;
    update({ runId: selectedId, spaceId: space.id, mode: "details" });
  };
  const selectableRuns = runId && activeRun && !savedRuns.some((run) => run.id === runId)
    ? [activeRun, ...savedRuns]
    : savedRuns;
  const chatOptions = [
    { runId: null, label: "New page chat" },
    ...selectableRuns.map((run) => ({
      runId: run.id,
      label: run.title?.trim() || run.goal?.trim() || "Untitled chat",
    })),
  ];

  return (
    <PluginLogoProvider providerId={space.providerId}>
      <AtlasChatPanel
        title={page.title}
        titleControl={
          <ComposerSendTargetSelect
            key={state.mode}
            variant="title"
            target={{
              runId: requestedRunId,
              label: chatOptions.find((option) => option.runId === requestedRunId)?.label ?? page.title,
              options: chatOptions,
            }}
            onChange={selectChat}
            disabled={submitting || discoveringChats || !!pageChats.error || (!!requestedRunId && !ws.runsLoaded)}
          />
        }
        state={state}
        update={update}
        activity={activity}
        composer={
          <WorkspaceInput
            goal={state.draft}
            onGoalChange={(draft) => update({ draft })}
            onSubmit={() => void submit()}
            activeRun={activeRun}
            canResume={!!runId}
            isLoading={submitting}
            disabled={page.disabled || preparing || !ws.runsLoaded || discoveringChats || !!pageChats.error}
            providerId={space.providerId}
            selectedModel={conversation.settings.model}
            onModelChange={conversation.changeModel}
            settingsConfig={conversation.settings.config}
            onSettingsConfigChange={conversation.changeConfig}
            settingsReady={conversation.ready}
            uploadedFiles={files}
            onUploadedFilesChange={setFiles}
            onStop={() => void stop()}
            projectId={page.collectionId ?? undefined}
            layout="floating"
            floatingChatMode={state.mode}
            showPluginsButton={false}
            floatingAutoFocus={!runId && state.mode === "details"}
            onFloatingFocus={() => {
              if (state.mode === "input") update({ mode: "details" });
            }}
            placeholder="Work with this page…"
            inputLabel="Page instruction"
            sendLabel="Send page instruction"
          />
        }
        actions={runId ? (
          <AtlasMenu
            label="Page chat options"
            disabled={submitting}
            className="size-7 rounded-full text-primary-500 hover:bg-primary/5"
            trigger={<Ellipsis className="size-4" />}
          >
            {(close) => (
              <DropdownMenuItem
                onClick={() => {
                  close();
                  selectChat(null);
                }}
              >
                New page chat
              </DropdownMenuItem>
            )}
          </AtlasMenu>
        ) : undefined}
      >
        {!!pageChats.error && (
          <Text role="alert" size="xs" className="px-4 pt-3">
            {atlasError(pageChats.error)}
          </Text>
        )}
        {ws.error && (
          <Text role="alert" size="xs" className="px-4 pt-3">
            {ws.error}
          </Text>
        )}
        {(activeRun || submitting) && (
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
              isSubmitting={submitting}
              variant={variant}
              floatingChat
            />
          </div>
        )}
        {approval && (
          <div className="shrink-0 px-3 pb-2">
            <ToolApprovalDialog
              request={approval}
              onRespond={respond}
              variant={variant}
              maxHeight="30dvh"
            />
          </div>
        )}
      </AtlasChatPanel>
    </PluginLogoProvider>
  );
}

function AtlasChatPanel({
  title,
  titleControl,
  state,
  update,
  activity = null,
  composer,
  actions,
  children,
}: ChatPanelProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-(--z-overlay)">
      <FloatingChatOverlay
        title={title || "Untitled page"}
        titleControl={titleControl}
        iconTooltip={`Work with ${title || "this page"}`}
        activity={activity}
        mode={state.mode}
        onShowDetails={() => update({ mode: "details" })}
        onMinimize={() => update({ mode: "icon" })}
        actions={actions}
        composer={composer}
      >
        {children}
      </FloatingChatOverlay>
    </div>
  );
}
