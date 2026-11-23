import { CHANNELS } from "@mains/contracts/channels";
import type { Assistant, AssistantTeam, AssistantOverview, CreateAssistant, ChangeAssistantTeam, UpdateAssistantProfile, SaveAssistantMemory, AssistantMemory, AssistantAssignment, AssignAssistantTask, AssistantConversation, SendAssistantMessage, AssistantExecution, AssistantProfileSetupAction, AssistantPullRequestReview, ReviewPullRequestWithAssistant, SetAssistantPinned } from "@mains/contracts/assistants";
import type { PrRefInput } from "@mains/contracts/pull-requests";
import { baseApi } from "./baseApi";
export const assistantsApi = baseApi.injectEndpoints({
    endpoints: (b) => ({
        assistantAssignment: b.query<AssistantAssignment | null, { accountId: string; id: string }>({ query: ({ accountId, id }) => ({ handler: CHANNELS.assistants.assignment, args: [accountId, id] }), providesTags: ["Assistants"] }),
        prepareAssistantWelcome: b.mutation<void, { accountId: string; id: string }>({ query: ({ accountId, id }) => ({ handler: CHANNELS.assistants.prepareWelcome, args: [accountId, id] }), invalidatesTags: ["Assistants"] }),
        respondAssistantWelcome: b.mutation<{ runId: string }, { accountId: string; id: string; answer: string | null; execution?: AssistantExecution }>({ query: ({ accountId, id, answer, execution }) => ({ handler: CHANNELS.assistants.respondWelcome, args: [accountId, id, answer, execution] }), invalidatesTags: ["Assistants", "AssistantChats"] }),
        setupAssistantProfile: b.mutation<void, { accountId: string; id: string; input: AssistantProfileSetupAction }>({
            query: ({ accountId, id, input }) => ({ handler: CHANNELS.assistants.setupProfile, args: [accountId, id, input] }),
            invalidatesTags: ["Assistants", "AssistantChats"],
        }),
        assistantOverview: b.query<AssistantOverview, string>({ query: accountId => ({ handler: CHANNELS.assistants.overview, args: [accountId] }), providesTags: ["Assistants"] }),
        createAssistantTeam: b.mutation<AssistantTeam, {
            accountId: string;
            name: string;
        }>({ query: input => ({ handler: CHANNELS.assistants.createTeam, args: [input] }), invalidatesTags: ["Assistants"] }),
        createAssistant: b.mutation<Assistant, CreateAssistant>({ query: input => ({ handler: CHANNELS.assistants.create, args: [input] }), invalidatesTags: ["Assistants"] }),
        changeAssistantTeam: b.mutation<Assistant, ChangeAssistantTeam>({ query: input => ({ handler: CHANNELS.assistants.changeTeam, args: [input] }), invalidatesTags: ["Assistants", "AssistantChats"] }),
        updateAssistantProfile: b.mutation<Assistant, UpdateAssistantProfile>({
            query: input => ({ handler: CHANNELS.assistants.updateProfile, args: [input] }),
            invalidatesTags: (_result, _error, { teamChange }) => teamChange ? ["Assistants", "AssistantChats"] : ["Assistants"],
        }),
        setAssistantPinned: b.mutation<void, SetAssistantPinned>({
            query: input => ({ handler: CHANNELS.assistants.setPinned, args: [input] }),
            invalidatesTags: (_result, error) => error ? [] : ["Assistants"],
        }),
        archiveAssistant: b.mutation<void, {
            accountId: string;
            id: string;
            archived: boolean;
        }>({ query: ({ accountId, id, archived }) => ({ handler: CHANNELS.assistants.archive, args: [accountId, id, archived] }), invalidatesTags: ["Assistants"] }),
        removeAssistant: b.mutation<void, { accountId: string; id: string }>({
            query: ({ accountId, id }) => ({ handler: CHANNELS.assistants.remove, args: [accountId, id] }),
            invalidatesTags: ["Assistants", "AssistantChats", "Pulse"],
        }),
        saveAssistantMemory: b.mutation<AssistantMemory, SaveAssistantMemory>({ query: input => ({ handler: CHANNELS.assistants.saveMemory, args: [input] }), invalidatesTags: ["Assistants"] }),
        removeAssistantMemory: b.mutation<void, {
            accountId: string;
            id: string;
            revision: number;
        }>({ query: ({ accountId, id, revision }) => ({ handler: CHANNELS.assistants.removeMemory, args: [accountId, id, revision] }), invalidatesTags: ["Assistants"] }),
        assistantConversations: b.query<AssistantConversation[], {
            accountId: string;
            id: string;
        }>({ query: ({ accountId, id }) => ({ handler: CHANNELS.assistants.conversations, args: [accountId, id], timeoutMs: 10_000 }), providesTags: ["AssistantChats"] }),
        sendAssistantMessage: b.mutation<{
            runId: string;
        }, SendAssistantMessage>({ query: input => ({ handler: CHANNELS.assistants.send, args: [input] }), invalidatesTags: ["AssistantChats", "Assistants"] }),
        assignAssistantTask: b.mutation<AssistantAssignment, AssignAssistantTask>({ query: input => ({ handler: CHANNELS.assistants.assign, args: [input] }), invalidatesTags: ["Assistants", "AssistantChats"] }),
        reviewPullRequestWithAssistant: b.mutation<AssistantAssignment, ReviewPullRequestWithAssistant>({
            query: input => ({ handler: CHANNELS.assistants.reviewPullRequest, args: [input] }),
            invalidatesTags: ["Assistants", "AssistantChats"],
        }),
        assistantPullRequestReviews: b.query<AssistantPullRequestReview[], { accountId: string; pr: PrRefInput; selectedId?: string }>({
            query: ({ accountId, pr, selectedId }) => ({ handler: CHANNELS.assistants.pullRequestReviews, args: [accountId, pr, selectedId ?? null] }),
            providesTags: ["Assistants"],
        }),
        reconcileAssistantTask: b.mutation<AssistantAssignment, {
            accountId: string;
            id: string;
        }>({ query: ({ accountId, id }) => ({ handler: CHANNELS.assistants.reconcile, args: [accountId, id] }), invalidatesTags: ["Assistants", "AssistantChats"] }),
        cancelAssistantTask: b.mutation<void, {
            accountId: string;
            id: string;
        }>({ query: ({ accountId, id }) => ({ handler: CHANNELS.assistants.cancel, args: [accountId, id] }), invalidatesTags: ["Assistants", "AssistantChats"] }),
        followupAssistantTask: b.mutation<void, {
            accountId: string;
            id: string;
            messageId: string;
            message: string;
        }>({ query: ({ accountId, id, messageId, message }) => ({ handler: CHANNELS.assistants.followup, args: [accountId, id, messageId, message] }), invalidatesTags: ["Assistants"] }),
    }),
});
export const { useSetupAssistantProfileMutation, useAssistantAssignmentQuery, usePrepareAssistantWelcomeMutation, useRespondAssistantWelcomeMutation, useAssistantOverviewQuery, useCreateAssistantTeamMutation, useCreateAssistantMutation, useChangeAssistantTeamMutation, useUpdateAssistantProfileMutation, useArchiveAssistantMutation, useSaveAssistantMemoryMutation, useRemoveAssistantMemoryMutation, useAssistantConversationsQuery, useSendAssistantMessageMutation, useAssignAssistantTaskMutation, useReconcileAssistantTaskMutation, useCancelAssistantTaskMutation, useFollowupAssistantTaskMutation } = assistantsApi;
export const { useReviewPullRequestWithAssistantMutation, useAssistantPullRequestReviewsQuery, useRemoveAssistantMutation, useSetAssistantPinnedMutation } = assistantsApi;
