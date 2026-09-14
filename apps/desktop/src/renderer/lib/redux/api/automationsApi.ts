import { baseApi } from './baseApi';
import { CHANNELS } from "../../../../shared/ipc-kit/channels";

export interface Automation {
  id: string;
  accountId: string;
  name: string;
  kind: 'sync' | 'report' | 'cleanup' | 'custom';
  action: string;
  intervalMinutes: number;
  isActive: boolean;
  config: string | null;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastError: string | null;
  consecutiveErrors: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAutomationInput {
  name: string;
  kind: Automation['kind'];
  action: string;
  intervalMinutes: number;
  isActive?: boolean;
  config?: string | null;
}

export interface UpdateAutomationInput {
  name?: string;
  kind?: Automation['kind'];
  action?: string;
  intervalMinutes?: number;
  isActive?: boolean;
  config?: string | null;
}

export const automationsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAutomations: builder.query<Automation[], void>({
      query: () => ({ handler: CHANNELS.automations.getAll }),
      providesTags: ['Automations'],
    }),

    createAutomation: builder.mutation<
      Automation,
      { accountId: string; input: CreateAutomationInput }
    >({
      query: ({ accountId, input }) => ({
        handler: CHANNELS.automations.create,
        args: [accountId, input],
      }),
      invalidatesTags: ['Automations'],
    }),

    updateAutomation: builder.mutation<
      Automation,
      { id: string; input: UpdateAutomationInput }
    >({
      query: ({ id, input }) => ({
        handler: CHANNELS.automations.update,
        args: [id, input],
      }),
      invalidatesTags: ['Automations'],
    }),

    deleteAutomation: builder.mutation<void, string>({
      query: (id) => ({
        handler: CHANNELS.automations.delete,
        args: [id],
      }),
      invalidatesTags: ['Automations'],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetAutomationsQuery,
  useLazyGetAutomationsQuery,
  useCreateAutomationMutation,
  useUpdateAutomationMutation,
  useDeleteAutomationMutation,
} = automationsApi;
