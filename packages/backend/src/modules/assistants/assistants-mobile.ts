import type { AssistantWelcomeQuestion, MobileMateAssignment, MobileMateChat, MobileMateDirectory, MobileMateIdentity } from "@mains/contracts/assistants";
import { accountService } from "../account";
import { assistantsRepo } from "./assistants.repo";
import { assistantsService } from "./assistants.service";
import { text } from "./assistants.validation";

async function assertAccount(accountId: string) {
    if ((await accountService.getAccount()).id !== accountId) throw new Error("Account is unavailable");
}

function mateIdentity({ id, name, avatar, isArchived }: MobileMateIdentity): MobileMateIdentity {
    return { id, name, avatar, isArchived };
}

export const assistantsMobile = {
    assertAccount,
    async directory(accountId: string, selectedId?: string): Promise<MobileMateDirectory> {
        await assertAccount(accountId);
        const selected = selectedId === undefined ? null : assistantsService.get(text(selectedId, "Mate"), accountId);
        if (selectedId !== undefined && !selected) throw new Error("Assistant is unavailable");
        const profiles = selected ? [selected] : assistantsRepo.list(accountId).filter(mate => !mate.isArchived);
        const welcomes = new Map(assistantsRepo.welcomes(accountId).filter(row => row.state !== "started").map(row => [row.assistantId, row]));
        return {
            teams: assistantsRepo.teams(accountId).map(({ id, name }) => ({ id, name })),
            mates: profiles.map(profile => {
                const { id, description, teamId, providerId, model, spaceSnapshot, effort, instructions, isArchived } = profile;
                const row = isArchived ? undefined : welcomes.get(id);
                const question = row?.question ? JSON.parse(row.question) as AssistantWelcomeQuestion : null;
                const needsSetup = !!question?.profileSetup && !question.profileSetup.saved;
                const welcome = row && selectedId !== undefined ? { runId: row.runId, state: row.state, question, error: row.error } : null;
                const mate = { ...mateIdentity(profile), description, teamId, providerId, model, needsSetup, welcome };
                if (selectedId === undefined || isArchived) return mate;
                return { ...mate, details: { spaceName: spaceSnapshot.name, effort, instructions } };
            }),
        };
    },
    async chats(accountId: string, mateId: string): Promise<MobileMateChat[]> {
        await assertAccount(accountId);
        return assistantsService.conversations(mateId, accountId, { includeArchivedMate: true }).map(({ id, title, goal, updatedAt }) => {
            const label = title?.trim() || goal?.split("\n", 1)[0].trim();
            return { id, title: label ? Array.from(label).slice(0, 240).join("") : null, updatedAt };
        });
    },
    async assignment(accountId: string, runId: string, id: string): Promise<MobileMateAssignment> {
        await assertAccount(accountId);
        const task = assistantsRepo.assignment(text(id, "Assignment"));
        const source = text(runId, "Conversation");
        if (!task || task.accountId !== accountId || (task.fromRunId !== source && task.workerRunId !== source))
            throw new Error("Assignment is unavailable in this conversation");
        const { runsService } = await import("../runs");
        const run = await runsService.getRunById(source);
        if (run?.accountId !== accountId || run.isArchived || run.isReplica) throw new Error("Conversation is unavailable");
        const worker = task.workerRunId ? await runsService.getRunById(task.workerRunId) : null;
        const assignee = assistantsService.get(task.toAssistantId, accountId);
        return {
            id: task.id, title: task.title === "Assistant request" ? "Mate request" : task.title, status: task.status,
            result: task.result, error: task.error,
            assignee: assignee ? mateIdentity(assignee) : null,
            workerRunId: worker && worker.accountId === accountId && worker.assistantId === task.toAssistantId && !worker.isArchived && !worker.isReplica ? worker.id : null,
        };
    },
};
