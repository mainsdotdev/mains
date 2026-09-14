import { baseApi } from "./baseApi";
import type { Entity } from "./entitiesApi";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";

export interface SignalRecord {
  entityId: string;
  source: string;
  level: "fatal" | "critical" | "error" | "warning" | "info";
  category: "crash" | "bug" | "alert" | "feedback" | "exception" | "other";
  state: "open" | "resolved" | "ignored" | "regressed";
  eventCount: number;
  affectedUsers: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  stackTrace: string | null;
  file: string | null;
  function: string | null;
  line: number | null;
  assignee: string | null;
  labels: string | null;
  priority: number;
  projectId: string | null;
  resolvedAt: string | null;
}

export interface SignalWithEntity {
  signal: SignalRecord;
  entity: Entity;
}

export interface SignalQueryOptions {
  source?: string;
  level?: string;
  category?: string;
  state?: string;
  projectId?: string;
  limit?: number;
}

export const signalsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getSignalsByProject: builder.query<SignalWithEntity[], string>({
      query: (projectId) => ({
        handler: CHANNELS.signals.getAll,
        args: [{ projectId }],
      }),
      providesTags: (_result, _error, projectId) => [
        { type: "ProjectSignals", id: projectId },
      ],
    }),
  }),
  overrideExisting: false,
});

export const { useGetSignalsByProjectQuery } = signalsApi;
