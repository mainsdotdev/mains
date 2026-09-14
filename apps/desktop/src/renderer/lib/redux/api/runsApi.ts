import { baseApi } from "./baseApi";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";
import type { ModeId } from "../../../../shared/modes";

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";
export type RunContextKind =
  | "file"
  | "selection"
  | "diff"
  | "git"
  | "terminal"
  | "env"
  | "note";
export type RunArtifactKind =
  | "patch"
  | "file"
  | "log"
  | "report"
  | "command_result";

export interface Run {
  id: string;
  accountId: string;
  workspaceId: string | null;
  collectionId: string | null;
  spaceId: string | null;
  providerId: string;
  /** Experience mode snapshotted at run start (see shared/modes.ts). */
  mode: ModeId;
  model: string | null;
  title: string | null;
  goal: string | null;
  status: RunStatus;
  systemPrompt: string | null;
  configSnapshot: Record<string, unknown> | null;
  toolPolicySnapshot: Record<string, unknown> | null;
  startedAt: number | null;
  endedAt: number | null;
  lastError: string | null;
  sessionId: string | null;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ArchivedRunWorkspace {
  id: string;
  name: string;
  isArchived: boolean;
  /** The workspace's project icon — what the sidebar prints beside it. */
  icon: string | null;
}

/** The project a chat is filed under — its collection, named and iconed. */
export interface ArchivedRunCollection {
  id: string;
  name: string;
  icon: string | null;
}

export interface ArchivedRun extends Run {
  workspace: ArchivedRunWorkspace | null;
  collection: ArchivedRunCollection | null;
}

export interface ActiveRunWorkspace {
  id: string;
  name: string;
}

/** A run with a live session, labelled with the workspace it is working in. */
export interface ActiveRun extends Run {
  workspace: ActiveRunWorkspace | null;
}

export type RecentRun = Run;

export interface CreateRunPayload {
  id: string;
  accountId: string;
  workspaceId?: string;
  collectionId?: string;
  spaceId?: string;
  providerId: string;
  model?: string;
  title?: string;
  goal?: string;
  status?: RunStatus;
  systemPrompt?: string;
  configSnapshot?: Record<string, unknown>;
  toolPolicySnapshot?: Record<string, unknown>;
}

export interface UpdateRunPayload {
  title?: string;
  goal?: string;
  status?: RunStatus;
  model?: string;
  systemPrompt?: string;
  configSnapshot?: Record<string, unknown>;
  toolPolicySnapshot?: Record<string, unknown>;
  startedAt?: number;
  endedAt?: number;
  lastError?: string;
}

export interface RunContext {
  id: number;
  runId: string;
  kind: RunContextKind;
  ref: string | null;
  content: string | null;
  entityId: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface CreateRunContextPayload {
  runId: string;
  kind: RunContextKind;
  ref?: string;
  content?: string;
  entityId?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
}

export interface RunArtifact {
  id: number;
  runId: string;
  kind: RunArtifactKind;
  path: string | null;
  content: string | null;
  entityId: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface CreateRunArtifactPayload {
  runId: string;
  kind: RunArtifactKind;
  path?: string;
  content?: string;
  entityId?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
}


export type RunTurnStatus = "active" | "completed";

export interface ModelUsageEntry {
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface RunTurn {
  id: number;
  runId: string;
  turnIndex: number;
  promptContent: string | null;
  responseContent: string | null;
  startedAt: number | null;
  endedAt: number | null;
  elapsedMs: number | null;
  status: RunTurnStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costMicros: number | null;
  model: string | null;
  modelUsage: Record<string, ModelUsageEntry> | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export const runsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getRuns: builder.query<Run[], number | void>({
      query: (limit) => ({
        handler: CHANNELS.runs.getAll,
        args: limit ? [limit] : [],
      }),
      providesTags: ["Runs"],
    }),

    listArchivedRuns: builder.query<ArchivedRun[], void>({
      query: () => ({ handler: CHANNELS.runs.listArchived }),
      // The response embeds the labels this list groups by — workspace name and
      // archive state, the project icon behind it, the collection a chat is
      // filed under — so a rename, a re-icon, or a delete in any of those
      // aggregates makes it stale, not just a run mutation.
      providesTags: ["Runs", "Workspaces", "Projects", "Collections"],
    }),

    listActiveRuns: builder.query<ActiveRun[], void>({
      query: () => ({ handler: CHANNELS.runs.listActive }),
      // Workspace renames change the label the dock prints, so both aggregates
      // can make this list stale.
      providesTags: ["Runs", "Workspaces"],
    }),

    listRecentRuns: builder.query<
      RecentRun[],
      { accountId: string; providerId: string; mode: ModeId; limit?: number }
    >({
      query: (options) => ({
        handler: CHANNELS.runs.listRecent,
        args: [options],
      }),
      // Coarse "Runs" keeps every run mutation refreshing this for free;
      // "RunsRecent" lets the runs:updated title event invalidate only this.
      providesTags: ["Runs", "RunsRecent", "Collections"],
    }),

    // Absence rule: a missing run arrives as null data, not an error.
    getRunById: builder.query<Run | null, string>({
      query: (id) => ({
        handler: CHANNELS.runs.getById,
        args: [id],
      }),
      providesTags: (_result, _error, id) => [{ type: "Runs", id }],
    }),

    getRunsByAccount: builder.query<
      Run[],
      { accountId: string; limit?: number }
    >({
      query: ({ accountId, limit }) => ({
        handler: CHANNELS.runs.getByAccount,
        args: [accountId, limit],
      }),
      providesTags: ["Runs"],
    }),

    getRunsByWorkspace: builder.query<
      Run[],
      {
        workspaceId: string;
        providerId?: string;
        mode?: ModeId;
        limit?: number;
      }
    >({
      query: ({ workspaceId, ...options }) => ({
        handler: CHANNELS.runs.getByWorkspace,
        args: [workspaceId, options],
      }),
      providesTags: ["Runs"],
    }),

    getRunsByStatus: builder.query<
      Run[],
      { accountId: string; status: RunStatus }
    >({
      query: ({ accountId, status }) => ({
        handler: CHANNELS.runs.getByStatus,
        args: [accountId, status],
      }),
      providesTags: ["Runs"],
    }),

    createRun: builder.mutation<string, CreateRunPayload>({
      query: (payload) => ({
        handler: CHANNELS.runs.create,
        args: [payload],
      }),
      invalidatesTags: ["Runs"],
    }),

    updateRun: builder.mutation<Run, { id: string; payload: UpdateRunPayload }>(
      {
        query: ({ id, payload }) => ({
          handler: CHANNELS.runs.update,
          args: [id, payload],
        }),
        // `RunsRecent` too: the chat sidebar reads that list, and a renamed
        // chat has to change there — that is where the rename happens.
        invalidatesTags: (_result, _error, { id }) => [
          "Runs",
          "RunsRecent",
          { type: "Runs", id },
        ],
      },
    ),

    moveRunToCollection: builder.mutation<
      Run,
      { runId: string; accountId: string; collectionId: string | null }
    >({
      query: (payload) => ({
        handler: CHANNELS.runs.moveToCollection,
        args: [payload],
      }),
      invalidatesTags: ["Runs", "RunsRecent", "Collections"],
    }),

    startRun: builder.mutation<Run, string>({
      query: (id) => ({
        handler: CHANNELS.runs.start,
        args: [id],
      }),
      invalidatesTags: (_result, _error, id) => ["Runs", { type: "Runs", id }],
    }),

    completeRun: builder.mutation<Run, string>({
      query: (id) => ({
        handler: CHANNELS.runs.complete,
        args: [id],
      }),
      invalidatesTags: (_result, _error, id) => ["Runs", { type: "Runs", id }],
    }),

    failRun: builder.mutation<Run, { id: string; error: string }>({
      query: ({ id, error }) => ({
        handler: CHANNELS.runs.fail,
        args: [id, error],
      }),
      invalidatesTags: (_result, _error, { id }) => [
        "Runs",
        { type: "Runs", id },
      ],
    }),

    cancelRun: builder.mutation<Run, string>({
      query: (id) => ({
        handler: CHANNELS.runs.cancel,
        args: [id],
      }),
      invalidatesTags: (_result, _error, id) => ["Runs", { type: "Runs", id }],
    }),

    abortRun: builder.mutation<void, string>({
      query: (runId) => ({
        handler: CHANNELS.runs.abort,
        args: [runId],
      }),
      invalidatesTags: (_result, _error, runId) => ["Runs", { type: "Runs", id: runId }],
    }),

    deleteRun: builder.mutation<void, string>({
      query: (id) => ({
        handler: CHANNELS.runs.delete,
        args: [id],
      }),
      invalidatesTags: ["Runs"],
    }),

    archiveRun: builder.mutation<Run, string>({
      query: (id) => ({
        handler: CHANNELS.runs.archive,
        args: [id],
      }),
      invalidatesTags: (_result, _error, id) => ["Runs", { type: "Runs", id }],
    }),

    unarchiveRun: builder.mutation<Run, string>({
      query: (id) => ({
        handler: CHANNELS.runs.unarchive,
        args: [id],
      }),
      invalidatesTags: (_result, _error, id) => ["Runs", { type: "Runs", id }],
    }),

    getRunContext: builder.query<RunContext[], string>({
      query: (runId) => ({
        handler: CHANNELS.runContext.getByRun,
        args: [runId],
      }),
      providesTags: (_result, _error, runId) => [
        { type: "RunContext", id: runId },
      ],
    }),

    addRunContext: builder.mutation<number, CreateRunContextPayload>({
      query: (payload) => ({
        handler: CHANNELS.runContext.add,
        args: [payload],
      }),
      invalidatesTags: (_result, _error, { runId }) => [
        "RunContext",
        { type: "RunContext", id: runId },
      ],
    }),

    removeRunContext: builder.mutation<void, { id: number; runId: string }>({
      query: ({ id }) => ({
        handler: CHANNELS.runContext.remove,
        args: [id],
      }),
      invalidatesTags: (_result, _error, { runId }) => [
        "RunContext",
        { type: "RunContext", id: runId },
      ],
    }),

    getRunArtifacts: builder.query<RunArtifact[], string>({
      query: (runId) => ({
        handler: CHANNELS.runArtifacts.getByRun,
        args: [runId],
      }),
      providesTags: (_result, _error, runId) => [
        { type: "RunArtifacts", id: runId },
      ],
    }),

    addRunArtifact: builder.mutation<number, CreateRunArtifactPayload>({
      query: (payload) => ({
        handler: CHANNELS.runArtifacts.add,
        args: [payload],
      }),
      invalidatesTags: (_result, _error, { runId }) => [
        "RunArtifacts",
        { type: "RunArtifacts", id: runId },
      ],
    }),

    removeRunArtifact: builder.mutation<void, { id: number; runId: string }>({
      query: ({ id }) => ({
        handler: CHANNELS.runArtifacts.remove,
        args: [id],
      }),
      invalidatesTags: (_result, _error, { runId }) => [
        "RunArtifacts",
        { type: "RunArtifacts", id: runId },
      ],
    }),


    executeReview: builder.mutation<
      { runId: string },
      {
        accountId: string;
        workspaceId: string;
        spaceId?: string;
        providerId: string;
        target: {
          type: "uncommittedChanges" | "baseBranch" | "commit" | "custom";
          branch?: string;
          sha?: string;
          title?: string;
          instructions?: string;
        };
        delivery?: "inline" | "detached";
        model?: string;
        systemPrompt?: string;
        configSnapshot?: Record<string, unknown>;
        toolPolicySnapshot?: Record<string, unknown>;
      }
    >({
      query: (payload) => ({
        handler: CHANNELS.runs.executeReview,
        args: [payload],
      }),
      invalidatesTags: ["Runs"],
    }),

    getRunTurns: builder.query<RunTurn[], string>({
      query: (runId) => ({
        handler: CHANNELS.runTurns.getByRun,
        args: [runId],
      }),
      providesTags: (_result, _error, runId) => [
        { type: "RunTurns", id: runId },
      ],
    }),

  }),
});

export const {
  useGetRunsQuery,
  useLazyGetRunsQuery,
  useListArchivedRunsQuery,
  useListActiveRunsQuery,
  useListRecentRunsQuery,
  useGetRunByIdQuery,
  useLazyGetRunByIdQuery,
  useGetRunsByAccountQuery,
  useLazyGetRunsByAccountQuery,
  useGetRunsByWorkspaceQuery,
  useLazyGetRunsByWorkspaceQuery,
  useGetRunsByStatusQuery,
  useLazyGetRunsByStatusQuery,
  useCreateRunMutation,
  useUpdateRunMutation,
  useMoveRunToCollectionMutation,
  useStartRunMutation,
  useCompleteRunMutation,
  useFailRunMutation,
  useCancelRunMutation,
  useAbortRunMutation,
  useDeleteRunMutation,
  useArchiveRunMutation,
  useUnarchiveRunMutation,
  useGetRunContextQuery,
  useLazyGetRunContextQuery,
  useAddRunContextMutation,
  useRemoveRunContextMutation,
  useGetRunArtifactsQuery,
  useLazyGetRunArtifactsQuery,
  useAddRunArtifactMutation,
  useRemoveRunArtifactMutation,
  useGetRunTurnsQuery,
  useLazyGetRunTurnsQuery,
  useExecuteReviewMutation,
} = runsApi;
