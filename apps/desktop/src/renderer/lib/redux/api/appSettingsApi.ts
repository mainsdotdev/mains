import { baseApi } from "./baseApi";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";

export interface AppSettings {
  id: string;
  accountId: string;
  activeSpaceId: string | null;
  enableWorktrees: boolean;
  showToolCalls: boolean;
  preventSleepDuringRuns: boolean;
  notifyOnRunComplete: boolean;
  notifyOnToolApproval: boolean;
  showMenuBarIcon: boolean;
  commitInstructions: string;
  prInstructions: string;
  createdAt: number;
  updatedAt: number;
}

export type AppSettingsPatch = Partial<
  Pick<
    AppSettings,
    | "activeSpaceId"
    | "enableWorktrees"
    | "showToolCalls"
    | "preventSleepDuringRuns"
    | "notifyOnRunComplete"
    | "notifyOnToolApproval"
    | "showMenuBarIcon"
    | "commitInstructions"
    | "prInstructions"
  >
>;

export const appSettingsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAppSettings: builder.query<AppSettings, void>({
      query: () => ({
        handler: CHANNELS.appSettings.get,
      }),
      providesTags: ["AppSettings"],
    }),

    updateAppSettings: builder.mutation<AppSettings, AppSettingsPatch>({
      query: (patch) => ({
        handler: CHANNELS.appSettings.update,
        args: [patch],
      }),
      invalidatesTags: ["AppSettings"],
    }),
  }),
  overrideExisting: false,
});

export const { useGetAppSettingsQuery, useLazyGetAppSettingsQuery, useUpdateAppSettingsMutation } =
  appSettingsApi;

// ─────────────────────────────────────────────────────────────
// Typed wrappers — preserve the per-field hook surface so
// components don't need to know about the patch shape.
// Depth lives below; these are sugar.
// ─────────────────────────────────────────────────────────────

type MutationTuple<TArg> = readonly [
  (arg: TArg) => ReturnType<ReturnType<typeof useUpdateAppSettingsMutation>[0]>,
  ReturnType<typeof useUpdateAppSettingsMutation>[1],
];

function makeFieldHook<K extends keyof AppSettingsPatch>(field: K) {
  return (): MutationTuple<NonNullable<AppSettingsPatch[K]>> => {
    const [update, result] = useUpdateAppSettingsMutation();
    return [(value) => update({ [field]: value } as AppSettingsPatch), result];
  };
}

export const useSetActiveSpaceMutation = (): MutationTuple<string | null> => {
  const [update, result] = useUpdateAppSettingsMutation();
  return [(value) => update({ activeSpaceId: value }), result];
};
export const useSetEnableWorktreesMutation = makeFieldHook("enableWorktrees");
export const useSetShowToolCallsMutation = makeFieldHook("showToolCalls");
export const useSetPreventSleepDuringRunsMutation = makeFieldHook("preventSleepDuringRuns");
export const useSetNotifyOnRunCompleteMutation = makeFieldHook("notifyOnRunComplete");
export const useSetNotifyOnToolApprovalMutation = makeFieldHook("notifyOnToolApproval");
export const useSetShowMenuBarIconMutation = makeFieldHook("showMenuBarIcon");
export const useSetCommitInstructionsMutation = makeFieldHook("commitInstructions");
export const useSetPrInstructionsMutation = makeFieldHook("prInstructions");
