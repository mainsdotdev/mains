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
  Button,
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
import { useAbortRunMutation, type Space } from "@/lib/redux/api";
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
import { useJumpToRun } from "@/features/workspace/hooks/use-jump-to-run";
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
const LOCAL_SELECTION = { selection: "local" } as const;
const NO_WORKSPACES: readonly string[] = [];

interface AtlasPageChatProps {
  accountId: string;
  id: string;
  title: string;
  collectionId: string | null;
  disabled: boolean;
  prepareMessage: (instruction: string) => Promise<string | null>;
}
interface ChatPanelProps {
  title: string;
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
  const { activeSpace, spaces } = useActiveSpace();
  // Atlas owns a Work experience without changing any saved Space preference.
  const workSpaces = useMemo(() => spaces
    .filter((space) => space.accountId === props.accountId && getProviderVariantById(space.providerId)?.supportsAtlas)
    .map((space) => ({ ...space, mode: "work" as const })), [spaces, props.accountId]);
  const space =
    workSpaces.find((item) => item.id === state.spaceId) ??
    workSpaces.find((item) => item.id === activeSpace?.id) ??
    workSpaces.find((item) => item.providerId === activeSpace?.providerId) ??
    (!activeSpace ? workSpaces[0] : undefined);
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
        workSpaces={workSpaces}
      />
    </ActiveSpaceOverrideProvider>
  );
}

function AtlasWorkingChat({
  ownerKey,
  state,
  update,
  space,
  workSpaces,
  ...page
}: AtlasPageChatProps & {
  ownerKey: string;
  state: AtlasPageChatState;
  update: ChatPanelProps["update"];
  space: Space;
  workSpaces: Space[];
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
  const requestedRunId = state.spaceId === space.id ? state.runId : null;
  const ws = useWorkspaceRuns(
    undefined,
    space.providerId,
    "work",
    requestedRunId ?? undefined,
    NO_WORKSPACES,
    LOCAL_SELECTION,
  );
  // A remembered Chat/Developer run cannot become this Page's Work session.
  const runId = ws.activeRun?.id === requestedRunId && ws.activeRun?.mode === "work" ? requestedRunId : null;
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
  const jumpToRun = useJumpToRun();
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
      const message = await page.prepareMessage(instruction);
      if (!message || getTransport() !== transport) return;
      const uploads = submittedFiles.length
        ? await serializeAttachments(submittedFiles)
        : undefined;
      if (getTransport() !== transport) return;
      update({ mode: "details" });
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
            space.providerId,
            settings.model,
            uploads,
            submittedContext,
            page.collectionId,
            undefined,
            settings,
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

  return (
    <PluginLogoProvider providerId={space.providerId}>
      <AtlasChatPanel
        title={page.title}
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
            disabled={page.disabled || preparing || !ws.runsLoaded}
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
            expandFloatingToolbar
            floatingAutoFocus={!runId && state.mode === "details"}
            onFloatingFocus={() => {
              if (state.mode === "input") update({ mode: "details" });
            }}
            placeholder="Work with this page…"
            inputLabel="Page instruction"
            sendLabel="Send page instruction"
          />
        }
        actions={
          <>
            {activeRun && (
              <Button
                variant="ghost"
                className="text-xs"
                onClick={() =>
                  void jumpToRun({
                    id: activeRun.id,
                    spaceId: activeRun.spaceId ?? space.id,
                    providerId: activeRun.providerId,
                    mode: "work",
                    workspaceId: null,
                    collectionId: activeRun.collectionId ?? null,
                  })
                }
              >
                Open chat
              </Button>
            )}
            <AtlasMenu
              label="Page chat options"
              disabled={submitting}
              className="size-7 rounded-full text-primary-500 hover:bg-primary/5"
              trigger={<Ellipsis className="size-4" />}
            >
              {(close) => (
                <>
                  {state.runId && (
                    <DropdownMenuItem
                      onClick={() => {
                        close();
                        update({ runId: null, mode: "details" });
                      }}
                    >
                      New page chat
                    </DropdownMenuItem>
                  )}
                  {workSpaces.map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      selected={space.id === item.id}
                      onClick={() => {
                        close();
                        if (item.id !== space.id)
                          update({
                            spaceId: item.id,
                            runId: null,
                            mode: "details",
                          });
                      }}
                    >
                      {item.name}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </AtlasMenu>
          </>
        }
      >
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
  state,
  update,
  activity = null,
  composer,
  children,
}: ChatPanelProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-(--z-overlay)">
      <FloatingChatOverlay
        title={title || "Untitled page"}
        iconTooltip={`Work with ${title || "this page"}`}
        activity={activity}
        mode={state.mode}
        onShowDetails={() => update({ mode: "details" })}
        onMinimize={() => update({ mode: "icon" })}

        composer={composer}
      >
        {children}
      </FloatingChatOverlay>
    </div>
  );
}
