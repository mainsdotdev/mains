import { baseApi } from './baseApi';
import { CHANNELS } from "../../../../shared/ipc-kit/channels";
import type { ModeId } from "../../../../shared/modes";

export type PulseFrequency = 'hourly' | 'daily' | 'weekdays' | 'weekly';

export interface Pulse {
  id: string;
  accountId: string;
  assistantId?: string | null;
  lastAssignmentId?: string | null;
  lastAssignmentStatus?: string | null;
  /** Set for developer pulses; work/chat pulses run workspace-less. */
  workspaceId: string | null;
  /** Optional collection target for work/chat pulses. */
  collectionId: string | null;
  /** Experience mode the pulse's runs execute under. */
  mode: ModeId;
  providerId: string;
  model: string;
  title: string;
  prompt: string;
  frequency: PulseFrequency;
  dayOfWeek: number | null;
  hour: number;
  minute: number;
  timezone: string;
  thinkingMode: boolean;
  effortLevel: string | null;
  isActive: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastRunId: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePulseInput {
  assistantId?: string | null;
  workspaceId?: string | null;
  collectionId?: string | null;
  mode?: ModeId;
  providerId: string;
  model: string;
  title: string;
  prompt: string;
  frequency: PulseFrequency;
  dayOfWeek?: number | null;
  hour: number;
  minute: number;
  timezone: string;
  thinkingMode?: boolean;
  effortLevel?: string | null;
  isActive?: boolean;
}

// `mode` is create-only — a pulse's mode is its execution shape, not a
// setting to flip later.
export type UpdatePulseInput = Partial<
  Omit<CreatePulseInput, 'assistantId' | 'workspaceId' | 'collectionId' | 'providerId' | 'mode'>
> & {
  workspaceId?: string | null;
  collectionId?: string | null;
  providerId?: string;
};
export type CreateAssistantRoutineInput = Omit<CreatePulseInput, 'assistantId' | 'providerId' | 'model' | 'collectionId' | 'thinkingMode' | 'effortLevel'>;

export const pulseApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    createAssistantRoutine: builder.mutation<Pulse, { accountId: string; assistantId: string; input: CreateAssistantRoutineInput }>({
      query: ({ accountId, assistantId, input }) => ({ handler: CHANNELS.pulse.createRoutine, args: [accountId, assistantId, input] }),
      invalidatesTags: ['Pulse'],
    }),
    getPulses: builder.query<Pulse[], void>({
      query: () => ({ handler: CHANNELS.pulse.getAll }),
      providesTags: ['Pulse'],
    }),

    getPulseById: builder.query<Pulse | null, string>({
      query: (id) => ({ handler: CHANNELS.pulse.getById, args: [id] }),
      providesTags: (_res, _err, id) => [{ type: 'Pulse', id }],
    }),

    createPulse: builder.mutation<
      Pulse,
      { accountId: string; input: CreatePulseInput }
    >({
      query: ({ accountId, input }) => ({
        handler: CHANNELS.pulse.create,
        args: [accountId, input],
      }),
      invalidatesTags: ['Pulse'],
    }),

    updatePulse: builder.mutation<
      Pulse,
      { id: string; input: UpdatePulseInput }
    >({
      query: ({ id, input }) => ({
        handler: CHANNELS.pulse.update,
        args: [id, input],
      }),
      invalidatesTags: ['Pulse'],
    }),

    deletePulse: builder.mutation<void, string>({
      query: (id) => ({ handler: CHANNELS.pulse.delete, args: [id] }),
      invalidatesTags: ['Pulse'],
    }),

    togglePulse: builder.mutation<
      Pulse,
      { id: string; isActive: boolean }
    >({
      query: ({ id, isActive }) => ({
        handler: CHANNELS.pulse.toggle,
        args: [id, isActive],
      }),
      invalidatesTags: ['Pulse'],
    }),

    runPulseNow: builder.mutation<Pulse, string>({
      query: (id) => ({ handler: CHANNELS.pulse.runNow, args: [id] }),
      invalidatesTags: ['Pulse', 'Runs', 'Assistants', 'AssistantChats'],
    }),
  }),
  overrideExisting: false,
});

export const {
  useCreateAssistantRoutineMutation,
  useGetPulsesQuery,
  useLazyGetPulsesQuery,
  useGetPulseByIdQuery,
  useCreatePulseMutation,
  useUpdatePulseMutation,
  useDeletePulseMutation,
  useTogglePulseMutation,
  useRunPulseNowMutation,
} = pulseApi;
