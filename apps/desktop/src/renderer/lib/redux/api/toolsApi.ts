import { baseApi } from "./baseApi";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";

export type ToolCallStatus = "queued" | "running" | "done" | "error" | "canceled";

export interface ToolCall {
  id: number;
  accountId: string;
  runId: string | null;
  providerId: string | null;
  /** Provider-side tool-use id (stable across the run, unlike the row id). */
  toolCallId: string | null;
  /** Provider tool-use id of the call that spawned this one (subagent children). */
  parentToolCallId: string | null;
  toolName: string;
  status: ToolCallStatus;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: number | null;
  endedAt: number | null;
  latencyMs: number | null;
  costMicros: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface CreateToolCallPayload {
  accountId: string;
  runId?: string;
  providerId?: string;
  toolName: string;
  status?: ToolCallStatus;
  input?: Record<string, unknown>;
}

export interface UpdateToolCallPayload {
  status?: ToolCallStatus;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: number;
  endedAt?: number;
  latencyMs?: number;
  costMicros?: number;
  metadata?: Record<string, unknown>;
}

export const toolsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getToolCallsByRun: builder.query<ToolCall[], string>({
      query: (runId) => ({
        handler: CHANNELS.toolCalls.getByRun,
        args: [runId],
      }),
      providesTags: (_result, _error, runId) => [
        { type: "ToolCalls", id: runId },
      ],
    }),

    getToolCallsByAccount: builder.query<
      ToolCall[],
      { accountId: string; limit?: number }
    >({
      query: ({ accountId, limit }) => ({
        handler: CHANNELS.toolCalls.getByAccount,
        args: [accountId, limit],
      }),
      providesTags: ["ToolCalls"],
    }),

    createToolCall: builder.mutation<number, CreateToolCallPayload>({
      query: (payload) => ({
        handler: CHANNELS.toolCalls.create,
        args: [payload],
      }),
      invalidatesTags: ["ToolCalls"],
    }),

    updateToolCall: builder.mutation<
      void,
      { id: number; payload: UpdateToolCallPayload }
    >({
      query: ({ id, payload }) => ({
        handler: CHANNELS.toolCalls.update,
        args: [id, payload],
      }),
      invalidatesTags: ["ToolCalls"],
    }),

    startToolCall: builder.mutation<void, number>({
      query: (id) => ({
        handler: CHANNELS.toolCalls.start,
        args: [id],
      }),
      invalidatesTags: ["ToolCalls"],
    }),

    completeToolCall: builder.mutation<
      void,
      { id: number; output: Record<string, unknown>; latencyMs?: number }
    >({
      query: ({ id, output, latencyMs }) => ({
        handler: CHANNELS.toolCalls.complete,
        args: [id, output, latencyMs],
      }),
      invalidatesTags: ["ToolCalls"],
    }),

    failToolCall: builder.mutation<void, { id: number; error: string }>({
      query: ({ id, error }) => ({
        handler: CHANNELS.toolCalls.fail,
        args: [id, error],
      }),
      invalidatesTags: ["ToolCalls"],
    }),

  }),
});

export const {
  useGetToolCallsByRunQuery,
  useLazyGetToolCallsByRunQuery,
  useGetToolCallsByAccountQuery,
  useLazyGetToolCallsByAccountQuery,
  useCreateToolCallMutation,
  useUpdateToolCallMutation,
  useStartToolCallMutation,
  useCompleteToolCallMutation,
  useFailToolCallMutation,
} = toolsApi;
