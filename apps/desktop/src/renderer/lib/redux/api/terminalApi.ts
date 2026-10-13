import { CHANNELS } from "@mains/contracts/channels";
import type { TerminalCreateOptions, TerminalSession, TerminalSnapshot } from "@mains/contracts/terminal";
import { appEvents } from "../../transport";
import { baseApi } from "./baseApi";

export const terminalApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getTerminalSessions: builder.query<TerminalSession[], void>({
      query: () => ({ handler: CHANNELS.terminal.list }),
      providesTags: ["TerminalSessions"],
      async onCacheEntryAdded(_args, { dispatch, cacheEntryRemoved }) {
        const remove = appEvents.terminal.onChanged(() => {
          dispatch(terminalApi.util.invalidateTags(["TerminalSessions"]));
        });
        try { await cacheEntryRemoved; } finally { remove(); }
      },
    }),
    createTerminal: builder.mutation<TerminalSnapshot, TerminalCreateOptions>({
      query: (options) => ({ handler: CHANNELS.terminal.create, args: [options] }),
      invalidatesTags: ["TerminalSessions"],
    }),
    stopTerminal: builder.mutation<void, string>({
      query: (id) => ({ handler: CHANNELS.terminal.destroy, args: [id] }),
      invalidatesTags: ["TerminalSessions"],
    }),
    stopIdleTerminals: builder.mutation<string[], string>({
      query: (workspaceId) => ({ handler: CHANNELS.terminal.destroyIdle, args: [workspaceId] }),
      invalidatesTags: ["TerminalSessions"],
    }),
  }),
});

export const { useGetTerminalSessionsQuery, useCreateTerminalMutation, useStopTerminalMutation, useStopIdleTerminalsMutation } = terminalApi;
