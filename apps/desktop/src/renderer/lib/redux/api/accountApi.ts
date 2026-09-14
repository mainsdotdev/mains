import { baseApi } from './baseApi';
import { CHANNELS } from "../../../../shared/ipc-kit/channels";

export interface Account {
  id: string;
  displayName: string;
  email: string;
  company: string;
  jobTitle: string;
  timezone: string;
  locale: string;
  website: string;
  avatarUrl: string;
  bio: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface UpdateAccountPayload {
  displayName?: string;
  email?: string;
  company?: string;
  jobTitle?: string;
  timezone?: string;
  locale?: string;
  website?: string;
  avatarUrl?: string;
  bio?: string;
}

export const accountApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAccount: builder.query<Account, void>({
      query: () => ({
        handler: CHANNELS.account.get,
      }),
      providesTags: ['Account'],
    }),

    updateAccount: builder.mutation<Account, UpdateAccountPayload>({
      query: (body) => ({
        handler: CHANNELS.account.update,
        args: [body],
      }),
      invalidatesTags: ['Account'],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetAccountQuery,
  useUpdateAccountMutation,
} = accountApi;
